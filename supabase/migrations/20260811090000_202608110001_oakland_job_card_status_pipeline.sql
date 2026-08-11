/*
# Oakland Motor Care Ltd Job Card module — status pipeline overhaul

1. Purpose
- Replaces the current 9-status job_cards pipeline with the 12-status workshop pipeline
  from the Job Card spec: DRAFT -> RECEIVED -> INSPECTION -> DIAGNOSIS ->
  AWAITING_APPROVAL -> APPROVED -> WAITING_FOR_PARTS -> IN_PROGRESS -> QUALITY_CHECK ->
  READY_FOR_COLLECTION -> COLLECTED -> CLOSED (+ CANCELLED reachable from most
  non-terminal states, + QUALITY_CHECK -> IN_PROGRESS for rework).
- Existing in-flight job cards are data-migrated onto the closest new status so nothing
  is silently lost or left in an invalid state.
- Adds job_types, promised_at, received_at, released_at to job_cards. received_at/
  released_at are auto-stamped by transition_job_status() itself (entering RECEIVED /
  COLLECTED), not left to client-supplied timestamps.
- READY_FOR_COLLECTION now requires a PASSED row in job_card_quality_checks (added in the
  next migration) before the RPC allows the transition — the quality-check gate from the
  spec's Part 21.
- Retires job_cards.diagnosis (a single free-text column) in favor of the new
  job_card_diagnosis table (next migration), which supports multiple dated entries
  instead of one field being overwritten every time. Existing non-null values are
  backfilled as the first diagnosis entry before the column is dropped.
*/

-- ── 1. Backfill existing free-text diagnosis into job_card_diagnosis (created next
--      migration) is deferred until that table exists; here we just preserve the values
--      in a temp holding table so nothing is lost between migrations in this batch.
create table if not exists public._diagnosis_backfill (job_card_id uuid primary key, diagnosis text, technician_id uuid);
insert into public._diagnosis_backfill (job_card_id, diagnosis, technician_id)
select id, diagnosis, updated_by from public.job_cards where diagnosis is not null and trim(diagnosis) <> '';

-- ── 2. New columns ──────────────────────────────────────────────────────────
alter table public.job_cards add column if not exists job_types text[] not null default '{}';
alter table public.job_cards add column if not exists promised_at timestamptz;
alter table public.job_cards add column if not exists received_at timestamptz;
alter table public.job_cards add column if not exists released_at timestamptz;

alter table public.job_cards drop constraint if exists job_cards_job_types_check;
alter table public.job_cards add constraint job_cards_job_types_check check (
  job_types <@ array['SERVICE','REPAIR','DIAGNOSTICS','BODY_WORK','ACCIDENT_REPAIR','MAINTENANCE','AGRICULTURAL_MACHINERY','TRACTOR_REPAIR','EQUIPMENT_REPAIR','OTHER']::text[]
);

-- ── 3. Data-migrate existing statuses onto the new pipeline before changing the
--      constraint (the old constraint stays in force until step 4, so this must use
--      only old-pipeline status names as targets where the row isn't already valid).
update public.job_cards set status = 'COLLECTED' where status = 'DELIVERED';
update public.job_cards set status = 'WAITING_FOR_PARTS' where status = 'AWAITING_PARTS';
update public.job_cards set status = 'DIAGNOSIS' where status = 'DIAGNOSING';
update public.job_cards set status = 'QUALITY_CHECK' where status = 'COMPLETED';
update public.job_cards set status = 'READY_FOR_COLLECTION' where status = 'READY_FOR_PICKUP';
-- RECEIVED, AWAITING_APPROVAL, APPROVED, IN_PROGRESS, CANCELLED already have matching names.

update public.job_cards set received_at = created_at where received_at is null and status <> 'DRAFT';
update public.job_cards set released_at = updated_at where released_at is null and status = 'COLLECTED';

-- ── 4. Replace the status CHECK constraint with the new 12-status + CANCELLED set ──
alter table public.job_cards drop constraint if exists job_cards_status_check;
alter table public.job_cards alter column status set default 'DRAFT';
alter table public.job_cards add constraint job_cards_status_check check (status in (
  'DRAFT','RECEIVED','INSPECTION','DIAGNOSIS','AWAITING_APPROVAL','APPROVED',
  'WAITING_FOR_PARTS','IN_PROGRESS','QUALITY_CHECK','READY_FOR_COLLECTION','COLLECTED','CLOSED','CANCELLED'
));

-- ── 5. job_statuses lookup table reseed ────────────────────────────────────
delete from public.job_statuses;
insert into public.job_statuses(name, label, sort_order, is_terminal) values
  ('DRAFT','Draft',1,false),
  ('RECEIVED','Received',2,false),
  ('INSPECTION','Inspection',3,false),
  ('DIAGNOSIS','Diagnosis',4,false),
  ('AWAITING_APPROVAL','Awaiting Approval',5,false),
  ('APPROVED','Approved',6,false),
  ('WAITING_FOR_PARTS','Waiting for Parts',7,false),
  ('IN_PROGRESS','In Progress',8,false),
  ('QUALITY_CHECK','Quality Check',9,false),
  ('READY_FOR_COLLECTION','Ready for Collection',10,false),
  ('COLLECTED','Collected',11,false),
  ('CLOSED','Closed',12,true),
  ('CANCELLED','Cancelled',13,true);

-- ── 6. Rewrite transition_job_status() for the new graph ──────────────────
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
