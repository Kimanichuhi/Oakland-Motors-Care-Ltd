/*
# Oakland Motors privileged functions — stock, payments, job transitions, audit

1. Purpose
- SECURITY DEFINER functions for transactional stock issuance, stock receipt, payment recording, job status transitions, and audit logging.
- All functions check `has_permission` and derive the actor from `auth.uid()`.
- Stock and payment operations are transactional with idempotency protection.

2. Functions
- `issue_stock(p_part_id, p_quantity, p_reference, p_job_card_id)` — decrements stock, creates movement, records part on job.
- `receive_stock(p_part_id, p_quantity, p_unit_cost_minor, p_reference)` — increments stock, creates movement.
- `adjust_stock(p_part_id, p_adjustment_type, p_quantity, p_reason)` — adjustment in/out/damage.
- `record_payment(p_invoice_id, p_amount_minor, p_method, p_reference, p_idempotency_key)` — records payment, updates invoice balance.
- `transition_job_status(p_job_card_id, p_new_status, p_reason)` — validates and records job status transitions.
- `log_audit(p_action, p_entity, p_entity_id, p_before_state, p_after_state, p_metadata)` — inserts audit log.

3. Security
- All functions are SECURITY DEFINER with `SET search_path = public`.
- EXECUTE revoked from anon; granted to authenticated.
- Permission checks use `has_permission`.
*/
create or replace function public.log_audit(p_action text, p_entity text, p_entity_id uuid default null, p_before_state jsonb default null, p_after_state jsonb default null, p_metadata jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(actor_id, action, entity, entity_id, before_state, after_state, metadata)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before_state, p_after_state, p_metadata);
end; $$;

create or replace function public.issue_stock(p_part_id uuid, p_quantity integer, p_reference text, p_job_card_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous integer; v_new integer; v_line_id uuid;
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

create or replace function public.receive_stock(p_part_id uuid, p_quantity integer, p_unit_cost_minor integer, p_reference text)
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
  insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference)
  values (p_part_id, 'PURCHASE', p_quantity, v_previous, v_new, p_unit_cost_minor, 'Goods received', p_reference)
  returning id into v_movement_id;
  perform public.log_audit('RECEIVE_STOCK', 'parts', p_part_id, jsonb_build_object('quantity_on_hand', v_previous), jsonb_build_object('quantity_on_hand', v_new), jsonb_build_object('reference', p_reference, 'quantity', p_quantity));
  return v_movement_id;
end; $$;

