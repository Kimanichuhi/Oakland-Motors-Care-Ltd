/*
# Sales: match the paper Spares Sales Day Book format

The physical day book Oakland already uses has columns this table never captured:
Change in days (the same backdating convention the scrap module uses), Vehicle +
Vehicle model, a Labour/Service charge alongside spares, a Job Card No. reference,
Remarks, and — per item — a manually-counted "remaining stock at shelves" next to
the system's own remaining stock, for reconciliation. Two real gaps also existed:
customer_name was a column nobody ever populated (the manual sale form always sent
null), and there was no way to link a manually-created sale to a job card at all
(only the auto-generated per-part-issue sales got that link).

- sales: + vehicle_reg, vehicle_model, change_in_days, labour_minor, notes,
  job_card_id gains a real write path from complete_sale (the column already
  existed for the auto-generated job-card flow; this is the first migration that
  lets a *manual* sale set it too, for the same "which job is this for" reference
  the day book records — void_sale's existing "generated from a job card" guard
  applies here too, which is the right call: a sale tied to a job shouldn't be
  voided in isolation from that job's own reconciliation either way).
- sale_items: + shelf_count_at_sale (manual physical count, nullable — most sales
  won't bother recording it) and system_stock_after (auto-snapshotted from the
  same v_new the stock_movements row already uses, so it reflects what the system
  actually showed immediately after this specific sale, not current live stock).
- complete_sale gains six new trailing optional parameters and now requires
  customer_name. Old callers passing null/empty customer_name will start failing
  loudly instead of silently saving an unattributed sale — that's intentional;
  every row in the day book has a name in it.
*/

alter table public.sales add column if not exists vehicle_reg text;
alter table public.sales add column if not exists vehicle_model text;
alter table public.sales add column if not exists change_in_days integer not null default 0 check (change_in_days >= 0);
alter table public.sales add column if not exists labour_minor integer not null default 0 check (labour_minor >= 0);
alter table public.sales add column if not exists notes text;

alter table public.sale_items add column if not exists shelf_count_at_sale integer;
alter table public.sale_items add column if not exists system_stock_after integer;

drop function if exists public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb, text, timestamptz, uuid);

create or replace function public.complete_sale(
  p_customer_name text,
  p_customer_phone text,
  p_customer_type text,
  p_payment_method text,
  p_payment_status text,
  p_sale_date timestamptz,
  p_discount_minor integer,
  p_amount_paid_minor integer,
  p_items jsonb,
  p_payment_reference text default null,
  p_payment_reference_at timestamptz default null,
  p_technician_id uuid default null,
  p_vehicle_reg text default null,
  p_vehicle_model text default null,
  p_change_in_days integer default 0,
  p_labour_minor integer default 0,
  p_notes text default null,
  p_job_card_id uuid default null
) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_agg record;
  v_part public.parts%rowtype;
  v_quantity integer;
  v_unit_price integer;
  v_shelf_count integer;
  v_line_total integer;
  v_spares_subtotal integer := 0;
  v_total integer;
  v_sale_number text;
  v_salesperson_name text;
  v_technician_name text;
  v_customer_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_reference text := nullif(trim(coalesce(p_payment_reference, '')), '');
  v_previous integer;
  v_new integer;
