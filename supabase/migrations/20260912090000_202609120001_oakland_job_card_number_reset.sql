/*
# Oakland Motor Care Ltd — job card numbers start from JB-001

The previous scheme produced `{prefix}-JC-{year}-{seq:06d}` (e.g. "JC-JC-2026-000001"
until the prefix was customized), reset per calendar year, and was keyed off a
per-year counter table. That's more than what was asked for: a single, simple,
never-resetting sequence starting at JB-001.

- `business_settings.job_card_prefix` default changes from 'JC' to 'JB' (and the
  live row is updated the same way, but only if it's still sitting on the untouched
  'JC' default — a business that already customized its prefix keeps its choice).
- The per-year `job_card_number_counters` table is replaced with a single-row
  `job_card_sequence` counter (same atomic UPDATE ... RETURNING pattern, just not
  keyed by year), so job numbers are `{prefix}-{seq:03d}` and never repeat or reset.
- Existing job cards keep whatever number they already have — only new job cards
  get the new format. Renumbering issued work orders after the fact would make
  already-printed paperwork disagree with the system.
*/

update public.business_settings set job_card_prefix = 'JB' where job_card_prefix = 'JC';
alter table public.business_settings alter column job_card_prefix set default 'JB';

drop table if exists public.job_card_number_counters;

create table public.job_card_sequence (
  id boolean primary key default true,
  next_seq integer not null default 1,
  constraint job_card_sequence_single_row check (id)
);
insert into public.job_card_sequence(id, next_seq) values (true, 1);
alter table public.job_card_sequence enable row level security;
-- No policies: purely internal, accessed only by generate_job_card_number() (SECURITY DEFINER).

create or replace function public.generate_job_card_number() returns text
language plpgsql security definer set search_path = public as $$
declare v_seq integer; v_prefix text;
begin
  if not public.has_permission('job.create') then raise exception 'Not authorized to create job cards'; end if;

  update public.job_card_sequence set next_seq = next_seq + 1 where id = true
    returning next_seq - 1 into v_seq;

  select job_card_prefix into v_prefix from public.business_settings limit 1;
  return coalesce(nullif(v_prefix, ''), 'JB') || '-' || lpad(v_seq::text, 3, '0');
end; $$;
revoke all on function public.generate_job_card_number() from public, anon;
grant execute on function public.generate_job_card_number() to authenticated;
