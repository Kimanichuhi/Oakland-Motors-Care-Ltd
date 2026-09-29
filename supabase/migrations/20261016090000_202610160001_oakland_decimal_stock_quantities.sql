/*
# Oakland Motor Care Ltd — decimal stock quantities

1. Problem being fixed
- Paint-shop consumables are sold by part of a unit in the Spares Sales Day
  Book: half a kilo of newspaper (0.5), half or one-and-a-half sheets of
  sandpaper (0.5 / 1.5), even a sixth of a sheet (0.16666667). Every stock
  and sale quantity was an integer, so those sales could not be recorded at
  all, and the day's totals never matched the book.

2. Fix
- parts.quantity_on_hand, stock_movements and stock_adjustments quantities/
  balances, and sale_items quantity / returned_quantity / shelf_count_at_sale
  / system_stock_after become numeric(12,4). Four decimal places keeps a
  sixth of a unit within a cent of the book's line total (0.1667 × 300 = 50.01).
- Every function that copies quantity_on_hand into a local variable is
  redefined with numeric variables. Assigning a numeric to a plpgsql integer
  rounds silently, so without this 27.5 on hand would become 28.
- complete_sale accepts decimal item quantities and rounds each line total
  to whole cents.
- adjust_stock takes a numeric quantity so a physical count of 27.5 can be
  reconciled exactly.

3. Unchanged
- Receiving stock, purchase orders, goods receipts and work-order parts stay
  in whole units (their columns and function signatures are untouched);
  whole numbers work unchanged against the new numeric stock.
- Existing data converts losslessly (integer → numeric).
*/

-- A trigger listing quantity_on_hand in UPDATE OF blocks the type change.
drop trigger if exists parts_low_stock_notify on public.parts;

alter table public.parts alter column quantity_on_hand type numeric(12,4);

alter table public.stock_movements
  alter column quantity type numeric(12,4),
  alter column previous_balance type numeric(12,4),
  alter column new_balance type numeric(12,4);

alter table public.stock_adjustments
  alter column quantity type numeric(12,4),
  alter column previous_balance type numeric(12,4),
  alter column new_balance type numeric(12,4);

alter table public.sale_items
  alter column quantity type numeric(12,4),
  alter column returned_quantity type numeric(12,4),
  alter column shelf_count_at_sale type numeric(12,4),
  alter column system_stock_after type numeric(12,4);

create trigger parts_low_stock_notify after update of quantity_on_hand, reorder_level on public.parts for each row execute function public.notify_low_stock();

