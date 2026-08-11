/*
# Oakland Motor Care Ltd Job Card module — sequential numbering

1. Purpose
- Replaces the client-side `JC-${year}-${Date.now().slice(-4)}` job number generation
  (timestamp-based — not sequential, and collision-prone since two job cards created in
  the same millisecond-truncated window could theoretically clash) with a real
  server-side sequential counter per year, generated atomically.
- Format: `{business_settings.job_card_prefix}-JC-{year}-{seq:06d}`, e.g.
  `OMC-JC-2026-000001` once job_card_prefix is set to "OMC" via Settings (it currently
  defaults to "JC", giving "JC-JC-2026-000001" until changed — a Settings action, not
  something a migration should silently overwrite on the business's behalf).

2. Concurrency
- `job_card_number_counters` holds one row per year. The counter is incremented via a
  single atomic UPDATE ... RETURNING, which Postgres serializes at the row level — two
  concurrent calls in the same year cannot receive the same sequence number.
*/

create table public.job_card_number_counters (
  year integer primary key,
  next_seq integer not null default 1
);
alter table public.job_card_number_counters enable row level security;
-- No policies: this is a purely internal counter, accessed only by generate_job_card_number()
-- (SECURITY DEFINER, runs as the table owner, bypasses RLS). Direct client access is never needed.

create or replace function public.generate_job_card_number() returns text
language plpgsql security definer set search_path = public as $$
declare v_year integer; v_seq integer; v_prefix text;
begin
  if not public.has_permission('job.create') then raise exception 'Not authorized to create job cards'; end if;

  v_year := extract(year from now())::integer;
  insert into public.job_card_number_counters(year, next_seq) values (v_year, 1)
    on conflict (year) do nothing;
  update public.job_card_number_counters set next_seq = next_seq + 1
    where year = v_year
    returning next_seq - 1 into v_seq;

  select job_card_prefix into v_prefix from public.business_settings limit 1;
  return coalesce(nullif(v_prefix, ''), 'JC') || '-JC-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
end; $$;
revoke all on function public.generate_job_card_number() from public, anon;
grant execute on function public.generate_job_card_number() to authenticated;
