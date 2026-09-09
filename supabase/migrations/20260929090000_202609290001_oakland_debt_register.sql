/*
# Debt Register — a dedicated module for tracking who owes what, and why

1. Problem
- The only debt visible anywhere was a job card's own unpaid balance (added in the debt
  pipeline migration) — useful, but it only covers customer debt that already went
  through a job card, has no way to note WHO let the balance go unpaid, and has no way
  to record debt that doesn't fit a job card at all: a technician who personally took a
  part or cash without it being accounted for, a customer debt that was handled off the
  books, and so on.

2. Fix
- debt_records: a manual ledger for exactly those two cases —
    CUSTOMER: a customer still owes money, and a staff member (usually the technician
      who handled the job) is noted as accountable for it.
    STAFF: a staff member personally owes the business (took a part, cash shortfall,
      damage, etc.) — no customer involved at all.
  Each row can optionally point at the job card, customer, and/or part that caused it,
  so "what product/service brought the debt" is answerable directly from the record,
  not just a free-text note. Writes are RPC-only (record_debt, record_debt_recovery,
  write_off_debt, update_debt_record), matching every other financial table in this
  schema — direct client inserts/updates are blocked by RLS.
- Existing job-card debt (already tracked via invoices/payments) is deliberately NOT
  duplicated into this table — duplicating it would let the two fall out of sync the
  moment a payment is recorded. Instead the Debts module's reports read job-card debt
  live (job_cards + job_card_signoffs for the assigned technician) and combine it with
  this table's manual entries for one combined "who's responsible" view.
- debt.view / debt.manage: new permissions. debt.view is granted to MANAGER (it's a
  read-only permission, consistent with every other .view permission that role holds);
  debt.manage stays ADMIN-only, same as every other .manage permission.
*/

create table public.debt_records (
  id uuid primary key default gen_random_uuid(),
  debt_type text not null check (debt_type in ('CUSTOMER', 'STAFF')),
  responsible_employee_id uuid references public.employees(id),
  responsible_name text not null,
  customer_id uuid references public.customers(id),
  job_card_id uuid references public.job_cards(id),
  part_id uuid references public.parts(id),
  item_description text not null,
  amount_minor integer not null check (amount_minor > 0),
  amount_recovered_minor integer not null default 0 check (amount_recovered_minor >= 0 and amount_recovered_minor <= amount_minor),
  status text not null default 'OUTSTANDING' check (status in ('OUTSTANDING', 'PARTIALLY_RECOVERED', 'RECOVERED', 'WRITTEN_OFF')),
  incurred_date date not null default current_date,
  notes text,
  write_off_reason text,
  created_by uuid default auth.uid() references auth.users(id),
  updated_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  recovered_at timestamptz
);

create index debt_records_status_idx on public.debt_records(status);
create index debt_records_responsible_idx on public.debt_records(responsible_employee_id);
create index debt_records_job_card_idx on public.debt_records(job_card_id);

alter table public.debt_records enable row level security;
create policy "staff_select_debt_records" on public.debt_records for select to authenticated using (public.has_permission('debt.view'));
create policy "staff_insert_debt_records" on public.debt_records for insert to authenticated with check (false);
create policy "staff_update_debt_records" on public.debt_records for update to authenticated using (false) with check (false);
create policy "staff_delete_debt_records" on public.debt_records for delete to authenticated using (public.has_permission('settings.manage'));

insert into public.permissions(key, label) values
  ('debt.view', 'View debt records'),
  ('debt.manage', 'Record and manage debts')
