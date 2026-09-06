/*
# Oakland Motor Care Ltd — fixes from the whole-app correctness audit

Bundles the database-level fixes from a full-codebase correctness audit. Each
section is independent; see the inline comment above each for the bug it closes.
*/

-- ── 1. issue_pending_job_card_parts: lock the parts row, not just the job_card_parts
-- row, closing a lost-update race where two concurrent IN_PROGRESS transitions on
-- different job cards sharing a part could both read the same stale quantity_on_hand.
create or replace function public.issue_pending_job_card_parts(p_job_card_id uuid, p_reference text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line_id uuid; v_part_id uuid; v_quantity integer; v_unit_price_minor integer;
  v_part public.parts%rowtype;
  v_previous integer;
  v_new integer;
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
    if v_new < 0 then raise exception 'Insufficient stock for %. Only % available.', v_part_name, v_previous; end if;

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

-- ── 2. add_job_card_part: issue a part immediately if it's added to a job that's
-- already IN_PROGRESS. IN_PROGRESS never transitions back through the OPEN edge that
-- issue_pending_job_card_parts is hooked to, so a part added after that point used to
-- stay "Pending" forever — billed in the UI's totals but never deducted from stock or
-- reflected in Sales. Also blocks adding parts to a job that's already finished.
create or replace function public.add_job_card_part(p_job_card_id uuid, p_part_id uuid, p_quantity integer)
returns public.job_card_parts
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_line public.job_card_parts%rowtype; v_job public.job_cards%rowtype;
begin
  if not public.has_permission('inventory.issue') then raise exception 'Not authorized to add parts to a job card'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  select * into v_job from public.job_cards where id = p_job_card_id;
  if not found then raise exception 'Job card not found'; end if;
  if v_job.status in ('COMPLETED', 'CANCELLED') then raise exception 'Cannot add parts to a % job card', v_job.status; end if;

  select * into v_part from public.parts where id = p_part_id and active = true;
  if not found then raise exception 'Part not found or inactive'; end if;
  if p_quantity > v_part.quantity_on_hand then
    raise exception 'Insufficient stock. Only % units are available.', v_part.quantity_on_hand;
  end if;

  insert into public.job_card_parts(job_card_id, part_id, quantity, unit_price_minor, issued_at)
  values (p_job_card_id, p_part_id, p_quantity, v_part.selling_price_minor, null)
  returning * into v_line;

  perform public.log_audit('ADD_JOB_CARD_PART', 'job_card_parts', v_line.id, null, to_jsonb(v_line));

  if v_job.status = 'IN_PROGRESS' then
    perform public.issue_pending_job_card_parts(p_job_card_id, v_job.job_number);
    select * into v_line from public.job_card_parts where id = v_line.id;
  end if;

  return v_line;
end; $$;

-- ── 3. record_payment cross-contamination: a job card could have more than one
-- non-void invoice, and record_payment's "propagate to this job card's sales" update
-- was keyed only on job_card_id — paying invoice A could mark invoice B's sale as
-- paid using invoice A's totals. Enforcing at most one active invoice per job card
-- removes the ambiguity structurally instead of trying to patch the propagation logic.
-- A voided invoice doesn't count, so a corrected/reissued invoice is still possible.
-- If this fails with a duplicate-key error, some job card already has more than one
-- non-void invoice today — void the extra one(s) first (this migration won't guess
-- which invoice to keep), then re-run.
create unique index if not exists invoices_one_active_per_job_card
  on public.invoices(job_card_id) where job_card_id is not null and status <> 'VOID';

-- ── 4. scrap_void_purchase: guard against taking a cycle's stock negative instead of
-- letting the raw CHECK constraint abort with an unreadable error.
create or replace function public.scrap_void_purchase(p_id uuid, p_reason text)
returns public.scrap_purchases
language plpgsql security definer set search_path = public as $$
declare v_purchase public.scrap_purchases%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to void scrap purchases'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to void a purchase'; end if;
  select * into v_purchase from public.scrap_purchases where id = p_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_purchase.status = 'VOID' then return v_purchase; end if;

  update public.stock_cycles set current_quantity = current_quantity - v_purchase.quantity_purchased
  where id = v_purchase.stock_cycle_id and current_quantity >= v_purchase.quantity_purchased;
  if not found then
    raise exception 'Cannot void this purchase — this cycle''s stock has already been used or cleared below the % kg purchased.', v_purchase.quantity_purchased;
  end if;

  update public.scrap_purchases set status = 'VOID', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_purchase;

  perform public.scrap_recompute_cash_from(v_purchase.date);
  perform public.log_audit('VOID_SCRAP_PURCHASE', 'scrap_purchases', p_id, null, to_jsonb(v_purchase), jsonb_build_object('reason', p_reason));
  return v_purchase;
end; $$;

-- ── 5. complete_sale: validate stock against the *sum* of quantities per part_id,
-- not each line independently — two lines for the same part could each individually
-- pass a check against the same starting quantity_on_hand and still oversell in the
-- mutation loop. Also blocks a $0 catalog price from going out without price-override.
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
  p_payment_reference_at timestamptz default null
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

  insert into public.sales(sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name, payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor, payment_reference, payment_reference_at)
  values (v_sale_number, coalesce(p_sale_date, now()), nullif(trim(coalesce(p_customer_name, '')), ''), v_phone, p_customer_type, auth.uid(), v_salesperson_name, p_payment_method, p_payment_status, v_subtotal, coalesce(p_discount_minor, 0), v_total, coalesce(p_amount_paid_minor, 0), v_total - coalesce(p_amount_paid_minor, 0), v_reference, p_payment_reference_at)
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

  perform public.log_audit('COMPLETE_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('item_count', jsonb_array_length(p_items)));
  return v_sale;
end; $$;

-- ── 6. Generic document numbering for Purchase Orders / Quotations / Invoices,
-- replacing the collision-prone client-side `PREFIX-${year}-${Date.now()...4}`
-- pattern with the same atomic-sequence approach already used for job cards/sales.
create table if not exists public.document_number_counters (
  doc_type text primary key,
  next_seq integer not null default 1
);
alter table public.document_number_counters enable row level security;
-- No policies: purely internal, accessed only by generate_document_number() (SECURITY DEFINER).

create or replace function public.generate_document_number(p_doc_type text, p_prefix text, p_permission text) returns text
language plpgsql security definer set search_path = public as $$
declare v_seq integer;
begin
  if not public.has_permission(p_permission) then raise exception 'Not authorized'; end if;
  insert into public.document_number_counters(doc_type, next_seq) values (p_doc_type, 1) on conflict (doc_type) do nothing;
  update public.document_number_counters set next_seq = next_seq + 1 where doc_type = p_doc_type returning next_seq - 1 into v_seq;
  return p_prefix || '-' || lpad(v_seq::text, 3, '0');
end; $$;
revoke all on function public.generate_document_number(text, text, text) from public, anon;
grant execute on function public.generate_document_number(text, text, text) to authenticated;

-- ── 7. Purchase orders: nothing in the app ever created a purchase_order_items row,
-- so every PO was a supplier-only shell that could never actually be received against.
-- create_purchase_order lets a PO be created with its line items atomically, with
-- total_minor computed from them instead of staying stuck at 0.
create or replace function public.create_purchase_order(p_supplier_id uuid, p_order_date date, p_expected_delivery date, p_items jsonb)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare v_po public.purchase_orders%rowtype; v_item jsonb; v_total integer := 0; v_po_number text; v_qty integer; v_unit_cost integer;
begin
  if not public.has_permission('purchase_order.create') then raise exception 'Not authorized to create purchase orders'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A purchase order must contain at least one item'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := nullif(v_item->>'quantity', '')::integer;
    v_unit_cost := nullif(v_item->>'unit_cost_minor', '')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_unit_cost is null or v_unit_cost < 0 then raise exception 'Unit cost cannot be negative'; end if;
    if not exists(select 1 from public.parts where id = (v_item->>'part_id')::uuid) then raise exception 'Item does not exist'; end if;
    v_total := v_total + (v_qty * v_unit_cost);
  end loop;

  v_po_number := public.generate_document_number('PO', 'PO', 'purchase_order.create');

  insert into public.purchase_orders(po_number, supplier_id, status, order_date, expected_delivery, total_minor)
  values (v_po_number, p_supplier_id, 'DRAFT', coalesce(p_order_date, current_date), p_expected_delivery, v_total)
  returning * into v_po;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := (v_item->>'unit_cost_minor')::integer;
    insert into public.purchase_order_items(purchase_order_id, part_id, quantity_ordered, unit_cost_minor, line_total_minor)
    values (v_po.id, (v_item->>'part_id')::uuid, v_qty, v_unit_cost, v_qty * v_unit_cost);
  end loop;

  perform public.log_audit('CREATE_PURCHASE_ORDER', 'purchase_orders', v_po.id, null, to_jsonb(v_po), jsonb_build_object('item_count', jsonb_array_length(p_items)));
  return v_po;
end; $$;
revoke all on function public.create_purchase_order(uuid, date, date, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, date, jsonb) to authenticated;

-- ── 8. receive_po_item: replaces the client's 3 sequential, non-transactional calls
-- (which raced on a double-click, both correctly adding stock but computing the new
-- quantity_received from the same stale cached value) with one atomic RPC.
create or replace function public.receive_po_item(p_item_id uuid, p_quantity integer, p_unit_cost_minor integer)
returns void
language plpgsql security definer set search_path = public as $$
declare v_item public.purchase_order_items%rowtype; v_po public.purchase_orders%rowtype;
begin
  if not public.has_permission('inventory.receive') then raise exception 'Not authorized to receive stock'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into v_item from public.purchase_order_items where id = p_item_id for update;
  if not found then raise exception 'Purchase order item not found'; end if;
  if v_item.quantity_received + p_quantity > v_item.quantity_ordered then raise exception 'Cannot receive more than the ordered quantity'; end if;
  select * into v_po from public.purchase_orders where id = v_item.purchase_order_id;

  perform public.receive_stock(v_item.part_id, p_quantity, p_unit_cost_minor, v_po.po_number, v_item.purchase_order_id);
  insert into public.goods_receipts(purchase_order_id, part_id, quantity_received, unit_cost_minor)
  values (v_item.purchase_order_id, v_item.part_id, p_quantity, p_unit_cost_minor);
  update public.purchase_order_items set quantity_received = quantity_received + p_quantity where id = p_item_id;
end; $$;
revoke all on function public.receive_po_item(uuid, integer, integer) from public, anon;
grant execute on function public.receive_po_item(uuid, integer, integer) to authenticated;

-- ── 9. Vehicle Register: `time_out > time_in` on plain `time` columns made it
-- impossible to log a Time Out for any vehicle left overnight (e.g. in at 22:00,
-- out at 08:00 the next morning). The date+time_in/time_out model has no way to
-- represent an overnight stay correctly, so the ordering check is dropped rather
-- than replaced with another check that would still misfire on the same case.
do $$
declare v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.vehicle_register'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%time_out%time_in%';
  if v_conname is not null then
    execute format('alter table public.vehicle_register drop constraint %I', v_conname);
  end if;
end $$;
