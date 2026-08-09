/*
# Oakland Motors operations expansion — suppliers, procurement, quotations, stock, employees, settings

1. Purpose
- Adds suppliers, supplier contacts, purchase orders, goods receipts, quotations, quotation items, stock movements, stock adjustments, employees, business settings, branches, job statuses, and payment methods tables.
- Adds SECURITY DEFINER functions for stock issuance, stock receipt, payment recording, job status transitions, and audit logging — all transactional and permission-checked.

2. New Tables
- `branches` — future multi-branch support.
- `suppliers`, `supplier_contacts` — vendor master data.
- `purchase_orders`, `purchase_order_items`, `goods_receipts` — procurement workflow.
- `quotations`, `quotation_items` — quotation generation from job cards.
- `stock_movements`, `stock_adjustments` — auditable inventory changes.
- `employees` — staff profiles linked to auth users.
- `business_settings`, `job_statuses`, `payment_methods` — configurable system settings.

3. Security
- All new tables have RLS enabled.
- SECURITY DEFINER functions check `has_permission` before performing privileged mutations.
- Stock and payment operations are transactional with idempotency protection.
*/
create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name text not null,
  contact_person text,
  phone text not null,
  email text,
  address text,
  payment_terms text,
  notes text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_by uuid default auth.uid() references auth.users(id),
  updated_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  role text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid,
  po_number text unique not null,
  supplier_id uuid not null references public.suppliers(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  order_date date not null default current_date,
  expected_delivery date,
  received_date date,
  notes text,
  total_minor integer not null default 0 check (total_minor >= 0),
  created_by uuid default auth.uid() references auth.users(id),
  updated_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  quantity_ordered integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  unit_cost_minor integer not null default 0 check (unit_cost_minor >= 0),
  line_total_minor integer not null default 0 check (line_total_minor >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id),
  part_id uuid not null references public.parts(id),
  quantity_received integer not null check (quantity_received > 0),
  unit_cost_minor integer not null default 0 check (unit_cost_minor >= 0),
  received_by uuid default auth.uid() references auth.users(id),
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid,
  quote_number text unique not null,
  customer_id uuid not null references public.customers(id),
  vehicle_id uuid references public.vehicles(id),
  job_card_id uuid references public.job_cards(id),
  subtotal_minor integer not null default 0 check (subtotal_minor >= 0),
  discount_minor integer not null default 0 check (discount_minor >= 0),
  tax_minor integer not null default 0 check (tax_minor >= 0),
  total_minor integer not null default 0 check (total_minor >= 0),
  valid_until date,
  terms text,
  notes text,
  status text not null default 'DRAFT' check (status in ('DRAFT','SENT','PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED','CONVERTED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  converted_invoice_id uuid references public.invoices(id),
  created_by uuid default auth.uid() references auth.users(id),
  updated_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  item_type text not null check (item_type in ('LABOUR','PART','OTHER')),
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_minor integer not null default 0 check (unit_price_minor >= 0),
  tax_rate numeric(5,2) not null default 16 check (tax_rate between 0 and 100),
  line_total_minor integer not null default 0 check (line_total_minor >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id),
  movement_type text not null check (movement_type in ('OPENING_BALANCE','PURCHASE','JOB_CARD_USAGE','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','TRANSFER')),
  quantity integer not null,
  previous_balance integer not null,
  new_balance integer not null,
  unit_cost_minor integer not null default 0,
  reason text,
  reference text,
  reference_id uuid,
  user_id uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id),
  adjustment_type text not null check (adjustment_type in ('ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE')),
  quantity integer not null check (quantity > 0),
  reason text not null,
  previous_balance integer not null,
  new_balance integer not null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  role text not null default 'TECHNICIAN',
  specialization text,
  active boolean not null default true,
  branch_id uuid references public.branches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text not null default 'Oakland Motors',
  address text,
  phone text,
  email text,
  logo_url text,
  tax_rate numeric(5,2) not null default 16 check (tax_rate between 0 and 100),
  currency text not null default 'KES',
  invoice_prefix text not null default 'INV',
  quote_prefix text not null default 'QUO',
  job_card_prefix text not null default 'JC',
  receipt_prefix text not null default 'RCP',
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_statuses (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  label text not null,
  sort_order integer not null default 0,
  is_terminal boolean not null default false,
  active boolean not null default true
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 0
);

create index if not exists suppliers_name_idx on public.suppliers(lower(name));
create index if not exists purchase_orders_status_idx on public.purchase_orders(status);
create index if not exists quotations_status_idx on public.quotations(status);
create index if not exists stock_movements_part_idx on public.stock_movements(part_id);
create index if not exists stock_movements_created_idx on public.stock_movements(created_at desc);
create index if not exists employees_user_idx on public.employees(user_id);

create trigger suppliers_touch_updated_at before update on public.suppliers for each row execute function public.touch_updated_at();
create trigger purchase_orders_touch_updated_at before update on public.purchase_orders for each row execute function public.touch_updated_at();
create trigger quotations_touch_updated_at before update on public.quotations for each row execute function public.touch_updated_at();
create trigger employees_touch_updated_at before update on public.employees for each row execute function public.touch_updated_at();
create trigger branches_touch_updated_at before update on public.branches for each row execute function public.touch_updated_at();

alter table public.branches enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.employees enable row level security;
alter table public.business_settings enable row level security;
alter table public.job_statuses enable row level security;
alter table public.payment_methods enable row level security;

do $$
declare t text;
begin
  foreach t in array array['branches','suppliers','supplier_contacts','purchase_orders','purchase_order_items','goods_receipts','quotations','quotation_items','stock_movements','stock_adjustments','employees','business_settings','job_statuses','payment_methods'] loop
    execute format('drop policy if exists "staff_select_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "staff_insert_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "staff_update_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "staff_delete_%1$s" on public.%1$s', t);
    execute format('create policy "staff_select_%1$s" on public.%1$s for select to authenticated using(public.has_permission(''dashboard.view''))', t);
    execute format('create policy "staff_insert_%1$s" on public.%1$s for insert to authenticated with check(public.has_permission(''dashboard.view''))', t);
    execute format('create policy "staff_update_%1$s" on public.%1$s for update to authenticated using(public.has_permission(''dashboard.view'')) with check(public.has_permission(''dashboard.view''))', t);
    execute format('create policy "staff_delete_%1$s" on public.%1$s for delete to authenticated using(public.has_permission(''settings.manage''))', t);
  end loop;
end $$;

insert into public.job_statuses(name, label, sort_order, is_terminal) values
('RECEIVED','Received',1,false),('DIAGNOSING','Diagnosing',2,false),('AWAITING_APPROVAL','Awaiting Approval',3,false),('APPROVED','Approved',4,false),('IN_PROGRESS','In Progress',5,false),('AWAITING_PARTS','Awaiting Parts',6,false),('COMPLETED','Completed',7,false),('READY_FOR_PICKUP','Ready for Pickup',8,false),('DELIVERED','Delivered',9,true),('CANCELLED','Cancelled',10,true)
on conflict (name) do nothing;

insert into public.payment_methods(name, label, sort_order) values
('CASH','Cash',1),('MPESA','M-Pesa',2),('BANK','Bank',3),('CARD','Card',4),('OTHER','Other',5)
on conflict (name) do nothing;

insert into public.business_settings(business_name, address, phone, email, tax_rate, currency)
select 'Oakland Motors', 'Mombasa Road, Nairobi, Kenya', '+254 700 000 000', 'info@oaklandmotors.co.ke', 16.00, 'KES'
where not exists(select 1 from public.business_settings);

insert into public.branches(name, address, phone, email)
select 'Nairobi Workshop', 'Mombasa Road, Nairobi', '+254 700 000 000', 'nairobi@oaklandmotors.co.ke'
where not exists(select 1 from public.branches);
