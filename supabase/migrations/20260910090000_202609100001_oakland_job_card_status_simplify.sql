/*
# Oakland Motor Care Ltd — simplify the job card status workflow

The 12-status pipeline (DRAFT/RECEIVED/INSPECTION/DIAGNOSIS/AWAITING_APPROVAL/
APPROVED/WAITING_FOR_PARTS/IN_PROGRESS/QUALITY_CHECK/READY_FOR_COLLECTION/
COLLECTED/CLOSED/CANCELLED) was built for an inspection/diagnosis/quality-check
workflow that the job card UI no longer has. Collapsing it to match what was
actually asked for: DRAFT -> OPEN -> IN_PROGRESS -> COMPLETED, with CANCELLED
reachable from any non-terminal state.

Existing rows are remapped rather than left to violate the new constraint:
  DRAFT                                          -> DRAFT
  RECEIVED, INSPECTION, DIAGNOSIS,
  AWAITING_APPROVAL, APPROVED                     -> OPEN
  WAITING_FOR_PARTS, IN_PROGRESS, QUALITY_CHECK   -> IN_PROGRESS
  READY_FOR_COLLECTION, COLLECTED, CLOSED         -> COMPLETED
  CANCELLED                                       -> CANCELLED

IN_PROGRESS stays the checkpoint that issues pending parts from inventory
(added in the deferred-parts migration) — untouched here.
*/

update public.job_cards set status = case status
  when 'RECEIVED' then 'OPEN'
  when 'INSPECTION' then 'OPEN'
  when 'DIAGNOSIS' then 'OPEN'
  when 'AWAITING_APPROVAL' then 'OPEN'
  when 'APPROVED' then 'OPEN'
  when 'WAITING_FOR_PARTS' then 'IN_PROGRESS'
  when 'QUALITY_CHECK' then 'IN_PROGRESS'
  when 'READY_FOR_COLLECTION' then 'COMPLETED'
  when 'COLLECTED' then 'COMPLETED'
  when 'CLOSED' then 'COMPLETED'
  else status
end
where status not in ('DRAFT','OPEN','IN_PROGRESS','COMPLETED','CANCELLED');

alter table public.job_cards drop constraint if exists job_cards_status_check;
alter table public.job_cards add constraint job_cards_status_check check (
  status in ('DRAFT','OPEN','IN_PROGRESS','COMPLETED','CANCELLED')
);

create or replace function public.transition_job_status(p_job_card_id uuid, p_new_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_job public.job_cards%rowtype; v_valid_transitions text[];
begin
  select * into v_job from public.job_cards where id = p_job_card_id for update;
  if not found then raise exception 'Job card not found'; end if;
  if v_job.status = p_new_status then return; end if;
  v_valid_transitions := case v_job.status
    when 'DRAFT' then array['OPEN','CANCELLED']
    when 'OPEN' then array['IN_PROGRESS','CANCELLED']
    when 'IN_PROGRESS' then array['COMPLETED','CANCELLED']
    when 'COMPLETED' then array[]::text[]
    when 'CANCELLED' then array[]::text[]
    else array[]::text[]
  end;
  if not (p_new_status = any(v_valid_transitions)) then raise exception 'Invalid status transition from % to %', v_job.status, p_new_status; end if;

  if p_new_status = 'COMPLETED' and not public.has_permission('job.complete') then
    raise exception 'Not authorized to complete jobs';
  end if;
  if p_new_status in ('OPEN','IN_PROGRESS') and not public.has_permission('job.update') then
    raise exception 'Not authorized to update jobs';
  end if;

  if p_new_status = 'IN_PROGRESS' then
    perform public.issue_pending_job_card_parts(p_job_card_id, v_job.job_number);
  end if;

  insert into public.job_card_status_history(job_card_id, from_status, to_status, changed_by)
  values (p_job_card_id, v_job.status, p_new_status, auth.uid());

  update public.job_cards set
    status = p_new_status,
    updated_by = auth.uid(),
    received_at = case when p_new_status = 'OPEN' then coalesce(received_at, now()) else received_at end,
    released_at = case when p_new_status = 'COMPLETED' then coalesce(released_at, now()) else released_at end
  where id = p_job_card_id;

  perform public.log_audit('JOB_STATUS_CHANGE', 'job_cards', p_job_card_id, jsonb_build_object('status', v_job.status), jsonb_build_object('status', p_new_status), jsonb_build_object('reason', p_reason));
end; $$;
