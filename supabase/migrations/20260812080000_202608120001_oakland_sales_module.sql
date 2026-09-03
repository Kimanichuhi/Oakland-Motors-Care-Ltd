/*
# Oakland Motor Care Ltd Sales & Spare Parts module

Adds a transactional POS-style sales module on top of the existing `parts` inventory.
Sales are completed through SECURITY DEFINER RPCs so sale creation, sale items, stock
deduction/restoration, stock movements, and audit logs succeed or fail atomically.
*/

-- ── 1. Permission catalogue and role grants ────────────────────────────────
insert into public.permissions(key, label) values
  ('sales.view','View sales'),
  ('sales.create','Create sales'),
  ('sales.void','Void sales and reverse stock'),
  ('sales.price.override','Override selling price during sale'),
  ('sales.report','View sales reports')
on conflict (key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'sales.view','sales.create','sales.void','sales.price.override','sales.report'
) where r.name in ('ADMIN','MANAGER')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'sales.view','sales.create','sales.report'
) where r.name in ('SERVICE_ADVISOR','ACCOUNTANT','STOREKEEPER')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'sales.view','inventory.view'
) where r.name in ('TECHNICIAN','OWNER_READONLY')
on conflict do nothing;

-- ── 2. Extend parts into a searchable spare-parts/accessories catalogue ─────
alter table public.parts add column if not exists vehicle_make text;
alter table public.parts add column if not exists vehicle_model text;
alter table public.parts add column if not exists model_year_version text;
alter table public.parts add column if not exists compatible_vehicle text;
alter table public.parts add column if not exists supplier_id uuid references public.suppliers(id);

create index if not exists parts_category_idx on public.parts(lower(category));
create index if not exists parts_vehicle_make_idx on public.parts(lower(vehicle_make));
create index if not exists parts_vehicle_model_idx on public.parts(lower(vehicle_model));

-- Keep part numbers important. The original unique(branch_id, sku) allows duplicate NULL
-- branches in Postgres, so this partial expression index closes that gap for normal use.
create unique index if not exists parts_branch_sku_unique_expr_idx
  on public.parts(coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(sku));

-- ── 3. Sales tables ────────────────────────────────────────────────────────
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text unique not null,
  sale_date timestamptz not null default now(),
  customer_name text,
  customer_phone text,
  customer_type text not null default 'WALK_IN' check (customer_type in ('WALK_IN','VEHICLE_OWNER','BUSINESS','GARAGE_WORKSHOP','OTHER')),
  salesperson_id uuid references auth.users(id),
  salesperson_name text,
  payment_method text not null default 'CASH' check (payment_method in ('CASH','MPESA','BANK','CARD','CREDIT','OTHER')),
  payment_status text not null default 'PAID' check (payment_status in ('PAID','PARTIAL','PENDING')),
  status text not null default 'COMPLETED' check (status in ('COMPLETED','PARTIALLY_RETURNED','RETURNED','VOIDED')),
  subtotal_minor integer not null default 0 check (subtotal_minor >= 0),
  discount_minor integer not null default 0 check (discount_minor >= 0),
  total_minor integer not null default 0 check (total_minor >= 0),
  amount_paid_minor integer not null default 0 check (amount_paid_minor >= 0),
  balance_minor integer not null default 0 check (balance_minor >= 0),
  void_reason text,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  part_name text not null,
  part_sku text not null,
  category text,
  quantity integer not null check (quantity > 0),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  line_total_minor integer not null check (line_total_minor >= 0),
  returned_quantity integer not null default 0 check (returned_quantity >= 0),
  created_at timestamptz not null default now(),
  check (returned_quantity <= quantity)
);

create table public.sale_number_counters (
  id boolean primary key default true,
  next_seq integer not null default 1,
  check (id)
);

create index sales_sale_date_idx on public.sales(sale_date desc);
create index sales_status_idx on public.sales(status);
create index sales_payment_status_idx on public.sales(payment_status);
create index sales_customer_name_idx on public.sales(lower(customer_name));
create index sale_items_sale_idx on public.sale_items(sale_id);
create index sale_items_part_idx on public.sale_items(part_id);

create trigger sales_touch_updated_at before update on public.sales for each row execute function public.touch_updated_at();

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_number_counters enable row level security;

create policy "staff_select_sales" on public.sales for select to authenticated using(public.has_permission('sales.view'));
create policy "staff_insert_sales" on public.sales for insert to authenticated with check(false);
create policy "staff_update_sales" on public.sales for update to authenticated using(false) with check(false);
create policy "staff_delete_sales" on public.sales for delete to authenticated using(public.has_permission('settings.manage'));

