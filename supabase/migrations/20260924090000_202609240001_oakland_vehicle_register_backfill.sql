/*
# Vehicle Register — one-time backfill from existing Work Orders

Auto check-in (5800c38) only fires for work orders created going forward.
This backfills Vehicle Register entries for every work order that already
exists, so the register reflects history instead of starting empty.

Rules:
- Only work orders that were actually received (received_at is not null —
  i.e. reached OPEN at some point). A DRAFT that was never opened, or
  cancelled while still a DRAFT, never had a car on the premises per the
  app's own workflow, so it's skipped.
- date/time_in come from created_at (for the CSV bulk-imported historical
  jobs this was explicitly backdated to the real "Date In"; received_at/
  released_at on those rows reflect the import run instead, so they're not
  trustworthy for dates — only for a same-day time-of-day estimate).
- COMPLETED/CANCELLED work orders get a time_out (released_at's time of
  day, else updated_at's, else 17:00) so old, finished jobs don't clutter
  the "currently inside" view. OPEN/IN_PROGRESS/ON_HOLD are left with no
  time_out, since those cars plausibly are still in the garage.
- Skips creating a second open (time_out is null) entry for a plate that
  already has one, matching the live auto-check-in's own dedupe rule.
*/

do $$
declare
  r record;
  v_date date;
  v_time_in time;
  v_time_out time;
  v_make_model text;
  v_has_open boolean;
begin
  for r in
    select jc.created_at, jc.released_at, jc.updated_at, jc.status,
           v.registration_number, v.make, v.model
    from public.job_cards jc
    join public.vehicles v on v.id = jc.vehicle_id
    where jc.deleted_at is null
      and jc.received_at is not null
    order by jc.created_at
  loop
    v_date := (r.created_at at time zone 'Africa/Nairobi')::date;
    v_time_in := (r.created_at at time zone 'Africa/Nairobi')::time;
    v_make_model := coalesce(nullif(trim(coalesce(r.make, '') || ' ' || coalesce(r.model, '')), ''), r.registration_number);

    if r.status in ('COMPLETED', 'CANCELLED') then
      v_time_out := coalesce(
        (r.released_at at time zone 'Africa/Nairobi')::time,
        (r.updated_at at time zone 'Africa/Nairobi')::time,
        '17:00'::time
      );
      if v_time_out <= v_time_in then
        v_time_out := v_time_in + interval '1 minute';
      end if;
    else
      v_time_out := null;
    end if;

    if v_time_out is null then
      select exists(
        select 1 from public.vehicle_register vr
        where vr.status = 'ACTIVE' and vr.time_out is null
          and lower(vr.registration_number) = lower(r.registration_number)
      ) into v_has_open;
      if v_has_open then
        continue;
      end if;
    end if;

    insert into public.vehicle_register (date, registration_number, make_model, time_in, time_out)
    values (v_date, r.registration_number, v_make_model, v_time_in, v_time_out);
  end loop;
end $$;
