/*
# Oakland Motor Care Ltd — a focused way to settle a credit/partial sale's debt

1. Problem
- A sale with an open balance (payment_status PARTIAL/PENDING, or payment_method
  CREDIT) had no dedicated way to record that the customer paid it off, in full
  or in part. The only path was "Edit sale" (SaleDetail.tsx), which is gated on
  `settings.manage` — an administrator-only permission — and bundles the payment
  fields together with customer name, vehicle, sale date and other unrelated
  record-keeping fields. Staff who take counter payments (payment.create,
  already used for invoice payments and general receipts) had no way to settle
  a sale's debt at all.

2. Fix
- `record_sale_payment`: a narrow, additive RPC — takes only an amount, method,
  and optional reference/reference time, and adds that amount on top of the
  sale's existing amount_paid_minor (never lets a caller set amount_paid_minor
  to an arbitrary value the way edit_sale's admin form does). Recomputes
  balance_minor and payment_status from the result; once balance reaches 0,
  payment_status becomes PAID — which is what already makes a sale disappear
  from the Debt module's live query (`salesDebt.ts`'s `balance_minor > 0`
  filter) and read as settled everywhere else that reads `sales` directly
  (Sales tab, exports).
- Gated on `payment.create`, matching `record_payment`'s gate for invoices —
  a routine counter action, not an admin-only correction.
- Refuses: a voided sale (nothing to collect), a sale with no outstanding
  balance, an amount that isn't positive, or a payment that would overpay past
  the current balance (use the "Full payment" option in the UI for the exact
  remaining amount instead of guessing it).
- payment_method is overwritten with the method actually used to settle the
  debt (e.g. a CREDIT sale paid off in cash becomes payment_method CASH) —
  there's no separate payments ledger for `sales` the way invoices have, so
  the sale's own payment_method is the only place that fact can live, same as
  edit_sale already treats it.
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

  perform public.log_audit('RECORD_SALE_PAYMENT', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('amount_minor', p_amount_minor, 'method', p_method));
  return v_sale;
end; $$;

revoke all on function public.record_sale_payment(uuid, integer, text, text, timestamptz) from public, anon;
grant execute on function public.record_sale_payment(uuid, integer, text, text, timestamptz) to authenticated;
