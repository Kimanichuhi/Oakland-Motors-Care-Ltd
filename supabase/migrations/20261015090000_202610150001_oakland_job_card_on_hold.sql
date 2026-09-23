/*
# Add an ON_HOLD status for work orders

A car can sit in the garage with nothing actively happening to it — waiting
on a customer decision, a part, payment, whatever — without the job being
CANCELLED. There was no status for that: it either had to look ABANDONED
(cancel it) or ACTIVE (leave it OPEN/IN_PROGRESS and pretend work is
ongoing). This adds ON_HOLD, reachable from OPEN or IN_PROGRESS, resumable
only to IN_PROGRESS (whether it was paused before or during work, resuming
means work is happening again), or cancellable from hold like any other
non-terminal state.

Gated on job.update, the same permission that already covers OPEN/
IN_PROGRESS — putting a job on hold isn't a more sensitive action than
starting or advancing one.
*/

alter table public.job_cards drop constraint if exists job_cards_status_check;
alter table public.job_cards add constraint job_cards_status_check check (
  status in ('DRAFT','OPEN','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED')
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
    when 'OPEN' then array['IN_PROGRESS','ON_HOLD','CANCELLED']
    when 'IN_PROGRESS' then array['COMPLETED','ON_HOLD','CANCELLED']
    when 'ON_HOLD' then array['IN_PROGRESS','CANCELLED']
    when 'COMPLETED' then array[]::text[]
    when 'CANCELLED' then array[]::text[]
    else array[]::text[]
  end;
  if not (p_new_status = any(v_valid_transitions)) then raise exception 'Invalid status transition from % to %', v_job.status, p_new_status; end if;

  if p_new_status = 'COMPLETED' and not public.has_permission('job.complete') then
    raise exception 'Not authorized to complete jobs';
  end if;
  if p_new_status in ('OPEN','IN_PROGRESS','ON_HOLD') and not public.has_permission('job.update') then
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
