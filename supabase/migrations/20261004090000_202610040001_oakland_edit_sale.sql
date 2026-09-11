/*
# Oakland Motor Care Ltd — admin edit for a sale's record-keeping fields

1. Problem
- A completed sale can currently only be voided, never corrected — there is no
  edit path at all, unlike every other record type in the app (customers,
  vehicles, work orders, invoices, quotations, POs, suppliers, parts all have
  one). That's a real gap for the common case of fixing a typo'd customer name,
  phone, vehicle, payment method/reference, or a wrong date/change-in-days from
  a bulk import — none of that should require voiding and recreating the sale.
- `staff_update_sales` is `using(false) with check(false)` — direct table
  updates to `sales` are blocked entirely by design (see oakland_sales_module.sql),
  so this has to be a SECURITY DEFINER RPC like every other sales mutation.

2. Scope — deliberately narrow
- Editable: customer name/phone/type, vehicle reg/model, payment method/status/
  amount paid (balance is recomputed from the sale's existing, unchanged total),
  payment reference (+ its timestamp), change in days, sale date, notes.
- NOT editable here: line items, quantity, unit prices, discount, labour, or the
  totals derived from them, and not the job-card link. Those all have stock or
  cross-record consequences that a plain field edit can't safely carry — void
  and recreate the sale (already supported) is the correct path for those.
- Blocked entirely on a VOIDED sale — its void is itself the historical record.

3. Access
- Gated on `has_permission('settings.manage')`, the same admin-only gate used
  for every other "this needs an administrator" action in the app (record
  purge, vehicle purge, PO editing) — consistent with that existing convention.
*/

create or replace function public.edit_sale(
  p_sale_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_type text,
  p_vehicle_reg text,
  p_vehicle_model text,
  p_payment_method text,
  p_payment_status text,
  p_amount_paid_minor integer,
  p_payment_reference text,
  p_payment_reference_at timestamptz,
  p_change_in_days integer,
  p_sale_date timestamptz,
  p_notes text
) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_before jsonb;
  v_customer_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_reference text := nullif(trim(coalesce(p_payment_reference, '')), '');
begin
  if not public.has_permission('settings.manage') then raise exception 'Not authorized to edit sales'; end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'VOIDED' then raise exception 'Cannot edit a voided sale'; end if;

  if v_customer_name is null then raise exception 'Customer name is required'; end if;
  if p_customer_type not in ('WALK_IN','VEHICLE_OWNER','BUSINESS','GARAGE_WORKSHOP','OTHER') then raise exception 'Invalid customer type'; end if;
  if p_payment_method not in ('CASH','MPESA','BANK','CARD','CREDIT','JOB_CARD','OTHER') then raise exception 'Invalid payment method'; end if;
  if p_payment_status not in ('PAID','PARTIAL','PENDING') then raise exception 'Invalid payment status'; end if;
  if coalesce(p_amount_paid_minor, 0) < 0 or coalesce(p_amount_paid_minor, 0) > v_sale.total_minor then raise exception 'Amount paid must be between 0 and the sale total'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in days cannot be negative'; end if;
  if v_phone is not null and v_phone !~ '^[+0-9][0-9 .()-]{5,24}$' then raise exception 'Customer phone is invalid'; end if;
  if p_payment_method = 'MPESA' and v_reference is null then raise exception 'M-Pesa transaction code is required'; end if;

  v_before := to_jsonb(v_sale);

  update public.sales set
    customer_name = v_customer_name,
    customer_phone = v_phone,
    customer_type = p_customer_type,
    vehicle_reg = nullif(trim(coalesce(p_vehicle_reg, '')), ''),
    vehicle_model = nullif(trim(coalesce(p_vehicle_model, '')), ''),
    payment_method = p_payment_method,
    payment_status = p_payment_status,
    amount_paid_minor = coalesce(p_amount_paid_minor, 0),
    balance_minor = v_sale.total_minor - coalesce(p_amount_paid_minor, 0),
    payment_reference = v_reference,
    payment_reference_at = p_payment_reference_at,
    change_in_days = coalesce(p_change_in_days, 0),
    sale_date = coalesce(p_sale_date, sale_date),
    notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_sale_id
  returning * into v_sale;

  perform public.log_audit('EDIT_SALE', 'sales', p_sale_id, v_before, to_jsonb(v_sale), null);
  return v_sale;
end; $$;

revoke all on function public.edit_sale(uuid, text, text, text, text, text, text, text, integer, text, timestamptz, integer, timestamptz, text) from public, anon;
grant execute on function public.edit_sale(uuid, text, text, text, text, text, text, text, integer, text, timestamptz, integer, timestamptz, text) to authenticated;
