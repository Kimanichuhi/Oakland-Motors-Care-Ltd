/*
# Oakland Motor Care Ltd — Vehicle Register module

A simple digital logbook of vehicles entering/leaving the premises. Deliberately
independent of job_cards/customers/vehicles — five core fields (date, reg. no.,
make/model, time in, time out) plus a lightweight audit trail.

Writes go straight through RLS-gated table access (matching customers/vehicles),
not RPCs — this module has no multi-step business logic to protect atomically.
Two things still need server-side enforcement: normal staff may register entries
and fill in a blank Time Out, but only management can rewrite an already-set
field or void a record — that distinction is enforced by a trigger.
*/

insert into public.permissions(key, label) values
  ('vehicle_register.view','View vehicle register'),
  ('vehicle_register.record','Register vehicles and record time out'),
  ('vehicle_register.manage','Edit, void and export vehicle register records')
on conflict (key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('vehicle_register.view','vehicle_register.record','vehicle_register.manage')
where r.name in ('ADMIN','MANAGER')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('vehicle_register.view','vehicle_register.record')
where r.name in ('SERVICE_ADVISOR','STOREKEEPER','TECHNICIAN')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('vehicle_register.view')
where r.name in ('ACCOUNTANT','OWNER_READONLY')
on conflict do nothing;

create table public.vehicle_register (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  registration_number text not null,
  make_model text not null,
  time_in time not null,
  time_out time,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  void_reason text,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (registration_number <> ''),
  check (make_model <> ''),
  check (time_out is null or time_out > time_in)
);

create index vehicle_register_reg_idx on public.vehicle_register(lower(registration_number));
create index vehicle_register_date_idx on public.vehicle_register(date desc);
create index vehicle_register_open_idx on public.vehicle_register(date) where time_out is null and status = 'ACTIVE';

alter table public.vehicle_register enable row level security;

create policy "staff_select_vehicle_register" on public.vehicle_register
  for select to authenticated using (public.has_permission('vehicle_register.view'));

create policy "staff_insert_vehicle_register" on public.vehicle_register
  for insert to authenticated with check (public.has_permission('vehicle_register.record') or public.has_permission('vehicle_register.manage'));

create policy "staff_update_vehicle_register" on public.vehicle_register
  for update to authenticated
  using (public.has_permission('vehicle_register.record') or public.has_permission('vehicle_register.manage'))
  with check (public.has_permission('vehicle_register.record') or public.has_permission('vehicle_register.manage'));

create policy "staff_delete_vehicle_register" on public.vehicle_register
  for delete to authenticated using (public.has_permission('settings.manage'));

-- Non-managers may only add a Time Out that was previously blank — every other
-- field, and any already-recorded Time Out, requires vehicle_register.manage.
-- Managers get voided_by/voided_at stamped automatically on a void transition.
create or replace function public.vehicle_register_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('vehicle_register.manage') then
    if new.date is distinct from old.date
      or new.registration_number is distinct from old.registration_number
      or new.make_model is distinct from old.make_model
      or new.time_in is distinct from old.time_in
      or new.status is distinct from old.status then
      raise exception 'Not authorized to edit this vehicle register entry';
    end if;
    if old.time_out is not null and new.time_out is distinct from old.time_out then
      raise exception 'Not authorized to change a recorded Time Out';
    end if;
  end if;

  if new.status = 'VOID' and old.status <> 'VOID' then
    new.voided_by := auth.uid();
    new.voided_at := now();
  elsif new.status = 'ACTIVE' then
    new.voided_by := null;
    new.voided_at := null;
    new.void_reason := null;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end; $$;

create trigger vehicle_register_guard_update before update on public.vehicle_register
  for each row execute function public.vehicle_register_guard_update();
