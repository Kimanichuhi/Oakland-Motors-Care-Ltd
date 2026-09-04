/*
# Oakland Motor Care Ltd — Scrap module rebuild: "Change in Days" + per-transaction ledger

Joseph's paper/Excel record enters transactions one at a time using a working date
plus a "Change in Days" delta (0 = same day, N = advance N days), not one batch per
calendar day. This migration retargets scrap_purchases/scrap_expenses from being
children of a single scrap_daily_records row into standalone dated transactions
(each storing both the resolved date and the change_in_days that produced it), adds
a dedicated cash_transactions ledger (Boss cash added / authorized adjustments), and
replaces the single-daily-record cash math with a maintained scrap_cash_summary
cache that can be recomputed forward from any date — needed because corrections to
a historical transaction must cascade to every later day's running balance.

Nothing is dropped: scrap_daily_records stays in place as a historical artifact of
the previous design, and every existing purchase/expense/cash-added value is
backfilled into the new columns/tables so no already-recorded data is lost.
*/

-- ── 1. Retarget scrap_purchases to be a standalone dated transaction ────────
alter table public.scrap_purchases add column if not exists date date;
alter table public.scrap_purchases add column if not exists change_in_days integer not null default 0 check (change_in_days >= 0);
alter table public.scrap_purchases add column if not exists supplier text;
alter table public.scrap_purchases add column if not exists notes text;
alter table public.scrap_purchases add column if not exists status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID'));
alter table public.scrap_purchases add column if not exists void_reason text;
alter table public.scrap_purchases add column if not exists voided_by uuid references auth.users(id);
alter table public.scrap_purchases add column if not exists voided_at timestamptz;
alter table public.scrap_purchases add column if not exists created_by uuid references auth.users(id);
alter table public.scrap_purchases add column if not exists created_by_name text;
alter table public.scrap_purchases add column if not exists updated_by uuid references auth.users(id);
alter table public.scrap_purchases add column if not exists updated_at timestamptz not null default now();
alter table public.scrap_purchases alter column daily_record_id drop not null;

update public.scrap_purchases sp set date = sdr.date, created_by = coalesce(sp.created_by, sdr.created_by)
from public.scrap_daily_records sdr
where sp.daily_record_id = sdr.id and sp.date is null;

alter table public.scrap_purchases alter column date set not null;
create index if not exists scrap_purchases_date_idx on public.scrap_purchases(date desc);

-- ── 2. Retarget scrap_expenses the same way ─────────────────────────────────
alter table public.scrap_expenses add column if not exists date date;
alter table public.scrap_expenses add column if not exists change_in_days integer not null default 0 check (change_in_days >= 0);
alter table public.scrap_expenses add column if not exists notes text;
alter table public.scrap_expenses add column if not exists status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID'));
alter table public.scrap_expenses add column if not exists void_reason text;
alter table public.scrap_expenses add column if not exists voided_by uuid references auth.users(id);
alter table public.scrap_expenses add column if not exists voided_at timestamptz;
alter table public.scrap_expenses add column if not exists created_by uuid references auth.users(id);
alter table public.scrap_expenses add column if not exists created_by_name text;
alter table public.scrap_expenses add column if not exists updated_by uuid references auth.users(id);
alter table public.scrap_expenses add column if not exists updated_at timestamptz not null default now();
alter table public.scrap_expenses alter column daily_record_id drop not null;

update public.scrap_expenses se set date = sdr.date, created_by = se.created_by
from public.scrap_daily_records sdr
where se.daily_record_id = sdr.id and se.date is null;

alter table public.scrap_expenses alter column date set not null;
create index if not exists scrap_expenses_date_idx on public.scrap_expenses(date desc);

-- ── 3. New cash ledger: Boss cash-added and authorized adjustments ─────────
create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  change_in_days integer not null default 0 check (change_in_days >= 0),
  transaction_type text not null check (transaction_type in ('CASH_ADDED','ADJUSTMENT')),
  amount_minor integer not null,
  added_by text,
  reason text,
  reference text,
  notes text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  void_reason text,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (transaction_type <> 'CASH_ADDED' or amount_minor > 0),
  check (amount_minor <> 0)
);
create index cash_transactions_date_idx on public.cash_transactions(date desc);

