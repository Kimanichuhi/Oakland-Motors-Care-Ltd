/*
# Oakland Motor Care Ltd Job Card module — structured child tables

1. Purpose
- Adds the structured records the physical Job Card captures that job_cards previously
  had no room for: a per-category vehicle condition inspection checklist, an unlimited
  list of work items (each independently assignable/trackable, unlike the old single
  recommended_work text field), multiple dated diagnosis entries (replacing the single
  diagnosis column dropped here), a quality-check checklist/result (the gate
  transition_job_status() now checks before READY_FOR_COLLECTION), and lightweight
  sign-off records (name + timestamp only — captured signature images are a later,
  Storage-dependent phase, deliberately deferred).
- RLS follows the exact pattern already established for job_card_labour/job_card_parts:
  view = job.view, insert/update = job.update (job.complete for quality checks, matching
  the same permission already gating job completion in transition_job_status()), delete =
  settings.manage. No new permission keys needed.
*/

-- ── 1. Inspection checklist (Part 8) ────────────────────────────────────────
create table public.job_card_inspection_items (
  id uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards(id) on delete cascade,
  category text not null check (category in ('ENGINE','TRANSMISSION','BRAKES','SUSPENSION','ELECTRICAL','TYRES','BODY_PAINT','OTHER')),
  condition text not null default 'NOT_CHECKED' check (condition in ('NORMAL','REQUIRES_ATTENTION','DAMAGED','NOT_CHECKED')),
  notes text,
  checked_by uuid references auth.users(id),
  checked_at timestamptz not null default now(),
  unique (job_card_id, category)
);
create index job_card_inspection_items_job_idx on public.job_card_inspection_items(job_card_id);

-- ── 2. Work items (Part 10) ─────────────────────────────────────────────────
create table public.job_card_work_items (
  id uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards(id) on delete cascade,
  description text not null,
  assigned_technician_id uuid references auth.users(id),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null default 'PENDING' check (status in ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
  notes text,
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_card_work_items_job_idx on public.job_card_work_items(job_card_id);
create trigger job_card_work_items_touch_updated_at before update on public.job_card_work_items for each row execute function public.touch_updated_at();

-- ── 3. Diagnosis (Part 11) — replaces job_cards.diagnosis ──────────────────
create table public.job_card_diagnosis (
  id uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards(id) on delete cascade,
  findings text not null,
  fault_codes text,
  observations text,
  recommended_repairs text,
  technician_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index job_card_diagnosis_job_idx on public.job_card_diagnosis(job_card_id);

insert into public.job_card_diagnosis (job_card_id, findings, technician_id, created_at)
select job_card_id, diagnosis, technician_id, now() from public._diagnosis_backfill;
drop table public._diagnosis_backfill;
alter table public.job_cards drop column if exists diagnosis;

-- ── 4. Quality check (Part 21) — the gate transition_job_status() checks ──
create table public.job_card_quality_checks (
  id uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards(id) on delete cascade,
  checklist jsonb not null default '{}'::jsonb,
  result text not null check (result in ('PASSED','FAILED','REWORK_REQUIRED')),
  notes text,
  checked_by uuid default auth.uid() references auth.users(id),
  checked_at timestamptz not null default now()
);
create index job_card_quality_checks_job_idx on public.job_card_quality_checks(job_card_id);

-- ── 5. Sign-off records (Part 19) — data only, no signature image yet ─────
create table public.job_card_signoffs (
  id uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards(id) on delete cascade,
  role text not null check (role in ('ADVISOR','TECHNICIAN','QUALITY_CHECK','CUSTOMER')),
  name text not null,
  signed_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  unique (job_card_id, role)
);
create index job_card_signoffs_job_idx on public.job_card_signoffs(job_card_id);

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
alter table public.job_card_inspection_items enable row level security;
alter table public.job_card_work_items enable row level security;
alter table public.job_card_diagnosis enable row level security;
alter table public.job_card_quality_checks enable row level security;
alter table public.job_card_signoffs enable row level security;

do $$
declare t text; insert_perm text; update_perm text;
  mapping text[][] := array[
    array['job_card_inspection_items','job.update','job.update'],
    array['job_card_work_items','job.update','job.update'],
    array['job_card_diagnosis','job.update','job.update'],
    array['job_card_quality_checks','job.complete','job.complete'],
    array['job_card_signoffs','job.update','BLOCK']
  ];
begin
  for i in 1 .. array_length(mapping, 1) loop
    t := mapping[i][1]; insert_perm := mapping[i][2]; update_perm := mapping[i][3];
    execute format('create policy "staff_select_%1$s" on public.%1$s for select to authenticated using(public.has_permission(''job.view''))', t);
    execute format('create policy "staff_insert_%1$s" on public.%1$s for insert to authenticated with check(public.has_permission(%2$L))', t, insert_perm);
    execute format(
      'create policy "staff_update_%1$s" on public.%1$s for update to authenticated using(%2$s) with check(%2$s)',
      t,
      case when update_perm = 'BLOCK' then 'false' else format('public.has_permission(%L)', update_perm) end
    );
    execute format('create policy "staff_delete_%1$s" on public.%1$s for delete to authenticated using(public.has_permission(''settings.manage''))', t);
  end loop;
end $$;
