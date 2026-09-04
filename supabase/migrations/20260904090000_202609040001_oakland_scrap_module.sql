/*
# Oakland Motor Care Ltd — Joseph Scrap Management module

Two separate, date-linked accounting streams for the scrap yard operation:

  STREAM A (stock)  — scrap_items / stock_cycles / scrap_purchases / scrap_stock_adjustments
  STREAM B (cash)   — scrap_daily_records / scrap_expenses

Stock is tracked in "stock cycles" per scrap type so that a full clearance closes a
cycle without ever destroying its history; the next purchase (or an explicit
start-new-cycle action) opens the next cycle. Cash is a simple day-to-day ledger
where each day's closing balance becomes the next day's previous balance.

All mutations run through SECURITY DEFINER RPCs (never direct table writes from the
client) so stock/cash arithmetic, permission checks, and the audit trail are all
enforced server-side — mirroring record_payment / issue_sale / complete_sale.
*/

-- ── 1. Permission catalogue and role grants ────────────────────────────────
insert into public.permissions(key, label) values
  ('scrap.view','View scrap yard records'),
  ('scrap.record','Record daily scrap purchases and cash'),
  ('scrap.manage','Manage scrap rates, stock clearance and cycles')
on conflict (key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('scrap.view','scrap.record','scrap.manage')
where r.name in ('ADMIN','MANAGER')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('scrap.view','scrap.record')
where r.name in ('STOREKEEPER','ACCOUNTANT')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('scrap.view')
where r.name in ('OWNER_READONLY')
on conflict do nothing;

-- ── 2. Tables ───────────────────────────────────────────────────────────────
create table public.scrap_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  current_rate_minor integer check (current_rate_minor is null or current_rate_minor >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index scrap_items_name_unique_idx on public.scrap_items(lower(name));

create table public.stock_cycles (
  id uuid primary key default gen_random_uuid(),
  scrap_item_id uuid not null references public.scrap_items(id),
  cycle_number integer not null check (cycle_number > 0),
  opening_quantity numeric(12,2) not null default 0 check (opening_quantity >= 0),
  opening_date date not null,
  current_quantity numeric(12,2) not null default 0 check (current_quantity >= 0),
  closing_quantity numeric(12,2) check (closing_quantity is null or closing_quantity >= 0),
  closing_date date,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  notes text,
  created_at timestamptz not null default now(),
  unique (scrap_item_id, cycle_number)
);
create index stock_cycles_item_idx on public.stock_cycles(scrap_item_id);
-- Only one OPEN cycle per scrap item at a time.
create unique index stock_cycles_one_open_idx on public.stock_cycles(scrap_item_id) where status = 'OPEN';

create table public.scrap_daily_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  previous_closing_cash_minor integer not null check (previous_closing_cash_minor >= 0),
  cash_added_minor integer not null default 0 check (cash_added_minor >= 0),
  cash_available_minor integer not null check (cash_available_minor >= 0),
  total_kg_purchased numeric(12,2) not null default 0 check (total_kg_purchased >= 0),
  total_scrap_purchase_minor integer not null default 0 check (total_scrap_purchase_minor >= 0),
  total_expenses_minor integer not null default 0 check (total_expenses_minor >= 0),
  closing_cash_minor integer not null,
  has_discrepancy boolean not null default false,
  notes text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  void_reason text,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index scrap_daily_records_date_active_idx on public.scrap_daily_records(date) where status = 'ACTIVE';
create index scrap_daily_records_date_idx on public.scrap_daily_records(date desc);

create table public.scrap_purchases (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.scrap_daily_records(id) on delete cascade,
  scrap_item_id uuid not null references public.scrap_items(id),
  stock_cycle_id uuid not null references public.stock_cycles(id),
  rate_used_minor integer not null check (rate_used_minor >= 0),
  opening_stock numeric(12,2) not null check (opening_stock >= 0),
  quantity_purchased numeric(12,2) not null check (quantity_purchased > 0),
  purchase_amount_minor integer not null check (purchase_amount_minor >= 0),
  closing_stock numeric(12,2) not null check (closing_stock >= 0),
  created_at timestamptz not null default now()
);
create index scrap_purchases_daily_record_idx on public.scrap_purchases(daily_record_id);
create index scrap_purchases_item_idx on public.scrap_purchases(scrap_item_id);
create index scrap_purchases_cycle_idx on public.scrap_purchases(stock_cycle_id);

create table public.scrap_expenses (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.scrap_daily_records(id) on delete cascade,
  category text not null,
  amount_minor integer not null check (amount_minor > 0),
  description text,
  created_at timestamptz not null default now()
);
create index scrap_expenses_daily_record_idx on public.scrap_expenses(daily_record_id);

create table public.scrap_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  scrap_item_id uuid not null references public.scrap_items(id),
  stock_cycle_id uuid not null references public.stock_cycles(id),
  date date not null default current_date,
  adjustment_type text not null check (adjustment_type in ('CLEARANCE','OPENING','CORRECTION_INCREASE','CORRECTION_DECREASE')),
  quantity numeric(12,2) not null check (quantity >= 0),
  previous_stock numeric(12,2) not null check (previous_stock >= 0),
  resulting_stock numeric(12,2) not null check (resulting_stock >= 0),
  reason text not null,
  authorized_by text not null,
  notes text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index scrap_stock_adjustments_item_idx on public.scrap_stock_adjustments(scrap_item_id);
create index scrap_stock_adjustments_cycle_idx on public.scrap_stock_adjustments(stock_cycle_id);

-- Optional, explicitly separate financial event: proceeds the Boss received for a
-- clearance. Never created automatically — a clearance is a stock event, not revenue.
create table public.scrap_clearance_sales (
  id uuid primary key default gen_random_uuid(),
  stock_adjustment_id uuid not null references public.scrap_stock_adjustments(id),
  amount_minor integer not null check (amount_minor > 0),
  buyer text,
  reference text,
  notes text,
  recorded_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index scrap_clearance_sales_adjustment_idx on public.scrap_clearance_sales(stock_adjustment_id);

-- Single-row settings: the opening cash balance used only when no daily record exists yet.
create table public.scrap_settings (
  id boolean primary key default true check (id),
  opening_cash_minor integer check (opening_cash_minor is null or opening_cash_minor >= 0),
  opening_cash_date date,
  opening_notes text,
  established_by uuid references auth.users(id),
  established_at timestamptz
);
insert into public.scrap_settings(id) values (true) on conflict (id) do nothing;

alter table public.scrap_items enable row level security;
alter table public.stock_cycles enable row level security;
alter table public.scrap_daily_records enable row level security;
alter table public.scrap_purchases enable row level security;
alter table public.scrap_expenses enable row level security;
alter table public.scrap_stock_adjustments enable row level security;
alter table public.scrap_clearance_sales enable row level security;
alter table public.scrap_settings enable row level security;

create policy "staff_select_scrap_items" on public.scrap_items for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_items" on public.scrap_items for insert to authenticated with check (false);
create policy "staff_update_scrap_items" on public.scrap_items for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_items" on public.scrap_items for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_stock_cycles" on public.stock_cycles for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_stock_cycles" on public.stock_cycles for insert to authenticated with check (false);
create policy "staff_update_stock_cycles" on public.stock_cycles for update to authenticated using (false) with check (false);
create policy "staff_delete_stock_cycles" on public.stock_cycles for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_scrap_daily_records" on public.scrap_daily_records for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_daily_records" on public.scrap_daily_records for insert to authenticated with check (false);
create policy "staff_update_scrap_daily_records" on public.scrap_daily_records for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_daily_records" on public.scrap_daily_records for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_scrap_purchases" on public.scrap_purchases for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_purchases" on public.scrap_purchases for insert to authenticated with check (false);
create policy "staff_update_scrap_purchases" on public.scrap_purchases for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_purchases" on public.scrap_purchases for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_scrap_expenses" on public.scrap_expenses for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_expenses" on public.scrap_expenses for insert to authenticated with check (false);
create policy "staff_update_scrap_expenses" on public.scrap_expenses for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_expenses" on public.scrap_expenses for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_scrap_stock_adjustments" on public.scrap_stock_adjustments for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_stock_adjustments" on public.scrap_stock_adjustments for insert to authenticated with check (false);
create policy "staff_update_scrap_stock_adjustments" on public.scrap_stock_adjustments for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_stock_adjustments" on public.scrap_stock_adjustments for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_scrap_clearance_sales" on public.scrap_clearance_sales for select to authenticated using (public.has_permission('scrap.manage'));
create policy "staff_write_scrap_clearance_sales" on public.scrap_clearance_sales for insert to authenticated with check (false);
create policy "staff_update_scrap_clearance_sales" on public.scrap_clearance_sales for update to authenticated using (false) with check (false);
create policy "staff_delete_scrap_clearance_sales" on public.scrap_clearance_sales for delete to authenticated using (public.has_permission('settings.manage'));

create policy "staff_select_scrap_settings" on public.scrap_settings for select to authenticated using (public.has_permission('scrap.view'));
create policy "staff_write_scrap_settings" on public.scrap_settings for insert to authenticated with check (false);
create policy "staff_update_scrap_settings" on public.scrap_settings for update to authenticated using (false) with check (false);

create trigger scrap_items_touch_updated_at before update on public.scrap_items for each row execute function public.touch_updated_at();
create trigger scrap_daily_records_touch_updated_at before update on public.scrap_daily_records for each row execute function public.touch_updated_at();

-- Read-only convenience view: current stock per active item, 0 when no cycle is open
-- (i.e. the last cycle was fully cleared and nothing has been purchased/opened since).
create view public.scrap_current_stock as
select
  si.id as scrap_item_id, si.name, si.current_rate_minor, si.active,
  sc.id as stock_cycle_id, sc.cycle_number, sc.opening_quantity, sc.opening_date,
  coalesce(sc.current_quantity, 0) as current_quantity
from public.scrap_items si
left join public.stock_cycles sc on sc.scrap_item_id = si.id and sc.status = 'OPEN';
grant select on public.scrap_current_stock to authenticated;

-- ── 3. Seed the initial scrap type catalogue (rates in minor units, KES/kg) ──
insert into public.scrap_items (name, current_rate_minor) values
  ('Heavy 1', 4500),
  ('Heavy 2', 4000),
  ('Light', 3000),
  ('Soft', 20000),
  ('ND 1', 70000),
  ('ND 2', 100000),
  ('Plastic', 2000),
  ('Battery 1', null),
  ('Battery 2', null),
  ('Brass', null),
  ('Gumbootys', null),
  ('Hard', 15000),
  ('Cast', 3500)
on conflict do nothing;

insert into public.stock_cycles (scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status)
select id, 1, 0, current_date, 0, 'OPEN' from public.scrap_items
on conflict do nothing;

-- ── 4. RPCs ───────────────────────────────────────────────────────────────

create or replace function public.scrap_set_opening_cash(p_date date, p_amount_minor integer, p_notes text default null)
returns public.scrap_settings
language plpgsql security definer set search_path = public as $$
declare v_settings public.scrap_settings%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to set the scrap cash opening balance'; end if;
  if exists (select 1 from public.scrap_daily_records where status = 'ACTIVE') then
    raise exception 'An opening balance can only be set before the first daily record is created';
  end if;
  if p_amount_minor is null or p_amount_minor < 0 then raise exception 'Opening cash cannot be negative'; end if;
  if p_date is null then raise exception 'Opening date is required'; end if;

  update public.scrap_settings set
    opening_cash_minor = p_amount_minor,
    opening_cash_date = p_date,
    opening_notes = p_notes,
    established_by = auth.uid(),
    established_at = now()
  where id = true
  returning * into v_settings;

  perform public.log_audit('SET_SCRAP_OPENING_CASH', 'scrap_settings', null, null, jsonb_build_object('amount_minor', p_amount_minor, 'date', p_date));
  return v_settings;
end; $$;

create or replace function public.scrap_add_item(p_name text, p_rate_minor integer default null)
returns public.scrap_items
language plpgsql security definer set search_path = public as $$
declare v_item public.scrap_items%rowtype; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to manage scrap types'; end if;
  if v_name is null then raise exception 'Scrap type name is required'; end if;
  if p_rate_minor is not null and p_rate_minor < 0 then raise exception 'Rate cannot be negative'; end if;
  if exists (select 1 from public.scrap_items where lower(name) = lower(v_name)) then raise exception 'A scrap type named "%" already exists', v_name; end if;

  insert into public.scrap_items(name, current_rate_minor) values (v_name, p_rate_minor) returning * into v_item;
  insert into public.stock_cycles(scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status)
  values (v_item.id, 1, 0, current_date, 0, 'OPEN');

  perform public.log_audit('ADD_SCRAP_ITEM', 'scrap_items', v_item.id, null, to_jsonb(v_item));
  return v_item;
end; $$;

create or replace function public.scrap_update_item(p_id uuid, p_name text, p_active boolean)
returns public.scrap_items
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_items%rowtype; v_after public.scrap_items%rowtype; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to manage scrap types'; end if;
  select * into v_before from public.scrap_items where id = p_id for update;
  if not found then raise exception 'Scrap type not found'; end if;
  if v_name is null then raise exception 'Scrap type name is required'; end if;
  if exists (select 1 from public.scrap_items where lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'A scrap type named "%" already exists', v_name;
  end if;

  update public.scrap_items set name = v_name, active = coalesce(p_active, active) where id = p_id returning * into v_after;
  perform public.log_audit('UPDATE_SCRAP_ITEM', 'scrap_items', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

create or replace function public.scrap_set_item_rate(p_id uuid, p_rate_minor integer)
returns public.scrap_items
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_items%rowtype; v_after public.scrap_items%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to change scrap rates'; end if;
  if p_rate_minor is null or p_rate_minor < 0 then raise exception 'Rate cannot be negative'; end if;
  select * into v_before from public.scrap_items where id = p_id for update;
  if not found then raise exception 'Scrap type not found'; end if;

  update public.scrap_items set current_rate_minor = p_rate_minor where id = p_id returning * into v_after;
  -- Historical scrap_purchases rows store their own rate_used_minor and are never touched here.
  perform public.log_audit('SET_SCRAP_RATE', 'scrap_items', p_id, jsonb_build_object('current_rate_minor', v_before.current_rate_minor), jsonb_build_object('current_rate_minor', v_after.current_rate_minor));
  return v_after;
end; $$;

create or replace function public.scrap_create_daily_record(
  p_date date,
  p_cash_added_minor integer,
  p_purchases jsonb,
  p_expenses jsonb,
  p_notes text default null,
  p_force boolean default false
) returns public.scrap_daily_records
language plpgsql security definer set search_path = public as $$
declare
  v_record public.scrap_daily_records%rowtype;
  v_latest_date date;
  v_previous_closing integer;
  v_purchase jsonb;
  v_expense jsonb;
  v_item public.scrap_items%rowtype;
  v_cycle public.stock_cycles%rowtype;
  v_qty numeric(12,2);
  v_amount_minor integer;
  v_expense_amount integer;
  v_next_cycle_num integer;
  v_total_purchases integer := 0;
  v_total_kg numeric(12,2) := 0;
  v_total_expenses integer := 0;
  v_cash_available integer;
  v_closing_cash integer;
  v_has_discrepancy boolean := false;
  v_purchase_rows jsonb := '[]'::jsonb;
  v_row jsonb;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record scrap daily records'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_cash_added_minor, 0) < 0 then raise exception 'Cash added cannot be negative'; end if;
  if p_purchases is not null and jsonb_typeof(p_purchases) <> 'array' then raise exception 'Purchases must be a list'; end if;
  if p_expenses is not null and jsonb_typeof(p_expenses) <> 'array' then raise exception 'Expenses must be a list'; end if;

  if exists (select 1 from public.scrap_daily_records where date = p_date and status = 'ACTIVE') then
    raise exception 'A daily record for % already exists. Void it before re-entering that date.', p_date;
  end if;

  select max(date) into v_latest_date from public.scrap_daily_records where status = 'ACTIVE';
  if v_latest_date is not null and p_date <= v_latest_date then
    raise exception 'Daily records must be entered in date order. The latest recorded date is %.', v_latest_date;
  end if;

  if v_latest_date is not null then
    select closing_cash_minor into v_previous_closing from public.scrap_daily_records where date = v_latest_date and status = 'ACTIVE';
  else
    select opening_cash_minor into v_previous_closing from public.scrap_settings where id = true;
    if v_previous_closing is null then
      raise exception 'Set an opening cash balance before recording the first daily record';
    end if;
  end if;

  -- ── Stock: one row per purchased scrap type ──
  for v_purchase in select * from jsonb_array_elements(coalesce(p_purchases, '[]'::jsonb)) loop
    v_qty := nullif(v_purchase->>'quantity_kg', '')::numeric;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select * into v_item from public.scrap_items where id = (v_purchase->>'scrap_item_id')::uuid for update;
    if not found then raise exception 'Scrap type not found'; end if;
    if not v_item.active then raise exception '% is not active and cannot be purchased', v_item.name; end if;
    if v_item.current_rate_minor is null then raise exception 'Set a rate for % before recording a purchase', v_item.name; end if;

    select * into v_cycle from public.stock_cycles where scrap_item_id = v_item.id and status = 'OPEN' for update;
    if not found then
      v_next_cycle_num := coalesce((select max(cycle_number) from public.stock_cycles where scrap_item_id = v_item.id), 0) + 1;
      insert into public.stock_cycles(scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status)
      values (v_item.id, v_next_cycle_num, 0, p_date, 0, 'OPEN')
      returning * into v_cycle;
    end if;

    v_amount_minor := round(v_qty * v_item.current_rate_minor)::integer;

    -- Accumulate the line; the actual scrap_purchases insert happens after the
    -- parent scrap_daily_records row exists (daily_record_id is NOT NULL).
    v_purchase_rows := v_purchase_rows || jsonb_build_object(
      'scrap_item_id', v_item.id,
      'stock_cycle_id', v_cycle.id,
      'rate_used_minor', v_item.current_rate_minor,
      'opening_stock', v_cycle.current_quantity,
      'quantity_purchased', v_qty,
      'purchase_amount_minor', v_amount_minor,
      'closing_stock', v_cycle.current_quantity + v_qty
    );
    update public.stock_cycles set current_quantity = v_cycle.current_quantity + v_qty where id = v_cycle.id;

    v_total_purchases := v_total_purchases + v_amount_minor;
    v_total_kg := v_total_kg + v_qty;
  end loop;

  -- ── Cash: expenses ──
  for v_expense in select * from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb)) loop
    v_expense_amount := nullif(v_expense->>'amount_minor', '')::integer;
    if v_expense_amount is null or v_expense_amount <= 0 then continue; end if;
    if nullif(trim(coalesce(v_expense->>'category', '')), '') is null then raise exception 'Every expense needs a category'; end if;
    v_total_expenses := v_total_expenses + v_expense_amount;
  end loop;

  v_cash_available := v_previous_closing + coalesce(p_cash_added_minor, 0);
  v_closing_cash := v_cash_available - v_total_purchases - v_total_expenses;

  if v_closing_cash < 0 then
    if not p_force or not public.has_permission('scrap.manage') then
      raise exception 'INSUFFICIENT_CASH: Cash available (%) is less than scrap purchases (%) plus expenses (%). Closing cash would be %.',
        v_cash_available, v_total_purchases, v_total_expenses, v_closing_cash;
    end if;
    v_has_discrepancy := true;
  end if;

  insert into public.scrap_daily_records(
    date, previous_closing_cash_minor, cash_added_minor, cash_available_minor,
    total_kg_purchased, total_scrap_purchase_minor, total_expenses_minor, closing_cash_minor, has_discrepancy, notes
  ) values (
    p_date, v_previous_closing, coalesce(p_cash_added_minor, 0), v_cash_available,
    v_total_kg, v_total_purchases, v_total_expenses, v_closing_cash, v_has_discrepancy, nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_record;

  for v_row in select * from jsonb_array_elements(v_purchase_rows) loop
    insert into public.scrap_purchases(daily_record_id, scrap_item_id, stock_cycle_id, rate_used_minor, opening_stock, quantity_purchased, purchase_amount_minor, closing_stock)
    values (
      v_record.id,
      (v_row->>'scrap_item_id')::uuid,
      (v_row->>'stock_cycle_id')::uuid,
      (v_row->>'rate_used_minor')::integer,
      (v_row->>'opening_stock')::numeric,
      (v_row->>'quantity_purchased')::numeric,
      (v_row->>'purchase_amount_minor')::integer,
      (v_row->>'closing_stock')::numeric
    );
  end loop;

  for v_expense in select * from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb)) loop
    v_expense_amount := nullif(v_expense->>'amount_minor', '')::integer;
    if v_expense_amount is null or v_expense_amount <= 0 then continue; end if;
    insert into public.scrap_expenses(daily_record_id, category, amount_minor, description)
    values (v_record.id, trim(v_expense->>'category'), v_expense_amount, nullif(trim(coalesce(v_expense->>'description', '')), ''));
  end loop;

  perform public.log_audit('CREATE_SCRAP_DAILY_RECORD', 'scrap_daily_records', v_record.id, null, to_jsonb(v_record));
  return v_record;
end; $$;

create or replace function public.scrap_void_daily_record(p_id uuid, p_reason text)
returns public.scrap_daily_records
language plpgsql security definer set search_path = public as $$
declare
  v_record public.scrap_daily_records%rowtype;
  v_latest_date date;
  v_purchase public.scrap_purchases%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to void scrap daily records'; end if;
  select * into v_record from public.scrap_daily_records where id = p_id for update;
  if not found then raise exception 'Daily record not found'; end if;
  if v_record.status = 'VOID' then return v_record; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to void a daily record'; end if;

  select max(date) into v_latest_date from public.scrap_daily_records where status = 'ACTIVE';
  if v_record.date <> v_latest_date then
    raise exception 'Only the most recent daily record (%) can be voided. Void later records first.', v_latest_date;
  end if;

  for v_purchase in select * from public.scrap_purchases where daily_record_id = p_id loop
    update public.stock_cycles set current_quantity = current_quantity - v_purchase.quantity_purchased where id = v_purchase.stock_cycle_id;
  end loop;

  update public.scrap_daily_records set status = 'VOID', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
  where id = p_id returning * into v_record;

  perform public.log_audit('VOID_SCRAP_DAILY_RECORD', 'scrap_daily_records', p_id, null, to_jsonb(v_record), jsonb_build_object('reason', p_reason));
  return v_record;
end; $$;

create or replace function public.scrap_clear_stock(
  p_scrap_item_id uuid,
  p_quantity numeric,
  p_full boolean,
  p_reason text,
  p_authorized_by text,
  p_notes text default null,
  p_date date default current_date
) returns public.scrap_stock_adjustments
language plpgsql security definer set search_path = public as $$
declare v_cycle public.stock_cycles%rowtype; v_qty numeric(12,2); v_resulting numeric(12,2); v_adjustment public.scrap_stock_adjustments%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to clear scrap stock'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required for a stock clearance'; end if;
  if nullif(trim(coalesce(p_authorized_by, '')), '') is null then raise exception 'Authorized-by is required for a stock clearance'; end if;

  select * into v_cycle from public.stock_cycles where scrap_item_id = p_scrap_item_id and status = 'OPEN' for update;
  if not found then raise exception 'This scrap type has no open stock to clear'; end if;

  v_qty := case when p_full then v_cycle.current_quantity else p_quantity end;
  if v_qty is null or v_qty <= 0 then raise exception 'Clearance quantity must be greater than zero'; end if;
  if v_qty > v_cycle.current_quantity then
    raise exception 'Clearance (%) cannot exceed current stock (%)', v_qty, v_cycle.current_quantity;
  end if;

  v_resulting := v_cycle.current_quantity - v_qty;
  update public.stock_cycles set current_quantity = v_resulting where id = v_cycle.id;

  insert into public.scrap_stock_adjustments(scrap_item_id, stock_cycle_id, date, adjustment_type, quantity, previous_stock, resulting_stock, reason, authorized_by, notes)
  values (p_scrap_item_id, v_cycle.id, coalesce(p_date, current_date), 'CLEARANCE', v_qty, v_cycle.current_quantity, v_resulting, p_reason, p_authorized_by, p_notes)
  returning * into v_adjustment;

  if v_resulting = 0 then
    update public.stock_cycles set status = 'CLOSED', closing_quantity = 0, closing_date = coalesce(p_date, current_date) where id = v_cycle.id;
  end if;

  perform public.log_audit('CLEAR_SCRAP_STOCK', 'scrap_stock_adjustments', v_adjustment.id, jsonb_build_object('current_quantity', v_cycle.current_quantity), jsonb_build_object('current_quantity', v_resulting), jsonb_build_object('scrap_item_id', p_scrap_item_id, 'reason', p_reason, 'authorized_by', p_authorized_by));
  return v_adjustment;
end; $$;

create or replace function public.scrap_start_new_cycle(p_scrap_item_id uuid, p_opening_quantity numeric, p_reason text)
returns public.stock_cycles
language plpgsql security definer set search_path = public as $$
declare v_open public.stock_cycles%rowtype; v_new public.stock_cycles%rowtype; v_next_cycle_num integer; v_opening numeric(12,2) := coalesce(p_opening_quantity, 0);
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to start a new stock cycle'; end if;
  if v_opening < 0 then raise exception 'Opening quantity cannot be negative'; end if;
  if v_opening > 0 and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason/source is required when opening a new cycle with existing stock';
  end if;

  select * into v_open from public.stock_cycles where scrap_item_id = p_scrap_item_id and status = 'OPEN' for update;
  if found then
    if v_open.current_quantity > 0 then
      raise exception 'Cannot start a new cycle while % stock remains — clear the existing stock first', v_open.current_quantity;
    end if;
    update public.stock_cycles set status = 'CLOSED', closing_quantity = 0, closing_date = current_date where id = v_open.id;
  end if;

  v_next_cycle_num := coalesce((select max(cycle_number) from public.stock_cycles where scrap_item_id = p_scrap_item_id), 0) + 1;
  insert into public.stock_cycles(scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status, notes)
  values (p_scrap_item_id, v_next_cycle_num, v_opening, current_date, v_opening, 'OPEN', p_reason)
  returning * into v_new;

  if v_opening > 0 then
    insert into public.scrap_stock_adjustments(scrap_item_id, stock_cycle_id, date, adjustment_type, quantity, previous_stock, resulting_stock, reason, authorized_by, notes)
    values (p_scrap_item_id, v_new.id, current_date, 'OPENING', v_opening, 0, v_opening, p_reason, 'System', 'Opening balance for new stock cycle');
  end if;

  perform public.log_audit('START_SCRAP_CYCLE', 'stock_cycles', v_new.id, null, to_jsonb(v_new));
  return v_new;
end; $$;

create or replace function public.scrap_record_clearance_sale(p_stock_adjustment_id uuid, p_amount_minor integer, p_buyer text default null, p_reference text default null, p_notes text default null)
returns public.scrap_clearance_sales
language plpgsql security definer set search_path = public as $$
declare v_adjustment public.scrap_stock_adjustments%rowtype; v_sale public.scrap_clearance_sales%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to record scrap clearance proceeds'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;
  select * into v_adjustment from public.scrap_stock_adjustments where id = p_stock_adjustment_id;
  if not found or v_adjustment.adjustment_type <> 'CLEARANCE' then raise exception 'That is not a stock clearance event'; end if;

  insert into public.scrap_clearance_sales(stock_adjustment_id, amount_minor, buyer, reference, notes)
  values (p_stock_adjustment_id, p_amount_minor, nullif(trim(coalesce(p_buyer, '')), ''), nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_sale;

  perform public.log_audit('RECORD_SCRAP_CLEARANCE_SALE', 'scrap_clearance_sales', v_sale.id, null, to_jsonb(v_sale));
  return v_sale;
end; $$;

revoke all on function public.scrap_set_opening_cash(date, integer, text) from public, anon;
revoke all on function public.scrap_add_item(text, integer) from public, anon;
revoke all on function public.scrap_update_item(uuid, text, boolean) from public, anon;
revoke all on function public.scrap_set_item_rate(uuid, integer) from public, anon;
revoke all on function public.scrap_create_daily_record(date, integer, jsonb, jsonb, text, boolean) from public, anon;
revoke all on function public.scrap_void_daily_record(uuid, text) from public, anon;
revoke all on function public.scrap_clear_stock(uuid, numeric, boolean, text, text, text, date) from public, anon;
revoke all on function public.scrap_start_new_cycle(uuid, numeric, text) from public, anon;
revoke all on function public.scrap_record_clearance_sale(uuid, integer, text, text, text) from public, anon;

grant execute on function public.scrap_set_opening_cash(date, integer, text) to authenticated;
grant execute on function public.scrap_add_item(text, integer) to authenticated;
grant execute on function public.scrap_update_item(uuid, text, boolean) to authenticated;
grant execute on function public.scrap_set_item_rate(uuid, integer) to authenticated;
grant execute on function public.scrap_create_daily_record(date, integer, jsonb, jsonb, text, boolean) to authenticated;
grant execute on function public.scrap_void_daily_record(uuid, text) to authenticated;
grant execute on function public.scrap_clear_stock(uuid, numeric, boolean, text, text, text, date) to authenticated;
grant execute on function public.scrap_start_new_cycle(uuid, numeric, text) to authenticated;
grant execute on function public.scrap_record_clearance_sale(uuid, integer, text, text, text) to authenticated;
