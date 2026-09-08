/*
# Notify on new entries: work orders, scrap daily entries, sales

Extends the notification triggers added in the previous migration to cover
record *creation*, not just approvals/thresholds:
- job_cards: a trigger fires on every new work order, notifying everyone
  with job.view (excluding whoever created it).
- scrap_record_purchase / scrap_record_expense / scrap_add_cash: each now
  also notifies everyone with scrap.manage after recording (excluding the
  person who just recorded it) — these are RPC-only writes (no direct table
  insert from the client), so the notify call goes inside the function
  rather than a trigger. Signatures are unchanged, so create or replace is
  enough; no drop needed.
- complete_sale: same pattern, notifies everyone with sales.view.

All three RPCs are recreated here with their full, unchanged bodies from
whichever migration last touched them, plus one added notify_by_permission
call each — nothing else about their logic changes.
*/

-- ── New work order ──────────────────────────────────────────────────────
create or replace function public.notify_new_job_card() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_customer_name text; v_reg text;
begin
  select full_name into v_customer_name from public.customers where id = new.customer_id;
  select registration_number into v_reg from public.vehicles where id = new.vehicle_id;
  perform public.notify_by_permission(
    'job.view',
    'New work order: ' || new.job_number,
    coalesce(v_customer_name, 'Customer') || ' · ' || coalesce(v_reg, 'Vehicle') || ' — ' || left(new.complaint, 120),
    'INFO',
    new.created_by
  );
  return new;
end; $$;

drop trigger if exists job_cards_created_notify on public.job_cards;
create trigger job_cards_created_notify after insert on public.job_cards for each row execute function public.notify_new_job_card();