alter table public.cash_transactions enable row level security;
create policy "staff_select_cash_transactions" on public.cash_transactions for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_cash_transactions" on public.cash_transactions for insert to authenticated with check (false);
create policy "staff_update_cash_transactions" on public.cash_transactions for update to authenticated using (false) with check (false);
create policy "staff_delete_cash_transactions" on public.cash_transactions for delete to authenticated using (public.has_permission('settings.manage'));

-- Migrate legacy per-day "cash added" figures into the new ledger.
insert into public.cash_transactions(date, change_in_days, transaction_type, amount_minor, reason, created_by, created_at)
select date, 0, 'CASH_ADDED', cash_added_minor, 'Migrated from legacy daily record', created_by, created_at
from public.scrap_daily_records
where cash_added_minor > 0 and status = 'ACTIVE';

-- ── 4. Maintained running cash-position cache (one row per active date) ────
create table public.scrap_cash_summary (
  date date primary key,
  opening_cash_minor integer not null,
  cash_added_minor integer not null default 0,
  purchases_minor integer not null default 0,
  expenses_minor integer not null default 0,
  adjustments_minor integer not null default 0,
  closing_cash_minor integer not null,
  total_kg_purchased numeric(12,2) not null default 0,
  has_discrepancy boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.scrap_cash_summary enable row level security;
create policy "staff_select_scrap_cash_summary" on public.scrap_cash_summary for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_cash_summary" on public.scrap_cash_summary for insert to authenticated with check (false);
create policy "staff_update_scrap_cash_summary" on public.scrap_cash_summary for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_cash_summary" on public.scrap_cash_summary for delete to authenticated using (public.has_permission('settings.manage'));

-- ── 5. Internal-only: recompute the running cash position forward from a date ──
-- Only ever called from the RPCs below (via `perform`), never directly by a client
-- — that's why EXECUTE is revoked from authenticated too. A correction to a
-- historical transaction must cascade forward, so this walks every affected date
-- from p_from_date onward and rebuilds opening/closing balances in order.
create or replace function public.scrap_recompute_cash_from(p_from_date date)
returns void
language plpgsql security definer set search_path = public as $$
declare v_date date; v_prev_closing integer; v_added integer; v_adjustments integer; v_purchases integer; v_expenses integer; v_closing integer;
begin
  select closing_cash_minor into v_prev_closing from public.scrap_cash_summary where date < p_from_date order by date desc limit 1;
  if v_prev_closing is null then
    select coalesce(opening_cash_minor, 0) into v_prev_closing from public.scrap_settings where id = true;
  end if;

  for v_date in
    select d from (
      select date as d from public.scrap_purchases where status = 'ACTIVE'
      union select date from public.scrap_expenses where status = 'ACTIVE'
      union select date from public.cash_transactions where status = 'ACTIVE'
      union select date from public.scrap_cash_summary
    ) all_dates where d >= p_from_date order by d
  loop
    select coalesce(sum(amount_minor), 0) into v_added from public.cash_transactions where date = v_date and status = 'ACTIVE' and transaction_type = 'CASH_ADDED';
    select coalesce(sum(amount_minor), 0) into v_adjustments from public.cash_transactions where date = v_date and status = 'ACTIVE' and transaction_type = 'ADJUSTMENT';
    select coalesce(sum(purchase_amount_minor), 0) into v_purchases from public.scrap_purchases where date = v_date and status = 'ACTIVE';
    select coalesce(sum(amount_minor), 0) into v_expenses from public.scrap_expenses where date = v_date and status = 'ACTIVE';
    v_closing := v_prev_closing + v_added + v_adjustments - v_purchases - v_expenses;

    insert into public.scrap_cash_summary(date, opening_cash_minor, cash_added_minor, purchases_minor, expenses_minor, adjustments_minor, closing_cash_minor, total_kg_purchased, has_discrepancy, updated_at)
    values (
      v_date, v_prev_closing, v_added, v_purchases, v_expenses, v_adjustments, v_closing,
      (select coalesce(sum(quantity_purchased), 0) from public.scrap_purchases where date = v_date and status = 'ACTIVE'),
      v_closing < 0, now()
    )
    on conflict (date) do update set
      opening_cash_minor = excluded.opening_cash_minor, cash_added_minor = excluded.cash_added_minor,
      purchases_minor = excluded.purchases_minor, expenses_minor = excluded.expenses_minor,
      adjustments_minor = excluded.adjustments_minor, closing_cash_minor = excluded.closing_cash_minor,
      total_kg_purchased = excluded.total_kg_purchased, has_discrepancy = excluded.has_discrepancy, updated_at = now();

    v_prev_closing := v_closing;
  end loop;
end; $$;
revoke all on function public.scrap_recompute_cash_from(date) from public, anon, authenticated;

-- Bootstrap the cache once from whatever already exists (legacy + migrated rows).
do $$
declare v_earliest date;
begin
  select min(d) into v_earliest from (
    select date as d from public.scrap_purchases where status = 'ACTIVE'
    union select date from public.scrap_expenses where status = 'ACTIVE'
    union select date from public.cash_transactions where status = 'ACTIVE'
  ) all_dates;
  if v_earliest is not null then perform public.scrap_recompute_cash_from(v_earliest); end if;
end $$;

-- ── 6. Transaction-level RPCs ────────────────────────────────────────────

create or replace function public.scrap_record_purchase(
  p_date date, p_change_in_days integer, p_scrap_item_id uuid, p_weight_kg numeric,
  p_supplier text default null, p_notes text default null, p_force boolean default false
) returns public.scrap_purchases
language plpgsql security definer set search_path = public as $$
declare
  v_item public.scrap_items%rowtype; v_cycle public.stock_cycles%rowtype; v_next_cycle_num integer;
  v_amount integer; v_purchase public.scrap_purchases%rowtype; v_summary public.scrap_cash_summary%rowtype; v_recorded_by_name text;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record scrap purchases'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in Days cannot be negative'; end if;
  if p_weight_kg is null or p_weight_kg <= 0 then raise exception 'Weight (KG) must be greater than zero'; end if;

  select * into v_item from public.scrap_items where id = p_scrap_item_id for update;
  if not found then raise exception 'Scrap type not found'; end if;
  if not v_item.active then raise exception '% is not active and cannot be purchased', v_item.name; end if;
  if v_item.current_rate_minor is null then raise exception 'Set a rate for % before recording a purchase', v_item.name; end if;

  select * into v_cycle from public.stock_cycles where scrap_item_id = v_item.id and status = 'OPEN' for update;
  if not found then
    v_next_cycle_num := coalesce((select max(cycle_number) from public.stock_cycles where scrap_item_id = v_item.id), 0) + 1;
    insert into public.stock_cycles(scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status)
    values (v_item.id, v_next_cycle_num, 0, p_date, 0, 'OPEN')
    returning * into v_cycle;
  end if;

  v_amount := round(p_weight_kg * v_item.current_rate_minor)::integer;
  select coalesce(pr.full_name, au.email, 'Staff') into v_recorded_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  insert into public.scrap_purchases(daily_record_id, scrap_item_id, stock_cycle_id, rate_used_minor, opening_stock, quantity_purchased, purchase_amount_minor, closing_stock, date, change_in_days, supplier, notes, created_by, created_by_name)
  values (null, v_item.id, v_cycle.id, v_item.current_rate_minor, v_cycle.current_quantity, p_weight_kg, v_amount, v_cycle.current_quantity + p_weight_kg, p_date, coalesce(p_change_in_days, 0), nullif(trim(coalesce(p_supplier, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), v_recorded_by_name)
  returning * into v_purchase;

  update public.stock_cycles set current_quantity = v_cycle.current_quantity + p_weight_kg where id = v_cycle.id;

  perform public.scrap_recompute_cash_from(p_date);
  select * into v_summary from public.scrap_cash_summary where date = p_date;
  if v_summary.has_discrepancy and not (p_force and public.has_permission('scrap.manage')) then
    raise exception 'INSUFFICIENT_CASH: Recording this purchase would leave % with a negative closing cash of %.', p_date, v_summary.closing_cash_minor;
  end if;

  perform public.log_audit('CREATE_SCRAP_PURCHASE', 'scrap_purchases', v_purchase.id, null, to_jsonb(v_purchase));
  return v_purchase;
end; $$;

create or replace function public.scrap_edit_purchase(p_id uuid, p_supplier text, p_notes text)
returns public.scrap_purchases
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_purchases%rowtype; v_after public.scrap_purchases%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to edit scrap purchases'; end if;
  select * into v_before from public.scrap_purchases where id = p_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  update public.scrap_purchases set supplier = nullif(trim(coalesce(p_supplier, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_after;
  perform public.log_audit('EDIT_SCRAP_PURCHASE', 'scrap_purchases', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

create or replace function public.scrap_void_purchase(p_id uuid, p_reason text)
returns public.scrap_purchases
language plpgsql security definer set search_path = public as $$
declare v_purchase public.scrap_purchases%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to void scrap purchases'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to void a purchase'; end if;
  select * into v_purchase from public.scrap_purchases where id = p_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_purchase.status = 'VOID' then return v_purchase; end if;

  update public.stock_cycles set current_quantity = current_quantity - v_purchase.quantity_purchased where id = v_purchase.stock_cycle_id;
  update public.scrap_purchases set status = 'VOID', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_purchase;

  perform public.scrap_recompute_cash_from(v_purchase.date);
  perform public.log_audit('VOID_SCRAP_PURCHASE', 'scrap_purchases', p_id, null, to_jsonb(v_purchase), jsonb_build_object('reason', p_reason));
  return v_purchase;
end; $$;

create or replace function public.scrap_record_expense(
  p_date date, p_change_in_days integer, p_expense_type text, p_description text, p_amount_minor integer, p_notes text default null, p_force boolean default false
) returns public.scrap_expenses
language plpgsql security definer set search_path = public as $$
declare v_expense public.scrap_expenses%rowtype; v_summary public.scrap_cash_summary%rowtype; v_type text := nullif(trim(coalesce(p_expense_type, '')), ''); v_recorded_by_name text;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record scrap expenses'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in Days cannot be negative'; end if;
  if v_type is null then raise exception 'Expense type is required'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  select coalesce(pr.full_name, au.email, 'Staff') into v_recorded_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  insert into public.scrap_expenses(daily_record_id, category, amount_minor, description, date, change_in_days, notes, created_by, created_by_name)
  values (null, v_type, p_amount_minor, nullif(trim(coalesce(p_description, '')), ''), p_date, coalesce(p_change_in_days, 0), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), v_recorded_by_name)
  returning * into v_expense;

  perform public.scrap_recompute_cash_from(p_date);
  select * into v_summary from public.scrap_cash_summary where date = p_date;
  if v_summary.has_discrepancy and not (p_force and public.has_permission('scrap.manage')) then
    raise exception 'INSUFFICIENT_CASH: Recording this expense would leave % with a negative closing cash of %.', p_date, v_summary.closing_cash_minor;
  end if;

  perform public.log_audit('CREATE_SCRAP_EXPENSE', 'scrap_expenses', v_expense.id, null, to_jsonb(v_expense));
  return v_expense;
end; $$;

create or replace function public.scrap_edit_expense(p_id uuid, p_description text, p_notes text)
returns public.scrap_expenses
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_expenses%rowtype; v_after public.scrap_expenses%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to edit scrap expenses'; end if;
  select * into v_before from public.scrap_expenses where id = p_id for update;
  if not found then raise exception 'Expense not found'; end if;
  update public.scrap_expenses set description = nullif(trim(coalesce(p_description, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_after;
  perform public.log_audit('EDIT_SCRAP_EXPENSE', 'scrap_expenses', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

create or replace function public.scrap_void_expense(p_id uuid, p_reason text)
returns public.scrap_expenses
language plpgsql security definer set search_path = public as $$
declare v_expense public.scrap_expenses%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to void scrap expenses'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to void an expense'; end if;
  select * into v_expense from public.scrap_expenses where id = p_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if v_expense.status = 'VOID' then return v_expense; end if;

  update public.scrap_expenses set status = 'VOID', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_expense;

  perform public.scrap_recompute_cash_from(v_expense.date);
  perform public.log_audit('VOID_SCRAP_EXPENSE', 'scrap_expenses', p_id, null, to_jsonb(v_expense), jsonb_build_object('reason', p_reason));
  return v_expense;
end; $$;

create or replace function public.scrap_add_cash(
  p_date date, p_change_in_days integer, p_amount_minor integer,
  p_added_by text default null, p_reason text default null, p_reference text default null, p_notes text default null
) returns public.cash_transactions
language plpgsql security definer set search_path = public as $$
declare v_tx public.cash_transactions%rowtype;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record cash added'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in Days cannot be negative'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  insert into public.cash_transactions(date, change_in_days, transaction_type, amount_minor, added_by, reason, reference, notes, created_by)
  values (p_date, coalesce(p_change_in_days, 0), 'CASH_ADDED', p_amount_minor, nullif(trim(coalesce(p_added_by, '')), ''), nullif(trim(coalesce(p_reason, '')), ''), nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_tx;

  perform public.scrap_recompute_cash_from(p_date);
  perform public.log_audit('ADD_SCRAP_CASH', 'cash_transactions', v_tx.id, null, to_jsonb(v_tx));
  return v_tx;
end; $$;

create or replace function public.scrap_adjust_cash(p_date date, p_amount_minor integer, p_reason text, p_notes text default null, p_force boolean default false)
returns public.cash_transactions
language plpgsql security definer set search_path = public as $$
declare v_tx public.cash_transactions%rowtype; v_summary public.scrap_cash_summary%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to adjust scrap cash'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_amount_minor is null or p_amount_minor = 0 then raise exception 'Adjustment amount cannot be zero'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required for a cash adjustment'; end if;

  insert into public.cash_transactions(date, change_in_days, transaction_type, amount_minor, reason, notes, created_by)
  values (p_date, 0, 'ADJUSTMENT', p_amount_minor, p_reason, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_tx;

  perform public.scrap_recompute_cash_from(p_date);
  select * into v_summary from public.scrap_cash_summary where date = p_date;
  if v_summary.has_discrepancy and not p_force then
    raise exception 'INSUFFICIENT_CASH: This adjustment would leave % with a negative closing cash of %.', p_date, v_summary.closing_cash_minor;
  end if;

  perform public.log_audit('ADJUST_SCRAP_CASH', 'cash_transactions', v_tx.id, null, to_jsonb(v_tx));
  return v_tx;
end; $$;

create or replace function public.scrap_void_cash_transaction(p_id uuid, p_reason text)
returns public.cash_transactions
language plpgsql security definer set search_path = public as $$
declare v_tx public.cash_transactions%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to void a cash transaction'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to void a cash transaction'; end if;
  select * into v_tx from public.cash_transactions where id = p_id for update;
  if not found then raise exception 'Cash transaction not found'; end if;
  if v_tx.status = 'VOID' then return v_tx; end if;

  update public.cash_transactions set status = 'VOID', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_tx;

  perform public.scrap_recompute_cash_from(v_tx.date);
  perform public.log_audit('VOID_SCRAP_CASH', 'cash_transactions', p_id, null, to_jsonb(v_tx), jsonb_build_object('reason', p_reason));
  return v_tx;
end; $$;

revoke all on function public.scrap_record_purchase(date, integer, uuid, numeric, text, text, boolean) from public, anon;
revoke all on function public.scrap_edit_purchase(uuid, text, text) from public, anon;
revoke all on function public.scrap_void_purchase(uuid, text) from public, anon;
revoke all on function public.scrap_record_expense(date, integer, text, text, integer, text, boolean) from public, anon;
revoke all on function public.scrap_edit_expense(uuid, text, text) from public, anon;
revoke all on function public.scrap_void_expense(uuid, text) from public, anon;
revoke all on function public.scrap_add_cash(date, integer, integer, text, text, text, text) from public, anon;
revoke all on function public.scrap_adjust_cash(date, integer, text, text, boolean) from public, anon;
revoke all on function public.scrap_void_cash_transaction(uuid, text) from public, anon;

grant execute on function public.scrap_record_purchase(date, integer, uuid, numeric, text, text, boolean) to authenticated;
grant execute on function public.scrap_edit_purchase(uuid, text, text) to authenticated;
grant execute on function public.scrap_void_purchase(uuid, text) to authenticated;
grant execute on function public.scrap_record_expense(date, integer, text, text, integer, text, boolean) to authenticated;
grant execute on function public.scrap_edit_expense(uuid, text, text) to authenticated;
grant execute on function public.scrap_void_expense(uuid, text) to authenticated;
grant execute on function public.scrap_add_cash(date, integer, integer, text, text, text, text) to authenticated;
grant execute on function public.scrap_adjust_cash(date, integer, text, text, boolean) to authenticated;
grant execute on function public.scrap_void_cash_transaction(uuid, text) to authenticated;
