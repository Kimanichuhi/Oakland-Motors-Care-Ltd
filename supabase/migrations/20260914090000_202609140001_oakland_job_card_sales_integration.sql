/*
# Oakland Motor Care Ltd — job card parts show up as normal sales

Parts issued to a job card (job_card_parts, deducted from stock the moment the
job moves to IN_PROGRESS via issue_pending_job_card_parts) never created a row
in the Sales module — a job card's parts revenue was invisible next to walk-in
sales/reports. Every batch of parts issued to a job card now also creates a
normal `sales` + `sale_items` record, through the exact same tables and the
exact same shape as a manually-recorded sale — nothing is displayed specially,
it just shows up in Sales like any other sale.

- `sales.job_card_id` links an auto-generated sale back to its work order.
- `customer_type` gains 'JOB_CARD' alongside the existing values (nothing is
  removed — historical VEHICLE_OWNER/BUSINESS/OTHER rows stay valid).
- The new sale is customer_type='JOB_CARD', payment_method='JOB_CARD',
  payment_status='PENDING' (the job card's own invoice/payment flow settles it
  later — this sale record exists for visibility/reporting, not billing).
- Stock is NOT deducted again and no second stock_movements row is written —
  issue_pending_job_card_parts already does both; this only adds the sales
  bookkeeping on top, from the very batch of lines it just issued.
- void_sale now refuses to void a job-card-sourced sale: job_card_parts has no
  "un-issue" path once issued_at is set (remove_job_card_part already refuses
  that), so voiding here would restore stock while the job card still shows the
  part as fitted — an inconsistent state. Reversing a job card's parts usage is
  a job-card-side concern, not a Sales-module one.
*/

alter table public.sales add column if not exists job_card_id uuid references public.job_cards(id);

alter table public.sales drop constraint if exists sales_customer_type_check;
alter table public.sales add constraint sales_customer_type_check
  check (customer_type in ('WALK_IN','VEHICLE_OWNER','BUSINESS','GARAGE_WORKSHOP','OTHER','JOB_CARD'));

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
  v_subtotal integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_job from public.job_cards where id = p_job_card_id;

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

    v_subtotal := v_subtotal + (v_line.quantity * v_line.unit_price_minor);
    v_items := v_items || jsonb_build_object(
      'part_id', v_line.part_id, 'part_name', v_line.part_name, 'part_sku', v_line.part_sku,
      'category', v_line.part_category, 'quantity', v_line.quantity, 'unit_price_minor', v_line.unit_price_minor,
      'line_total_minor', v_line.quantity * v_line.unit_price_minor
    );
  end loop;

  if jsonb_array_length(v_items) > 0 then
    select * into v_customer from public.customers where id = v_job.customer_id;
    select coalesce(pr.full_name, au.email, 'Staff') into v_salesperson_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
    v_sale_number := public.generate_sale_number();

    insert into public.sales(sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name, payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor, job_card_id)
    values (v_sale_number, now(), v_customer.full_name, v_customer.phone, 'JOB_CARD', auth.uid(), v_salesperson_name, 'JOB_CARD', 'PENDING', v_subtotal, 0, v_subtotal, 0, v_subtotal, p_job_card_id)
    returning * into v_sale;

    insert into public.sale_items(sale_id, part_id, part_name, part_sku, category, quantity, unit_price_minor, line_total_minor)
    select v_sale.id, (i->>'part_id')::uuid, i->>'part_name', i->>'part_sku', i->>'category', (i->>'quantity')::integer, (i->>'unit_price_minor')::integer, (i->>'line_total_minor')::integer
    from jsonb_array_elements(v_items) as i;

    perform public.log_audit('COMPLETE_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('source', 'job_card', 'job_card_id', p_job_card_id));
  end if;
end; $$;
revoke all on function public.issue_pending_job_card_parts(uuid, text) from public, anon, authenticated;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_part public.parts%rowtype;
  v_previous integer;
  v_new integer;
begin
  if not public.has_permission('sales.void') then raise exception 'Not authorized to void sales'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'VOIDED' then return v_sale; end if;
  if v_sale.status <> 'COMPLETED' then raise exception 'Only completed sales can be voided in this release'; end if;
  if v_sale.job_card_id is not null then raise exception 'This sale was generated from a job card and cannot be voided here — reverse it from the work order instead'; end if;

  for v_item in select * from public.sale_items where sale_id = p_sale_id loop
    select * into v_part from public.parts where id = v_item.part_id for update;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous + v_item.quantity;
    update public.parts set quantity_on_hand = v_new where id = v_part.id;
    update public.sale_items set returned_quantity = quantity where id = v_item.id;
    insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
    values (v_part.id, 'SALE_REVERSAL', v_item.quantity, v_previous, v_new, v_item.unit_price_minor, coalesce(p_reason, 'Sale voided'), v_sale.sale_number, v_sale.id);
  end loop;

  update public.sales set status = 'VOIDED', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), payment_status = 'PENDING', balance_minor = total_minor
  where id = p_sale_id returning * into v_sale;
  perform public.log_audit('VOID_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('reason', p_reason));
  return v_sale;
end; $$;