create policy "staff_select_sale_items" on public.sale_items for select to authenticated using(public.has_permission('sales.view'));
create policy "staff_insert_sale_items" on public.sale_items for insert to authenticated with check(false);
create policy "staff_update_sale_items" on public.sale_items for update to authenticated using(false) with check(false);
create policy "staff_delete_sale_items" on public.sale_items for delete to authenticated using(public.has_permission('settings.manage'));

-- ── 4. Stock movement enum expansion ───────────────────────────────────────
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (
  movement_type in ('OPENING_BALANCE','PURCHASE','JOB_CARD_USAGE','SALE','SALE_REVERSAL','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','TRANSFER')
);

-- ── 5. Numbering and transactional RPCs ────────────────────────────────────
create or replace function public.generate_sale_number() returns text
language plpgsql security definer set search_path = public as $$
declare v_seq integer;
begin
  if not public.has_permission('sales.create') then raise exception 'Not authorized to create sales'; end if;
  insert into public.sale_number_counters(id, next_seq) values (true, 1) on conflict (id) do nothing;
  update public.sale_number_counters set next_seq = next_seq + 1 where id = true returning next_seq - 1 into v_seq;
  return 'SALE-' || lpad(v_seq::text, 5, '0');
end; $$;

create or replace function public.complete_sale(
  p_customer_name text,
  p_customer_phone text,
  p_customer_type text,
  p_payment_method text,
  p_payment_status text,
  p_sale_date timestamptz,
  p_discount_minor integer,
  p_amount_paid_minor integer,
  p_items jsonb
) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_part public.parts%rowtype;
  v_quantity integer;
  v_unit_price integer;
  v_line_total integer;
  v_subtotal integer := 0;
  v_total integer;
  v_sale_number text;
  v_salesperson_name text;
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_previous integer;
  v_new integer;
begin
  if not public.has_permission('sales.create') then raise exception 'Not authorized to create sales'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Sale must contain at least one item'; end if;
  if coalesce(p_discount_minor, 0) < 0 then raise exception 'Discount cannot be negative'; end if;
  if coalesce(p_amount_paid_minor, 0) < 0 then raise exception 'Amount paid cannot be negative'; end if;
  if v_phone is not null and v_phone !~ '^[+0-9][0-9 .()-]{5,24}$' then raise exception 'Customer phone is invalid'; end if;
  if p_customer_type not in ('WALK_IN','VEHICLE_OWNER','BUSINESS','GARAGE_WORKSHOP','OTHER') then raise exception 'Invalid customer type'; end if;
  if p_payment_method not in ('CASH','MPESA','BANK','CARD','CREDIT','OTHER') then raise exception 'Invalid payment method'; end if;
  if p_payment_status not in ('PAID','PARTIAL','PENDING') then raise exception 'Invalid payment status'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    v_unit_price := nullif(v_item->>'unit_price_minor', '')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'Unit price cannot be negative'; end if;
    select * into v_part from public.parts where id = (v_item->>'part_id')::uuid and active = true for update;
    if not found then raise exception 'Item does not exist'; end if;
    if v_unit_price <> v_part.selling_price_minor and not public.has_permission('sales.price.override') then
      raise exception 'Not authorized to change selling price';
    end if;
    if v_quantity > v_part.quantity_on_hand then
      raise exception 'Insufficient stock. Only % pieces available.', v_part.quantity_on_hand;
    end if;
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
  end loop;

  v_total := greatest(v_subtotal - coalesce(p_discount_minor, 0), 0);
  if coalesce(p_amount_paid_minor, 0) > v_total then raise exception 'Amount paid cannot exceed grand total'; end if;
  select coalesce(pr.full_name, au.email, 'Staff') into v_salesperson_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  v_sale_number := public.generate_sale_number();

  insert into public.sales(sale_number, sale_date, customer_name, customer_phone, customer_type, salesperson_id, salesperson_name, payment_method, payment_status, subtotal_minor, discount_minor, total_minor, amount_paid_minor, balance_minor)
  values (v_sale_number, coalesce(p_sale_date, now()), nullif(trim(coalesce(p_customer_name, '')), ''), v_phone, p_customer_type, auth.uid(), v_salesperson_name, p_payment_method, p_payment_status, v_subtotal, coalesce(p_discount_minor, 0), v_total, coalesce(p_amount_paid_minor, 0), v_total - coalesce(p_amount_paid_minor, 0))
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

revoke all on function public.generate_sale_number() from public, anon;
revoke all on function public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb) from public, anon;
revoke all on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.generate_sale_number() to authenticated;
grant execute on function public.complete_sale(text, text, text, text, text, timestamptz, integer, integer, jsonb) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
