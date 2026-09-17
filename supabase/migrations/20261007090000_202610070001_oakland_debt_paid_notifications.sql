/*
# Oakland Motor Care Ltd — notify when a debt is actually paid off

1. Problem
- Two of the app's three debt-settling paths never notified anyone:
  - `record_sale_payment` (this project's newest RPC — settles a credit/
    partial sale's debt from Sales > a sale > "Settle debt") had no
    notification call at all.
  - `record_debt_recovery` (Debt Register's manual recovery form) also had
    none — recording a recovery against a staff/customer debt_records entry
    was completely silent.
  - The third path, `record_payment` on invoices (which is what settles a
    job card's debt), already notifies on every payment via
    notify_by_permission('payment.view', ...) — that one's covered and is
    left untouched here.
- Only fires once the debt is actually gone (balance/outstanding reaches
  zero), not on every partial payment — "a debt is paid" reads as the debt
  being settled, not each installment toward it.

2. Fix
- record_sale_payment: redefined (same signature, same body) with one
  addition — when the payment brings the sale to PAID, calls
  notify_by_permission('debt.view', ...) so whoever watches the Debt module
  hears about it, excluding the person who just recorded the payment.
- record_debt_recovery: redefined (same signature, same body) with the same
  addition — fires only when the recovery brings the debt to RECOVERED,
  naming who was responsible and how much was recovered.
*/

create or replace function public.record_sale_payment(
  p_sale_id uuid,
  p_amount_minor integer,
  p_method text,
  p_reference text default null,
  p_reference_at timestamptz default null
)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_new_paid integer;
  v_new_balance integer;
  v_new_status text;
begin
  if not public.has_permission('payment.create') then raise exception 'Not authorized to record payments'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  if p_method not in ('CASH','MPESA','BANK','CARD','OTHER') then raise exception 'Invalid payment method'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'VOIDED' then raise exception 'Cannot record a payment against a voided sale'; end if;
  if v_sale.balance_minor <= 0 then raise exception 'This sale has no outstanding balance'; end if;
  if p_amount_minor > v_sale.balance_minor then raise exception 'Payment of % exceeds the outstanding balance of %', p_amount_minor, v_sale.balance_minor; end if;

  v_new_paid := v_sale.amount_paid_minor + p_amount_minor;
  v_new_balance := v_sale.total_minor - v_new_paid;
  v_new_status := case when v_new_balance <= 0 then 'PAID' else 'PARTIAL' end;

  update public.sales set
    amount_paid_minor = v_new_paid,
    balance_minor = greatest(0, v_new_balance),
    payment_status = v_new_status,
    payment_method = p_method,
    payment_reference = coalesce(nullif(trim(coalesce(p_reference, '')), ''), payment_reference),
    payment_reference_at = coalesce(p_reference_at, payment_reference_at)
  where id = p_sale_id
  returning * into v_sale;

  if v_new_status = 'PAID' then
    perform public.notify_by_permission(
      'debt.view',
      'Debt paid: ' || v_sale.sale_number,
      'Sale ' || v_sale.sale_number || ' for ' || coalesce(v_sale.customer_name, 'a customer') || ' is now fully paid (KES ' || to_char(v_sale.total_minor / 100.0, 'FM999,999,999.00') || ' via ' || p_method || ').',
      'INFO',
      auth.uid()
    );
  end if;

  perform public.log_audit('RECORD_SALE_PAYMENT', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('amount_minor', p_amount_minor, 'method', p_method));
  return v_sale;
end; $$;

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

  if v_new_status = 'RECOVERED' then
    perform public.notify_by_permission(
      'debt.view',
      'Debt paid: ' || v_after.responsible_name,
      (case when v_after.debt_type = 'STAFF' then 'Staff liability' else 'Customer debt' end) || ' owed by ' || v_after.responsible_name || ' (' || v_after.item_description || ', KES ' || to_char(v_after.amount_minor / 100.0, 'FM999,999,999.00') || ') is now fully recovered.',
      'INFO',
      auth.uid()
    );
  end if;

  perform public.log_audit('RECORD_DEBT_RECOVERY', 'debt_records', p_debt_id, to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('recovery_amount_minor', p_amount_minor, 'notes', p_notes));
  return v_after;
end; $$;
