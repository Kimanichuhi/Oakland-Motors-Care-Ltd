/*
# Record which technician a garage/workshop sale is made to

Garage-workshop customers (other garages buying parts wholesale/on account) are the
sales most likely to end up as debt, and the counter needs to know which technician
was responsible for the purchase — the same accountability need the Debt Register
was built for. Adds technician_id/technician_name to sales, populated from the
complete_sale RPC (optional for every other customer type, expected for
GARAGE_WORKSHOP — enforced in the UI, not the database, since a technician can be
useful to record on any sale type).

complete_sale's parameter list changes (one new trailing optional param), so the old
11-parameter signature is dropped and replaced rather than CREATE OR REPLACE'd in
place — Postgres treats a different parameter list as a distinct function, and
leaving the old one behind would let stale client code keep calling it.
*/

alter table public.sales add column if not exists technician_id uuid references public.employees(id);
alter table public.sales add column if not exists technician_name text;

drop function if exists public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb, text, timestamptz);

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
  p_technician_id uuid default null
) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_agg record;
  v_part public.parts%rowtype;
  v_quantity integer;
  v_unit_price integer;
  v_line_total integer;
  v_subtotal integer := 0;
  v_total integer;
  v_sale_number text;
  v_salesperson_name text;
  v_technician_name text;
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_reference text := nullif(trim(coalesce(p_payment_reference, '')), '');
  v_previous integer;
  v_new integer;
begin
  if not public.has_permission('sales.create') then raise exception 'Not authorized to create sales'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Sale must contain at least one item'; end if;
  if coalesce(p_discount_minor, 0) < 0 then raise exception 'Discount cannot be negative'; end if;
  if coalesce(p_amount_paid_minor, 0) < 0 then raise exception 'Amount paid cannot be negative'; end if;
  if v_phone is not null and v_phone !~ '^[+0-9][0-9 .()-]{5,24}$' then raise exception 'Customer phone is invalid'; end if;
  if p_customer_type not in ('WALK_IN','VEHICLE_OWNER','BUSINESS','GARAGE_WORKSHOP','OTHER') then raise exception 'Invalid customer type'; end if;
  if p_payment_method not in ('CASH','MPESA','BANK','CARD','CREDIT','JOB_CARD','OTHER') then raise exception 'Invalid payment method'; end if;
  if p_payment_status not in ('PAID','PARTIAL','PENDING') then raise exception 'Invalid payment status'; end if;
  if p_payment_method = 'MPESA' and v_reference is null then raise exception 'M-Pesa transaction code is required'; end if;
  if p_payment_method = 'MPESA' and p_payment_reference_at is null then raise exception 'M-Pesa transaction time is required'; end if;
  if p_customer_type = 'GARAGE_WORKSHOP' and p_technician_id is null then raise exception 'Select the technician who is making this purchase'; end if;

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
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
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

  v_total := greatest(v_subtotal - coalesce(p_discount_minor, 0), 0);
  if coalesce(p_amount_paid_minor, 0) > v_total then raise exception 'Amount paid cannot exceed grand total'; end if;
  select coalesce(pr.full_name, au.email, 'Staff') into v_salesperson_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  v_sale_number := public.generate_sale_number();

  insert into public.sales(sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name, payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor, payment_reference, payment_reference_at, technician_id, technician_name)
  values (v_sale_number, coalesce(p_sale_date, now()), nullif(trim(coalesce(p_customer_name, '')), ''), v_phone, p_customer_type, auth.uid(), v_salesperson_name, p_payment_method, p_payment_status, v_subtotal, coalesce(p_discount_minor, 0), v_total, coalesce(p_amount_paid_minor, 0), v_total - coalesce(p_amount_paid_minor, 0), v_reference, p_payment_reference_at, p_technician_id, v_technician_name)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price_minor')::integer;
    select * into v_part from public.parts where id = (v_item->>'part_id')::uuid for update;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous - v_quantity;
    v_line_total := v_quantity * v_unit_price;

    update public.parts set quantity_on_hand = v_new where id = v_part.id;
    insert into public.sale_items(sale_id, part_id, part_name, part_sku, category, quantity, unit_price_minor, line_total_minor)
    values (v_sale.id, v_part.id, v_part.name, v_part.sku, v_part.category, v_quantity, v_unit_price, v_line_total);
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
revoke all on function public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb, text, timestamptz, uuid) to authenticated;
