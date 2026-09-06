/*
# Oakland Motor Care Ltd — one sale per part on a job card, with payment reference propagated

1. Problem being fixed
- issue_pending_job_card_parts grouped every part issued in one job-status
  transition into a single sales row with multiple sale_items. When a work
  order used several different parts, Sales showed one bundled entry instead
  of letting each part be seen, filtered, and reported on individually.
- Once payment against the job card's invoice was recorded (e.g. via M-Pesa),
  the code/reference and the fact that money had actually been received never
  reached the auto-generated job-card sale(s) — they stayed
  payment_reference = null, payment_status = 'PENDING' forever, even though
  the customer had paid.

2. Fix
- issue_pending_job_card_parts now creates one sales row (its own sale_number)
  per part line issued, each still carrying the shared job_card_id, customer,
  and sale_date — so parts from the same work order are easy to tell apart in
  the Sales list/reports while remaining visibly linked to that work order.
- record_payment now propagates onto every sales row sharing the paid
  invoice's job_card_id: the payment reference/time (M-Pesa code included),
  and amount_paid/balance/payment_status recomputed proportionally to that
  sale's share of the invoice total — so a part sale is marked PAID once the
  invoice covering it is fully paid, PARTIAL if only partly paid, and carries
  the M-Pesa code either way.

3. Non-destructive
- No existing rows are touched or backfilled; this only changes what future
  part-issuance and payment recording produce. No table/column changes.
*/

create or replace function public.issue_pending_job_card_parts(p_job_card_id uuid, p_reference text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_previous integer;
  v_new integer;
  v_job public.job_cards%rowtype;
  v_customer public.customers%rowtype;
  v_sale public.sales%rowtype;
  v_sale_number text;
  v_salesperson_name text;
  v_line_total integer;
begin
  select * into v_job from public.job_cards where id = p_job_card_id;
  select * into v_customer from public.customers where id = v_job.customer_id;
  select coalesce(pr.full_name, au.email, 'Staff') into v_salesperson_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  for v_line in
    select jcp.*, p.name as part_name, p.sku as part_sku, p.category as part_category, p.quantity_on_hand
    from public.job_card_parts jcp
    join public.parts p on p.id = jcp.part_id
    where jcp.job_card_id = p_job_card_id and jcp.issued_at is null
    for update of jcp
  loop
    v_previous := v_line.quantity_on_hand;
    v_new := v_previous - v_line.quantity;
    if v_new < 0 then raise exception 'Insufficient stock for %. Only % available.', v_line.part_name, v_previous; end if;

    update public.parts set quantity_on_hand = v_new where id = v_line.part_id;
    insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
    values (v_line.part_id, 'JOB_CARD_USAGE', -v_line.quantity, v_previous, v_new, v_line.unit_price_minor, 'Issued to job', p_reference, p_job_card_id);
    update public.job_card_parts set issued_at = now() where id = v_line.id;

    v_line_total := v_line.quantity * v_line.unit_price_minor;
    v_sale_number := public.generate_sale_number();

    insert into public.sales(sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name, payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor, job_card_id)
    values (v_sale_number, now(), v_customer.full_name, v_customer.phone, 'JOB_CARD', auth.uid(), v_salesperson_name, 'JOB_CARD', 'PENDING', v_line_total, 0, v_line_total, 0, v_line_total, p_job_card_id)
    returning * into v_sale;

    insert into public.sale_items(sale_id, part_id, part_name, part_sku, category, quantity, unit_price_minor, line_total_minor)
    values (v_sale.id, v_line.part_id, v_line.part_name, v_line.part_sku, v_line.part_category, v_line.quantity, v_line.unit_price_minor, v_line_total);

    perform public.log_audit('COMPLETE_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('source', 'job_card', 'job_card_id', p_job_card_id));
  end loop;
end; $$;

create or replace function public.record_payment(p_invoice_id uuid, p_amount_minor integer, p_method text, p_reference text, p_idempotency_key text, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_invoice public.invoices%rowtype; v_payment_id uuid; v_new_paid integer; v_new_status text; v_clean_reference text;
begin
  if not public.has_permission('payment.create') then raise exception 'Not authorized to record payments'; end if;
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
  v_clean_reference := nullif(trim(coalesce(p_reference, '')), '');

  insert into public.payments(invoice_id, amount_minor, method, reference, notes, idempotency_key)
  values (p_invoice_id, p_amount_minor, p_method, p_reference, p_notes, p_idempotency_key)
  returning id into v_payment_id;
  update public.invoices set amount_paid_minor = v_new_paid, status = v_new_status, updated_by = auth.uid() where id = p_invoice_id;

  if v_invoice.job_card_id is not null then
    update public.sales s set
      payment_reference = coalesce(v_clean_reference, s.payment_reference),
      payment_reference_at = case when v_clean_reference is not null then now() else s.payment_reference_at end,
      amount_paid_minor = least(s.total_minor, round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer),
      balance_minor = greatest(s.total_minor - round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer, 0),
      payment_status = case
        when round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer >= s.total_minor then 'PAID'
        when round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer > 0 then 'PARTIAL'
        else 'PENDING' end
    where s.job_card_id = v_invoice.job_card_id;
  end if;

  perform public.log_audit('RECORD_PAYMENT', 'invoices', p_invoice_id, jsonb_build_object('amount_paid_minor', v_invoice.amount_paid_minor, 'status', v_invoice.status), jsonb_build_object('amount_paid_minor', v_new_paid, 'status', v_new_status), jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount_minor, 'method', p_method));
  return v_payment_id;
end; $$;