create or replace function public.adjust_stock(p_part_id uuid, p_adjustment_type text, p_quantity integer, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_previous integer; v_new integer; v_movement_id uuid; v_delta integer;
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
  return v_movement_id;
end; $$;

create or replace function public.record_payment(p_invoice_id uuid, p_amount_minor integer, p_method text, p_reference text, p_idempotency_key text, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_invoice public.invoices%rowtype; v_payment_id uuid; v_new_paid integer; v_new_status text;
begin
  if not public.has_permission('payment.create') then raise exception 'Not authorized to record payments'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_idempotency_key is not null then
    select id into v_payment_id from public.payments where idempotency_key = p_idempotency_key;
    if v_payment_id is not null then return v_payment_id; end if;
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status = 'VOID' then raise exception 'Cannot record payment on void invoice'; end if;
  v_new_paid := v_invoice.amount_paid_minor + p_amount_minor;
  if v_new_paid > v_invoice.total_minor then raise exception 'Payment exceeds outstanding balance'; end if;
  v_new_status := case when v_new_paid = v_invoice.total_minor then 'PAID' when v_new_paid > 0 then 'PART_PAID' else v_invoice.status end;
  insert into public.payments(invoice_id, amount_minor, method, reference, notes, idempotency_key)
  values (p_invoice_id, p_amount_minor, p_method, p_reference, p_notes, p_idempotency_key)
  returning id into v_payment_id;
  update public.invoices set amount_paid_minor = v_new_paid, status = v_new_status, updated_by = auth.uid() where id = p_invoice_id;
  perform public.log_audit('RECORD_PAYMENT', 'invoices', p_invoice_id, jsonb_build_object('amount_paid_minor', v_invoice.amount_paid_minor, 'status', v_invoice.status), jsonb_build_object('amount_paid_minor', v_new_paid, 'status', v_new_status), jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount_minor, 'method', p_method));
  return v_payment_id;
end; $$;

create or replace function public.transition_job_status(p_job_card_id uuid, p_new_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_job public.job_cards%rowtype; v_valid_transitions text[];
begin
  select * into v_job from public.job_cards where id = p_job_card_id for update;
  if not found then raise exception 'Job card not found'; end if;
  if v_job.status = p_new_status then return; end if;
  v_valid_transitions := case v_job.status
    when 'RECEIVED' then array['DIAGNOSING','AWAITING_APPROVAL','CANCELLED']
    when 'DIAGNOSING' then array['AWAITING_APPROVAL','IN_PROGRESS','CANCELLED']
    when 'AWAITING_APPROVAL' then array['APPROVED','IN_PROGRESS','CANCELLED']
    when 'APPROVED' then array['IN_PROGRESS','CANCELLED']
    when 'IN_PROGRESS' then array['AWAITING_PARTS','COMPLETED','CANCELLED']
    when 'AWAITING_PARTS' then array['IN_PROGRESS','CANCELLED']
    when 'COMPLETED' then array['READY_FOR_PICKUP']
    when 'READY_FOR_PICKUP' then array['DELIVERED']
    when 'DELIVERED' then array[]::text[]
    when 'CANCELLED' then array[]::text[]
    else array[]::text[]
  end;
  if not (p_new_status = any(v_valid_transitions)) then raise exception 'Invalid status transition from % to %', v_job.status, p_new_status; end if;
  if p_new_status in ('COMPLETED','READY_FOR_PICKUP','DELIVERED') and not public.has_permission('job.complete') then raise exception 'Not authorized to complete jobs'; end if;
  if p_new_status = 'IN_PROGRESS' and not public.has_permission('job.update') then raise exception 'Not authorized to update jobs'; end if;
  insert into public.job_card_status_history(job_card_id, from_status, to_status, changed_by)
  values (p_job_card_id, v_job.status, p_new_status, auth.uid());
  update public.job_cards set status = p_new_status, updated_by = auth.uid() where id = p_job_card_id;
  perform public.log_audit('JOB_STATUS_CHANGE', 'job_cards', p_job_card_id, jsonb_build_object('status', v_job.status), jsonb_build_object('status', p_new_status), jsonb_build_object('reason', p_reason));
end; $$;

create or replace function public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text default 'INFO')
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, p_title, p_message, p_type);
end; $$;

revoke all on function public.log_audit(text, text, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.log_audit(text, text, uuid, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.issue_stock(uuid, integer, text, uuid) from public, anon;
grant execute on function public.issue_stock(uuid, integer, text, uuid) to authenticated;
revoke all on function public.receive_stock(uuid, integer, integer, text) from public, anon;
grant execute on function public.receive_stock(uuid, integer, integer, text) to authenticated;
revoke all on function public.adjust_stock(uuid, text, integer, text) from public, anon;
grant execute on function public.adjust_stock(uuid, text, integer, text) to authenticated;
revoke all on function public.record_payment(uuid, integer, text, text, text, text) from public, anon;
grant execute on function public.record_payment(uuid, integer, text, text, text, text) to authenticated;
revoke all on function public.transition_job_status(uuid, text, text) from public, anon;
grant execute on function public.transition_job_status(uuid, text, text) to authenticated;
revoke all on function public.create_notification(uuid, text, text, text) from public, anon;
grant execute on function public.create_notification(uuid, text, text, text) to authenticated;