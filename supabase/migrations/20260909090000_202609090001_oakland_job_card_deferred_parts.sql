/*
# Oakland Motor Care Ltd — deferred parts issuance for job cards

Today, adding a part to a job card calls issue_stock() immediately — stock is
deducted the instant a technician clicks "Add", even if the job card is still
a draft and the part never actually gets fitted. The physical Work Order and
the new smart-search parts UI both need the opposite: adding a part should
just record intent (no inventory effect), and stock should only be deducted
once the job is confirmed underway.

job_card_parts.issued_at was already nullable — this schema was clearly built
to support "added but not yet issued" vs "issued" from the start, it just
never had a code path that used that distinction. This migration adds one:

- add_job_card_part / remove_job_card_part manage NOT-yet-issued lines
  (issued_at is null) with no stock movement at all.
- transition_job_status, on a transition INTO 'IN_PROGRESS' (already a
  privileged checkpoint in that function), now issues every still-pending
  line for that job card in the same transaction — same accounting as
  issue_stock() (JOB_CARD_USAGE stock_movements row, quantity_on_hand
  deducted), just deferred to confirmation time. Safe to hit repeatedly if a
  job bounces back into IN_PROGRESS for rework — already-issued lines are
  skipped, only newly-pending ones are touched.

issue_stock() itself is untouched and keeps working exactly as before for any
other caller.
*/

create or replace function public.add_job_card_part(p_job_card_id uuid, p_part_id uuid, p_quantity integer)
returns public.job_card_parts
language plpgsql security definer set search_path = public as $$
declare v_part public.parts%rowtype; v_line public.job_card_parts%rowtype;
begin
  if not public.has_permission('inventory.issue') then raise exception 'Not authorized to add parts to a job card'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if not exists (select 1 from public.job_cards where id = p_job_card_id) then raise exception 'Job card not found'; end if;

  select * into v_part from public.parts where id = p_part_id and active = true;
  if not found then raise exception 'Part not found or inactive'; end if;
  if p_quantity > v_part.quantity_on_hand then
    raise exception 'Insufficient stock. Only % units are available.', v_part.quantity_on_hand;
  end if;

  insert into public.job_card_parts(job_card_id, part_id, quantity, unit_price_minor, issued_at)
  values (p_job_card_id, p_part_id, p_quantity, v_part.selling_price_minor, null)
  returning * into v_line;

  perform public.log_audit('ADD_JOB_CARD_PART', 'job_card_parts', v_line.id, null, to_jsonb(v_line));
  return v_line;
end; $$;