begin
  if not public.has_permission('sales.create') then raise exception 'Not authorized to create sales'; end if;
  if v_customer_name is null then raise exception 'Customer name is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Sale must contain at least one item'; end if;
  if coalesce(p_discount_minor, 0) < 0 then raise exception 'Discount cannot be negative'; end if;
  if coalesce(p_amount_paid_minor, 0) < 0 then raise exception 'Amount paid cannot be negative'; end if;
  if coalesce(p_labour_minor, 0) < 0 then raise exception 'Labour/service amount cannot be negative'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in days cannot be negative'; end if;
  if v_phone is not null and v_phone !~ '^[+0-9][0-9 .()-]{5,24}$' then raise exception 'Customer phone is invalid'; end if;
  if p_customer_type not in ('WALK_IN','VEHICLE_OWNER','BUSINESS','GARAGE_WORKSHOP','OTHER') then raise exception 'Invalid customer type'; end if;
  if p_payment_method not in ('CASH','MPESA','BANK','CARD','CREDIT','JOB_CARD','OTHER') then raise exception 'Invalid payment method'; end if;
  if p_payment_status not in ('PAID','PARTIAL','PENDING') then raise exception 'Invalid payment status'; end if;
  if p_payment_method = 'MPESA' and v_reference is null then raise exception 'M-Pesa transaction code is required'; end if;
  if p_payment_method = 'MPESA' and p_payment_reference_at is null then raise exception 'M-Pesa transaction time is required'; end if;
  if p_customer_type = 'GARAGE_WORKSHOP' and p_technician_id is null then raise exception 'Select the technician who is making this purchase'; end if;
  if p_job_card_id is not null and not exists(select 1 from public.job_cards where id = p_job_card_id) then raise exception 'Work order not found'; end if;

  if p_technician_id is not null then
    select full_name into v_technician_name from public.employees where id = p_technician_id;
    if v_technician_name is null then raise exception 'Selected technician not found'; end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    v_unit_price := nullif(v_item->>'unit_price_minor', '')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'Unit price cannot be negative'; end if;
    select * into v_part from public.parts where id = (v_item->>'part_id')::uuid and active = true;
    if not found then raise exception 'Item does not exist'; end if;
    if v_unit_price <> v_part.selling_price_minor and not public.has_permission('sales.price.override') then
      raise exception 'Not authorized to change selling price';
    end if;
    if v_unit_price = 0 and not public.has_permission('sales.price.override') then
      raise exception 'This item has no selling price set — set a price on the part before selling it.';
    end if;
    v_spares_subtotal := v_spares_subtotal + (v_quantity * v_unit_price);
  end loop;

  for v_agg in
    select (i->>'part_id')::uuid as part_id, sum((i->>'quantity')::integer) as total_qty
    from jsonb_array_elements(p_items) as i
    group by (i->>'part_id')::uuid
  loop
    select * into v_part from public.parts where id = v_agg.part_id for update;
    if v_agg.total_qty > v_part.quantity_on_hand then
      raise exception 'Insufficient stock. Only % pieces available.', v_part.quantity_on_hand;
    end if;
  end loop;

  v_total := greatest(v_spares_subtotal - coalesce(p_discount_minor, 0), 0) + coalesce(p_labour_minor, 0);
  if coalesce(p_amount_paid_minor, 0) > v_total then raise exception 'Amount paid cannot exceed grand total'; end if;
  select coalesce(pr.full_name, au.email, 'Staff') into v_salesperson_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  v_sale_number := public.generate_sale_number();

  insert into public.sales(
    sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name,
    payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor,
    payment_reference, payment_reference_at, technician_id, technician_name,
    vehicle_reg, vehicle_model, change_in_days, labour_minor, notes, job_card_id
  )
  values (
    v_sale_number, coalesce(p_sale_date, now()), v_customer_name, v_phone, p_customer_type, auth.uid(), v_salesperson_name,
    p_payment_method, p_payment_status, v_spares_subtotal, coalesce(p_discount_minor, 0), v_total, coalesce(p_amount_paid_minor, 0), v_total - coalesce(p_amount_paid_minor, 0),
    v_reference, p_payment_reference_at, p_technician_id, v_technician_name,
    nullif(trim(coalesce(p_vehicle_reg, '')), ''), nullif(trim(coalesce(p_vehicle_model, '')), ''), coalesce(p_change_in_days, 0), coalesce(p_labour_minor, 0), nullif(trim(coalesce(p_notes, '')), ''), p_job_card_id
  )
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price_minor')::integer;
    v_shelf_count := nullif(v_item->>'shelf_count', '')::integer;
    select * into v_part from public.parts where id = (v_item->>'part_id')::uuid for update;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous - v_quantity;
    v_line_total := v_quantity * v_unit_price;

    update public.parts set quantity_on_hand = v_new where id = v_part.id;
    insert into public.sale_items(sale_id, part_id, part_name, part_sku, category, quantity, unit_price_minor, line_total_minor, shelf_count_at_sale, system_stock_after)
    values (v_sale.id, v_part.id, v_part.name, v_part.sku, v_part.category, v_quantity, v_unit_price, v_line_total, v_shelf_count, v_new);
    insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
    values (v_part.id, 'SALE', -v_quantity, v_previous, v_new, v_unit_price, 'Spare parts sale', v_sale.sale_number, v_sale.id);
  end loop;

  perform public.notify_by_permission(
    'sales.view',
    'New sale: ' || v_sale.sale_number,
    coalesce(v_sale.customer_name, 'Walk-in customer') || ' — KES ' || to_char(v_total / 100.0, 'FM999,999,999.00') || ' via ' || p_payment_method || ', recorded by ' || v_salesperson_name || '.',
    'INFO',
    auth.uid()
  );

  perform public.log_audit('COMPLETE_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('item_count', jsonb_array_length(p_items)));
  return v_sale;
end; $$;
revoke all on function public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb, text, timestamptz, uuid, text, text, integer, integer, text, uuid) from public, anon;
grant execute on function public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb, text, timestamptz, uuid, text, text, integer, integer, text, uuid) to authenticated;