-- ── New scrap purchase ───────────────────────────────────────────────────
create or replace function public.scrap_record_purchase(
  p_date date, p_change_in_days integer, p_scrap_item_id uuid, p_weight_kg numeric,
  p_supplier text default null, p_notes text default null, p_force boolean default false
) returns public.scrap_purchases
language plpgsql security definer set search_path = public as $$
declare
  v_item public.scrap_items%rowtype; v_cycle public.stock_cycles%rowtype; v_next_cycle_num integer;
  v_amount integer; v_purchase public.scrap_purchases%rowtype; v_summary public.scrap_cash_summary%rowtype; v_recorded_by_name text;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record scrap purchases'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in Days cannot be negative'; end if;
  if p_weight_kg is null or p_weight_kg <= 0 then raise exception 'Weight (KG) must be greater than zero'; end if;

  select * into v_item from public.scrap_items where id = p_scrap_item_id for update;
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

  v_amount := round(p_weight_kg * v_item.current_rate_minor)::integer;
  select coalesce(pr.full_name, au.email, 'Staff') into v_recorded_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  insert into public.scrap_purchases(daily_record_id, scrap_item_id, stock_cycle_id, rate_used_minor, opening_stock, quantity_purchased, purchase_amount_minor, closing_stock, date, change_in_days, supplier, notes, created_by, created_by_name)
  values (null, v_item.id, v_cycle.id, v_item.current_rate_minor, v_cycle.current_quantity, p_weight_kg, v_amount, v_cycle.current_quantity + p_weight_kg, p_date, coalesce(p_change_in_days, 0), nullif(trim(coalesce(p_supplier, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), v_recorded_by_name)
  returning * into v_purchase;

  update public.stock_cycles set current_quantity = v_cycle.current_quantity + p_weight_kg where id = v_cycle.id;

  perform public.scrap_recompute_cash_from(p_date);
  select * into v_summary from public.scrap_cash_summary where date = p_date;
  if v_summary.has_discrepancy and not (p_force and public.has_permission('scrap.manage')) then
    raise exception 'INSUFFICIENT_CASH: Recording this purchase would leave % with a negative closing cash of %.', p_date, v_summary.closing_cash_minor;
  end if;

  perform public.notify_by_permission(
    'scrap.manage',
    'New scrap purchase: ' || v_item.name,
    v_recorded_by_name || ' recorded ' || p_weight_kg || 'kg of ' || v_item.name || ' — KES ' || to_char(v_amount / 100.0, 'FM999,999,999.00') || ' on ' || p_date || '.',
    'INFO',
    auth.uid()
  );

  perform public.log_audit('CREATE_SCRAP_PURCHASE', 'scrap_purchases', v_purchase.id, null, to_jsonb(v_purchase));
  return v_purchase;
end; $$;

-- ── New scrap expense ────────────────────────────────────────────────────
create or replace function public.scrap_record_expense(
  p_date date, p_change_in_days integer, p_expense_type text, p_description text, p_amount_minor integer, p_notes text default null, p_force boolean default false
) returns public.scrap_expenses
language plpgsql security definer set search_path = public as $$
declare v_expense public.scrap_expenses%rowtype; v_summary public.scrap_cash_summary%rowtype; v_type text := nullif(trim(coalesce(p_expense_type, '')), ''); v_recorded_by_name text;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record scrap expenses'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in Days cannot be negative'; end if;
  if v_type is null then raise exception 'Expense type is required'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  select coalesce(pr.full_name, au.email, 'Staff') into v_recorded_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  insert into public.scrap_expenses(daily_record_id, category, amount_minor, description, date, change_in_days, notes, created_by, created_by_name)
  values (null, v_type, p_amount_minor, nullif(trim(coalesce(p_description, '')), ''), p_date, coalesce(p_change_in_days, 0), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), v_recorded_by_name)
  returning * into v_expense;

  perform public.scrap_recompute_cash_from(p_date);
  select * into v_summary from public.scrap_cash_summary where date = p_date;
  if v_summary.has_discrepancy and not (p_force and public.has_permission('scrap.manage')) then
    raise exception 'INSUFFICIENT_CASH: Recording this expense would leave % with a negative closing cash of %.', p_date, v_summary.closing_cash_minor;
  end if;

  perform public.notify_by_permission(
    'scrap.manage',
    'New scrap expense: ' || v_type,
    v_recorded_by_name || ' recorded a ' || v_type || ' expense of KES ' || to_char(p_amount_minor / 100.0, 'FM999,999,999.00') || ' on ' || p_date || '.',
    'INFO',
    auth.uid()
  );

  perform public.log_audit('CREATE_SCRAP_EXPENSE', 'scrap_expenses', v_expense.id, null, to_jsonb(v_expense));
  return v_expense;
end; $$;

-- ── New scrap cash added ─────────────────────────────────────────────────
create or replace function public.scrap_add_cash(
  p_date date, p_change_in_days integer, p_amount_minor integer,
  p_added_by text default null, p_reason text default null, p_reference text default null, p_notes text default null
) returns public.cash_transactions
language plpgsql security definer set search_path = public as $$
declare v_tx public.cash_transactions%rowtype; v_recorded_by_name text;
begin
  if not public.has_permission('scrap.record') then raise exception 'Not authorized to record cash added'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_date > current_date then raise exception 'Cannot record a future date'; end if;
  if coalesce(p_change_in_days, 0) < 0 then raise exception 'Change in Days cannot be negative'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  insert into public.cash_transactions(date, change_in_days, transaction_type, amount_minor, added_by, reason, reference, notes, created_by)
  values (p_date, coalesce(p_change_in_days, 0), 'CASH_ADDED', p_amount_minor, nullif(trim(coalesce(p_added_by, '')), ''), nullif(trim(coalesce(p_reason, '')), ''), nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_tx;

  perform public.scrap_recompute_cash_from(p_date);

  select coalesce(pr.full_name, au.email, 'Staff') into v_recorded_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  perform public.notify_by_permission(
    'scrap.manage',
    'Scrap cash added',
    v_recorded_by_name || ' added KES ' || to_char(p_amount_minor / 100.0, 'FM999,999,999.00') || ' to the scrap yard cash on ' || p_date || '.',
    'INFO',
    auth.uid()
  );

  perform public.log_audit('ADD_SCRAP_CASH', 'cash_transactions', v_tx.id, null, to_jsonb(v_tx));
  return v_tx;
end; $$;

-- ── New sale ─────────────────────────────────────────────────────────────
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
