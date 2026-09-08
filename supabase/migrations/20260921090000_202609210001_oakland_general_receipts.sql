/*
# General receipts — ad-hoc receipts not tied to a vehicle/work order

1. Purpose
- Oakland Motor Care also does one-off jobs that don't fit the vehicle/work-order
  model at all (e.g. welding a door for a company, a walk-in fabrication job).
  There's no vehicle, no customer record, sometimes not even a phone number —
  just "who paid, for what, how much."
- general_receipts is a standalone, sequentially-numbered receipt for exactly
  that: a client name (free text — a person or a company), a description of the
  work, an amount, and a payment method. No FK to customers/vehicles/job_cards.

2. Security
- create_general_receipt is the only way to create one (SECURITY DEFINER),
  mirroring create_purchase_order: validates, generates the receipt number via
  the existing generate_document_number counter, inserts, logs the audit trail.
- Reuses the existing payment.create/payment.view permissions — a general
  receipt represents money received, same as a payment against an invoice.
- Immutable once created (no update policy) since it's a receipt, not a draft;
  only settings.manage can delete one (e.g. a genuine mistake).
*/

create table public.general_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text unique not null,
  receipt_date date not null default current_date,
  client_name text not null,
  client_phone text,
  description text not null,
  amount_minor integer not null check (amount_minor > 0),
  payment_method text not null check (payment_method in ('CASH','MPESA','BANK','CARD','OTHER')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index general_receipts_date_idx on public.general_receipts(receipt_date desc);

alter table public.general_receipts enable row level security;

create policy "staff_select_general_receipts" on public.general_receipts for select to authenticated using (public.has_permission('payment.view'));
create policy "staff_insert_general_receipts" on public.general_receipts for insert to authenticated with check (false);
create policy "staff_delete_general_receipts" on public.general_receipts for delete to authenticated using (public.has_permission('settings.manage'));

create or replace function public.create_general_receipt(
  p_date date, p_client_name text, p_client_phone text, p_description text,
  p_amount_minor integer, p_payment_method text, p_notes text default null
) returns public.general_receipts
language plpgsql security definer set search_path = public as $$
declare v_receipt public.general_receipts%rowtype; v_number text; v_created_by_name text;
begin
  if not public.has_permission('payment.create') then raise exception 'Not authorized to create receipts'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if nullif(trim(coalesce(p_client_name, '')), '') is null then raise exception 'Client name is required'; end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then raise exception 'A description of the work is required'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_payment_method is null or p_payment_method not in ('CASH','MPESA','BANK','CARD','OTHER') then raise exception 'Invalid payment method'; end if;

  select coalesce(pr.full_name, au.email, 'Staff') into v_created_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  v_number := public.generate_document_number('GENRCP', 'RCP', 'payment.create');

  insert into public.general_receipts(receipt_number, receipt_date, client_name, client_phone, description, amount_minor, payment_method, notes, created_by, created_by_name)
  values (v_number, p_date, trim(p_client_name), nullif(trim(coalesce(p_client_phone, '')), ''), trim(p_description), p_amount_minor, p_payment_method, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), v_created_by_name)
  returning * into v_receipt;

  perform public.log_audit('CREATE_GENERAL_RECEIPT', 'general_receipts', v_receipt.id, null, to_jsonb(v_receipt));
  return v_receipt;
end; $$;

revoke all on function public.create_general_receipt(date, text, text, text, integer, text, text) from public, anon;
grant execute on function public.create_general_receipt(date, text, text, text, integer, text, text) to authenticated;