create or replace function public.remove_job_card_part(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_line public.job_card_parts%rowtype;
begin
  if not public.has_permission('inventory.issue') then raise exception 'Not authorized to remove parts from a job card'; end if;
  select * into v_line from public.job_card_parts where id = p_id for update;
  if not found then raise exception 'Job card part not found'; end if;
  if v_line.issued_at is not null then raise exception 'This part has already been issued from stock and cannot be removed here'; end if;
  delete from public.job_card_parts where id = p_id;
  perform public.log_audit('REMOVE_JOB_CARD_PART', 'job_card_parts', p_id, to_jsonb(v_line), null);
end; $$;

-- Internal only — called from transition_job_status, never directly by a client.
create or replace function public.issue_pending_job_card_parts(p_job_card_id uuid, p_reference text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_line public.job_card_parts%rowtype; v_part public.parts%rowtype; v_previous integer; v_new integer;
begin
  for v_line in select * from public.job_card_parts where job_card_id = p_job_card_id and issued_at is null for update loop
    select * into v_part from public.parts where id = v_line.part_id for update;
    if not found then raise exception 'Part not found for a pending job card line'; end if;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous - v_line.quantity;
    if v_new < 0 then raise exception 'Insufficient stock for %. Only % available.', v_part.name, v_previous; end if;

    update public.parts set quantity_on_hand = v_new where id = v_part.id;
    insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
    values (v_part.id, 'JOB_CARD_USAGE', -v_line.quantity, v_previous, v_new, v_line.unit_price_minor, 'Issued to job', p_reference, p_job_card_id);
    update public.job_card_parts set issued_at = now() where id = v_line.id;
  end loop;
end; $$;
revoke all on function public.issue_pending_job_card_parts(uuid, text) from public, anon, authenticated;

-- Hook deferred issuance into the existing IN_PROGRESS checkpoint.
create or replace function public.transition_job_status(p_job_card_id uuid, p_new_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_job public.job_cards%rowtype; v_valid_transitions text[];
begin
  select * into v_job from public.job_cards where id = p_job_card_id for update;
  if not found then raise exception 'Job card not found'; end if;
  if v_job.status = p_new_status then return; end if;
  v_valid_transitions := case v_job.status
    when 'DRAFT' then array['RECEIVED','CANCELLED']
    when 'RECEIVED' then array['INSPECTION','DIAGNOSIS','AWAITING_APPROVAL','CANCELLED']
    when 'INSPECTION' then array['DIAGNOSIS','AWAITING_APPROVAL','CANCELLED']
    when 'DIAGNOSIS' then array['AWAITING_APPROVAL','WAITING_FOR_PARTS','IN_PROGRESS','CANCELLED']
    when 'AWAITING_APPROVAL' then array['APPROVED','WAITING_FOR_PARTS','IN_PROGRESS','CANCELLED']
    when 'APPROVED' then array['WAITING_FOR_PARTS','IN_PROGRESS','CANCELLED']
    when 'WAITING_FOR_PARTS' then array['IN_PROGRESS','CANCELLED']
    when 'IN_PROGRESS' then array['QUALITY_CHECK','WAITING_FOR_PARTS','CANCELLED']
    when 'QUALITY_CHECK' then array['READY_FOR_COLLECTION','IN_PROGRESS','CANCELLED']
    when 'READY_FOR_COLLECTION' then array['COLLECTED']
    when 'COLLECTED' then array['CLOSED']
    when 'CLOSED' then array[]::text[]
    when 'CANCELLED' then array[]::text[]
    else array[]::text[]
  end;
  if not (p_new_status = any(v_valid_transitions)) then raise exception 'Invalid status transition from % to %', v_job.status, p_new_status; end if;

  if p_new_status in ('QUALITY_CHECK','READY_FOR_COLLECTION','COLLECTED','CLOSED') and not public.has_permission('job.complete') then
    raise exception 'Not authorized to complete jobs';
  end if;
  if p_new_status = 'IN_PROGRESS' and not public.has_permission('job.update') then
    raise exception 'Not authorized to update jobs';
  end if;
  if p_new_status = 'READY_FOR_COLLECTION' and not exists(
    select 1 from public.job_card_quality_checks where job_card_id = p_job_card_id and result = 'PASSED'
  ) then
    raise exception 'A passed quality check is required before this job can be released for collection';
  end if;

  if p_new_status = 'IN_PROGRESS' then
    perform public.issue_pending_job_card_parts(p_job_card_id, v_job.job_number);
  end if;

  insert into public.job_card_status_history(job_card_id, from_status, to_status, changed_by)
  values (p_job_card_id, v_job.status, p_new_status, auth.uid());

  update public.job_cards set
    status = p_new_status,
    updated_by = auth.uid(),
    received_at = case when p_new_status = 'RECEIVED' then coalesce(received_at, now()) else received_at end,
    released_at = case when p_new_status = 'COLLECTED' then coalesce(released_at, now()) else released_at end
  where id = p_job_card_id;

  perform public.log_audit('JOB_STATUS_CHANGE', 'job_cards', p_job_card_id, jsonb_build_object('status', v_job.status), jsonb_build_object('status', p_new_status), jsonb_build_object('reason', p_reason));
end; $$;

revoke all on function public.add_job_card_part(uuid, uuid, integer) from public, anon;
revoke all on function public.remove_job_card_part(uuid) from public, anon;
grant execute on function public.add_job_card_part(uuid, uuid, integer) to authenticated;
grant execute on function public.remove_job_card_part(uuid) to authenticated;
