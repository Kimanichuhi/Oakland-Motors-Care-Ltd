/*
# Oakland Motor Care Ltd — stock movement traceability + admin notifications

1. Problem being fixed
- receive_stock never recorded a reference_id, so a purchase-order goods receipt
  couldn't be traced back to its PO from the part's stock movement history (SALE
  and JOB_CARD_USAGE movements already carry reference_id — this brings PURCHASE
  in line with them).
- create_notification existed but nothing ever called it — the Notifications
  screen and bell icon had no way to ever show anything.
- adjust_stock (stock count corrections, damage/loss write-offs) had no
  notification step, so a stock edit — a security-sensitive action since it can
  move value on/off the books outside the normal receive/sale/issue flows —
  produced only a row in stock_movements/audit_logs that nobody would see
  unless they went looking.

2. Fix
- receive_stock gains an optional p_reference_id uuid parameter (defaults to
  null for the manual "Receive stock" form, set to the purchase_order id when
  received against a PO) and stores it on the movement row.
- Adds notify_admins(title, message, type, exclude_user_id) — inserts a
  notification for every ADMIN user (skipping the actor, since they already
  know what they just did) via the existing create_notification-style insert.
- adjust_stock now calls notify_admins with the actor's name, the part, the
  adjustment direction/quantity, and the reason after every adjustment.

3. Non-destructive
- No data deleted. receive_stock is dropped and recreated only because adding
  a parameter changes its signature; the old 4-arg call from the manual
  "Receive stock" form still works unchanged since the new parameter defaults
  to null.
*/

create or replace function public.notify_admins(p_title text, p_message text, p_type text default 'INFO', p_exclude_user_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, title, message, type)
  select ur.user_id, p_title, p_message, p_type
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where r.name = 'ADMIN' and (p_exclude_user_id is null or ur.user_id <> p_exclude_user_id);
end; $$;
revoke all on function public.notify_admins(text, text, text, uuid) from public, anon;
grant execute on function public.notify_admins(text, text, text, uuid) to authenticated;

drop function if exists public.receive_stock(uuid, integer, integer, text);
create or replace function public.receive_stock(p_part_id uuid, p_quantity integer, p_unit_cost_minor integer, p_reference text, p_reference_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous integer; v_new integer; v_movement_id uuid;
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
revoke all on function public.receive_stock(uuid, integer, integer, text, uuid) from public, anon;
grant execute on function public.receive_stock(uuid, integer, integer, text, uuid) to authenticated;

create or replace function public.adjust_stock(p_part_id uuid, p_adjustment_type text, p_quantity integer, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous integer; v_new integer; v_movement_id uuid; v_delta integer; v_actor_name text;
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
      || ' ' || p_quantity || ' unit(s) of ' || v_part.name || ' (' || v_previous || ' -> ' || v_new || '). Reason: ' || p_reason,
    'WARNING',
    auth.uid()
  );

  return v_movement_id;
end; $$;