on conflict(key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.name = 'MANAGER' and p.key = 'debt.view'
on conflict do nothing;

-- ── Record a new debt ────────────────────────────────────────────────────
create or replace function public.record_debt(
  p_debt_type text, p_responsible_employee_id uuid, p_responsible_name text,
  p_item_description text, p_amount_minor integer, p_incurred_date date default current_date,
  p_customer_id uuid default null, p_job_card_id uuid default null, p_part_id uuid default null,
  p_notes text default null
) returns public.debt_records
language plpgsql security definer set search_path = public as $$
declare v_debt public.debt_records%rowtype; v_name text := nullif(trim(coalesce(p_responsible_name, '')), '');
begin
  if not public.has_permission('debt.manage') then raise exception 'Not authorized to record debts'; end if;
  if p_debt_type not in ('CUSTOMER', 'STAFF') then raise exception 'Invalid debt type'; end if;
  if v_name is null then raise exception 'Responsible person is required'; end if;
  if nullif(trim(coalesce(p_item_description, '')), '') is null then raise exception 'Describe what caused this debt'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_incurred_date is null then raise exception 'Date is required'; end if;

  insert into public.debt_records(debt_type, responsible_employee_id, responsible_name, customer_id, job_card_id, part_id, item_description, amount_minor, incurred_date, notes, created_by, updated_by)
  values (p_debt_type, p_responsible_employee_id, v_name, p_customer_id, p_job_card_id, p_part_id, trim(p_item_description), p_amount_minor, p_incurred_date, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid())
  returning * into v_debt;

  perform public.notify_by_permission(
    'debt.view',
    'New debt recorded: ' || v_debt.responsible_name,
    v_debt.item_description || ' — KES ' || to_char(p_amount_minor / 100.0, 'FM999,999,999.00') || ' (' || p_debt_type || ').',
    'WARNING',
    auth.uid()
  );

  perform public.log_audit('RECORD_DEBT', 'debt_records', v_debt.id, null, to_jsonb(v_debt));
  return v_debt;
end; $$;
revoke all on function public.record_debt(text, uuid, text, text, integer, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.record_debt(text, uuid, text, text, integer, date, uuid, uuid, uuid, text) to authenticated;

-- ── Record a recovery (full or partial) against a debt ──────────────────
create or replace function public.record_debt_recovery(p_debt_id uuid, p_amount_minor integer, p_notes text default null)
returns public.debt_records
language plpgsql security definer set search_path = public as $$
declare v_before public.debt_records%rowtype; v_after public.debt_records%rowtype; v_new_recovered integer; v_new_status text;
begin
  if not public.has_permission('debt.manage') then raise exception 'Not authorized to record debt recoveries'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  select * into v_before from public.debt_records where id = p_debt_id for update;
  if not found then raise exception 'Debt record not found'; end if;
  if v_before.status = 'WRITTEN_OFF' then raise exception 'Cannot record a recovery against a written-off debt'; end if;

  v_new_recovered := v_before.amount_recovered_minor + p_amount_minor;
  if v_new_recovered > v_before.amount_minor then raise exception 'Recovery exceeds the outstanding balance'; end if;
  v_new_status := case when v_new_recovered >= v_before.amount_minor then 'RECOVERED' when v_new_recovered > 0 then 'PARTIALLY_RECOVERED' else 'OUTSTANDING' end;

  update public.debt_records set
    amount_recovered_minor = v_new_recovered,
    status = v_new_status,
    recovered_at = case when v_new_status = 'RECOVERED' then now() else recovered_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_debt_id returning * into v_after;

  perform public.log_audit('RECORD_DEBT_RECOVERY', 'debt_records', p_debt_id, to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('recovery_amount_minor', p_amount_minor, 'notes', p_notes));
  return v_after;
end; $$;
revoke all on function public.record_debt_recovery(uuid, integer, text) from public, anon;
grant execute on function public.record_debt_recovery(uuid, integer, text) to authenticated;

-- ── Write off a debt that will not be recovered ──────────────────────────
create or replace function public.write_off_debt(p_debt_id uuid, p_reason text)
returns public.debt_records
language plpgsql security definer set search_path = public as $$
declare v_before public.debt_records%rowtype; v_after public.debt_records%rowtype;
begin
  if not public.has_permission('debt.manage') then raise exception 'Not authorized to write off debts'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to write off a debt'; end if;

  select * into v_before from public.debt_records where id = p_debt_id for update;
  if not found then raise exception 'Debt record not found'; end if;
  if v_before.status = 'RECOVERED' then raise exception 'This debt has already been fully recovered'; end if;

  update public.debt_records set status = 'WRITTEN_OFF', write_off_reason = p_reason, updated_by = auth.uid(), updated_at = now()
  where id = p_debt_id returning * into v_after;

  perform public.log_audit('WRITE_OFF_DEBT', 'debt_records', p_debt_id, to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('reason', p_reason));
  return v_after;
end; $$;
revoke all on function public.write_off_debt(uuid, text) from public, anon;
grant execute on function public.write_off_debt(uuid, text) to authenticated;

-- ── Edit a debt's details (blocked once money has moved against it) ─────
create or replace function public.update_debt_record(
  p_debt_id uuid, p_item_description text, p_amount_minor integer, p_notes text,
  p_responsible_employee_id uuid, p_responsible_name text
) returns public.debt_records
language plpgsql security definer set search_path = public as $$
declare v_before public.debt_records%rowtype; v_after public.debt_records%rowtype; v_name text := nullif(trim(coalesce(p_responsible_name, '')), '');
begin
  if not public.has_permission('debt.manage') then raise exception 'Not authorized to edit debt records'; end if;
  select * into v_before from public.debt_records where id = p_debt_id for update;
  if not found then raise exception 'Debt record not found'; end if;
  if v_before.status in ('RECOVERED', 'WRITTEN_OFF') then raise exception 'Cannot edit a % debt', lower(v_before.status); end if;
  if p_amount_minor is not null and p_amount_minor <> v_before.amount_minor and v_before.amount_recovered_minor > 0 then
    raise exception 'Cannot change the amount after a recovery has been recorded against this debt';
  end if;
  if p_amount_minor is not null and p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if v_name is null then raise exception 'Responsible person is required'; end if;

  update public.debt_records set
    item_description = coalesce(nullif(trim(p_item_description), ''), item_description),
    amount_minor = coalesce(p_amount_minor, amount_minor),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    responsible_employee_id = p_responsible_employee_id,
    responsible_name = v_name,
    updated_by = auth.uid(), updated_at = now()
  where id = p_debt_id returning * into v_after;

  perform public.log_audit('UPDATE_DEBT_RECORD', 'debt_records', p_debt_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;
revoke all on function public.update_debt_record(uuid, text, integer, text, uuid, text) from public, anon;
grant execute on function public.update_debt_record(uuid, text, integer, text, uuid, text) to authenticated;