-- complete_sale: decimal item quantities, line totals rounded to whole cents.
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
  v_quantity numeric;
  v_unit_price integer;
  v_shelf_count numeric;
  v_line_total integer;
  v_spares_subtotal integer := 0;
  v_total integer;
  v_sale_number text;
  v_salesperson_name text;
  v_technician_name text;
  v_customer_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_reference text := nullif(trim(coalesce(p_payment_reference, '')), '');
  v_previous numeric;
  v_new numeric;
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
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
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
    v_spares_subtotal := v_spares_subtotal + round(v_quantity * v_unit_price)::integer;
  end loop;

  for v_agg in
    select (i->>'part_id')::uuid as part_id, sum((i->>'quantity')::numeric) as total_qty
    from jsonb_array_elements(p_items) as i
    group by (i->>'part_id')::uuid
  loop
    select * into v_part from public.parts where id = v_agg.part_id for update;
    if v_agg.total_qty > v_part.quantity_on_hand then
      raise exception 'Insufficient stock. Only % pieces available.', trim_scale(v_part.quantity_on_hand);
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
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price_minor')::integer;
    v_shelf_count := nullif(v_item->>'shelf_count', '')::numeric;
    select * into v_part from public.parts where id = (v_item->>'part_id')::uuid for update;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous - v_quantity;
    v_line_total := round(v_quantity * v_unit_price)::integer;

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

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_part public.parts%rowtype;
  v_previous numeric;
  v_new numeric;
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

  update public.sales set status = 'VOIDED', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), payment_status = 'PENDING', balance_minor = 0
  where id = p_sale_id returning * into v_sale;
  perform public.log_audit('VOID_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('reason', p_reason));
  return v_sale;
end; $$;

-- adjust_stock: numeric quantity, so a count of 27.5 reconciles exactly.
drop function if exists public.adjust_stock(uuid, text, integer, text);
create or replace function public.adjust_stock(p_part_id uuid, p_adjustment_type text, p_quantity numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous numeric; v_new numeric; v_movement_id uuid; v_delta numeric; v_actor_name text;
begin
  if not public.has_permission('inventory.adjust') then raise exception 'Not authorized to adjust stock'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_adjustment_type not in ('ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE') then raise exception 'Invalid adjustment type'; end if;
  select * into v_part from public.parts where id = p_part_id for update;
  if not found then raise exception 'Part not found'; end if;
  v_previous := v_part.quantity_on_hand;
  v_delta := case when p_adjustment_type = 'ADJUSTMENT_IN' then p_quantity else -p_quantity end;
  v_new := v_previous + v_delta;
  if v_new < 0 then raise exception 'Adjustment would result in negative stock'; end if;
  update public.parts set quantity_on_hand = v_new where id = p_part_id;
  insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, reason, reference)
  values (p_part_id, p_adjustment_type, v_delta, v_previous, v_new, p_reason, 'Stock adjustment')
  returning id into v_movement_id;
  insert into public.stock_adjustments(part_id, adjustment_type, quantity, reason, previous_balance, new_balance)
  values (p_part_id, p_adjustment_type, p_quantity, p_reason, v_previous, v_new);
  perform public.log_audit('ADJUST_STOCK', 'parts', p_part_id, jsonb_build_object('quantity_on_hand', v_previous), jsonb_build_object('quantity_on_hand', v_new), jsonb_build_object('type', p_adjustment_type, 'quantity', p_quantity));

  select coalesce(pr.full_name, au.email, 'A staff member') into v_actor_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  perform public.notify_admins(
    'Stock adjustment: ' || v_part.name,
    v_actor_name || ' ' || (case p_adjustment_type when 'ADJUSTMENT_IN' then 'added' when 'ADJUSTMENT_OUT' then 'removed' else 'recorded damage/loss of' end)
      || ' ' || trim_scale(p_quantity) || ' unit(s) of ' || v_part.name || ' (' || trim_scale(v_previous) || ' -> ' || trim_scale(v_new) || '). Reason: ' || p_reason,
    'WARNING',
    auth.uid()
  );

  return v_movement_id;
end; $$;
revoke all on function public.adjust_stock(uuid, text, numeric, text) from public, anon;
grant execute on function public.adjust_stock(uuid, text, numeric, text) to authenticated;

create or replace function public.receive_stock(p_part_id uuid, p_quantity integer, p_unit_cost_minor integer, p_reference text, p_reference_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous numeric; v_new numeric; v_movement_id uuid;
begin
  if not public.has_permission('inventory.receive') then raise exception 'Not authorized to receive stock'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into v_part from public.parts where id = p_part_id for update;
  if not found then raise exception 'Part not found'; end if;
  v_previous := v_part.quantity_on_hand;
  v_new := v_previous + p_quantity;
  update public.parts set quantity_on_hand = v_new, cost_price_minor = case when p_unit_cost_minor > 0 then p_unit_cost_minor else v_part.cost_price_minor end where id = p_part_id;
  insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
  values (p_part_id, 'PURCHASE', p_quantity, v_previous, v_new, p_unit_cost_minor, 'Goods received', p_reference, p_reference_id)
  returning id into v_movement_id;
  perform public.log_audit('RECEIVE_STOCK', 'parts', p_part_id, jsonb_build_object('quantity_on_hand', v_previous), jsonb_build_object('quantity_on_hand', v_new), jsonb_build_object('reference', p_reference, 'quantity', p_quantity));
  return v_movement_id;
end; $$;

create or replace function public.issue_stock(p_part_id uuid, p_quantity integer, p_reference text, p_job_card_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous numeric; v_new numeric; v_line_id uuid;
begin
  if not public.has_permission('inventory.issue') then raise exception 'Not authorized to issue stock'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into v_part from public.parts where id = p_part_id for update;
  if not found then raise exception 'Part not found'; end if;
  v_previous := v_part.quantity_on_hand;
  v_new := v_previous - p_quantity;
  if v_new < 0 then raise exception 'Insufficient stock available'; end if;
  update public.parts set quantity_on_hand = v_new where id = p_part_id;
  insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
  values (p_part_id, 'JOB_CARD_USAGE', -p_quantity, v_previous, v_new, v_part.selling_price_minor, 'Issued to job', p_reference, p_job_card_id);
  insert into public.job_card_parts(job_card_id, part_id, quantity, unit_price_minor, issued_at)
  values (p_job_card_id, p_part_id, p_quantity, v_part.selling_price_minor, now())
  returning id into v_line_id;
  perform public.log_audit('ISSUE_STOCK', 'parts', p_part_id, jsonb_build_object('quantity_on_hand', v_previous), jsonb_build_object('quantity_on_hand', v_new), jsonb_build_object('reference', p_reference, 'quantity', p_quantity));
  return v_line_id;
end; $$;

create or replace function public.issue_pending_job_card_parts(p_job_card_id uuid, p_reference text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line_id uuid; v_part_id uuid; v_quantity integer; v_unit_price_minor integer;
  v_part public.parts%rowtype;
  v_previous numeric;
  v_new numeric;
  v_job public.job_cards%rowtype;
  v_customer public.customers%rowtype;
  v_sale public.sales%rowtype;
  v_sale_number text;
  v_salesperson_name text;
  v_line_total integer;
  v_part_name text; v_part_sku text; v_part_category text;
begin
  select * into v_job from public.job_cards where id = p_job_card_id;
  select * into v_customer from public.customers where id = v_job.customer_id;
  select coalesce(pr.full_name, au.email, 'Staff') into v_salesperson_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  for v_line_id, v_part_id, v_quantity, v_unit_price_minor in
    select id, part_id, quantity, unit_price_minor from public.job_card_parts
    where job_card_id = p_job_card_id and issued_at is null
    order by part_id
  loop
    select * into v_part from public.parts where id = v_part_id for update;
    if not found then raise exception 'Part not found for a pending job card line'; end if;
    v_part_name := v_part.name; v_part_sku := v_part.sku; v_part_category := v_part.category;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous - v_quantity;
    if v_new < 0 then raise exception 'Insufficient stock for %. Only % available.', v_part_name, trim_scale(v_previous); end if;

    update public.parts set quantity_on_hand = v_new where id = v_part_id;
    insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
    values (v_part_id, 'JOB_CARD_USAGE', -v_quantity, v_previous, v_new, v_unit_price_minor, 'Issued to job', p_reference, p_job_card_id);
    update public.job_card_parts set issued_at = now() where id = v_line_id;

    v_line_total := v_quantity * v_unit_price_minor;
    v_sale_number := public.generate_sale_number();

    insert into public.sales(sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name, payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor, job_card_id)
    values (v_sale_number, now(), v_customer.full_name, v_customer.phone, 'JOB_CARD', auth.uid(), v_salesperson_name, 'JOB_CARD', 'PENDING', v_line_total, 0, v_line_total, 0, v_line_total, p_job_card_id)
    returning * into v_sale;

    insert into public.sale_items(sale_id, part_id, part_name, part_sku, category, quantity, unit_price_minor, line_total_minor)
    values (v_sale.id, v_part_id, v_part_name, v_part_sku, v_part_category, v_quantity, v_unit_price_minor, v_line_total);

    perform public.log_audit('COMPLETE_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('source', 'job_card', 'job_card_id', p_job_card_id));
  end loop;
end; $$;
revoke all on function public.issue_pending_job_card_parts(uuid, text) from public, anon, authenticated;

create or replace function public.notify_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and new.quantity_on_hand <= new.reorder_level and (old.quantity_on_hand > old.reorder_level or old.reorder_level <> new.reorder_level) then
    perform public.notify_by_permission(
      'inventory.view',
      'Low stock: ' || new.name,
      new.name || ' (' || new.sku || ') is at ' || trim_scale(new.quantity_on_hand) || ' unit(s), at or below its reorder level of ' || new.reorder_level || '.',
      'WARNING'
    );
  end if;
  return new;
end; $$;
