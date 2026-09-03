/*
# Oakland Motors M-Pesa reconciliation hardening

Closes gaps in the STK push / callback flow:
1. `mpesa_transactions` now gets a row at STK-push time (not just at callback time),
   so the callback can actually find the invoice it belongs to.
2. A `status` column tracks PENDING / COMPLETED / FAILED / NEEDS_REVIEW so staff can
   see and manually reconcile anything the automatic flow could not settle.
3. `record_mpesa_payment` is a service-role-only counterpart to `record_payment` —
   the Daraja callback runs with no authenticated user (auth.uid() is null), so the
   permission-gated `record_payment` would always reject it. This function performs
   the same accounting but is restricted to the `service_role`, which only the
   `mpesa` edge function (holding the service role key as a secret) can assume.
4. The `staff_insert_mpesa_transactions` policy no longer allows any authenticated
   user to insert arbitrary rows — it now requires `payment.create`, matching the
   other mutation policies on this table.
*/

alter table public.mpesa_transactions
  add column if not exists status text not null default 'PENDING',
  add column if not exists reconciliation_note text;

alter table public.mpesa_transactions drop constraint if exists mpesa_transactions_status_check;
alter table public.mpesa_transactions
  add constraint mpesa_transactions_status_check
  check (status in ('PENDING','COMPLETED','FAILED','NEEDS_REVIEW'));

update public.mpesa_transactions
  set status = case when result_code = 0 then 'COMPLETED' when result_code is not null then 'FAILED' else 'PENDING' end
  where status = 'PENDING';

DROP POLICY IF EXISTS "staff_insert_mpesa_transactions" ON public.mpesa_transactions;
CREATE POLICY "staff_insert_mpesa_transactions" ON public.mpesa_transactions
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('payment.create'));

create or replace function public.record_mpesa_payment(
  p_invoice_id uuid,
  p_amount_minor integer,
  p_reference text,
  p_idempotency_key text,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_invoice public.invoices%rowtype; v_payment_id uuid; v_new_paid integer; v_new_status text;
begin
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_idempotency_key is not null then
    select id into v_payment_id from public.payments where idempotency_key = p_idempotency_key;
    if v_payment_id is not null then return v_payment_id; end if;
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status = 'VOID' then raise exception 'Cannot record payment on void invoice'; end if;
  v_new_paid := v_invoice.amount_paid_minor + p_amount_minor;
  if v_new_paid > v_invoice.total_minor then raise exception 'Payment exceeds outstanding balance'; end if;
  v_new_status := case when v_new_paid = v_invoice.total_minor then 'PAID' when v_new_paid > 0 then 'PART_PAID' else v_invoice.status end;
  insert into public.payments(invoice_id, amount_minor, method, reference, notes, idempotency_key)
  values (p_invoice_id, p_amount_minor, 'MPESA', p_reference, p_notes, p_idempotency_key)
  returning id into v_payment_id;
  update public.invoices set amount_paid_minor = v_new_paid, status = v_new_status where id = p_invoice_id;
  perform public.log_audit('RECORD_PAYMENT', 'invoices', p_invoice_id, jsonb_build_object('amount_paid_minor', v_invoice.amount_paid_minor, 'status', v_invoice.status), jsonb_build_object('amount_paid_minor', v_new_paid, 'status', v_new_status), jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount_minor, 'method', 'MPESA', 'source', 'mpesa_callback'));
  return v_payment_id;
end; $$;

revoke all on function public.record_mpesa_payment(uuid, integer, text, text, text) from public;
grant execute on function public.record_mpesa_payment(uuid, integer, text, text, text) to service_role;
