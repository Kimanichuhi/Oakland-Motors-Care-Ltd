/*
# Oakland Motor Care Ltd — collapse RBAC down to two roles

Only two staff roles are needed going forward: ADMIN (full control — has_permission()
already bypasses every permission check for ADMIN, untouched here) and MANAGER
(read-only across every module). Service Advisor, Technician, Storekeeper,
Accountant, and Owner were never assigned to a live account (the only user_roles
row in production is ADMIN), so they are dropped outright rather than migrated.

Deleting a role cascades to role_permissions and user_roles (both declared
`on delete cascade` against roles.id in the core migration), so no separate
cleanup of those tables is needed for the removed roles.

MANAGER's permission set is replaced with view-only access: every permission key
ending in `.view`, plus `report.export` and `sales.report` (reading/exporting a
report doesn't mutate data). Every create/update/delete/issue/adjust/approve/
manage-type permission is removed from MANAGER.

The new-account bootstrap trigger defaulted every non-first signup to the now
removed SERVICE_ADVISOR role — updated to default to MANAGER instead so future
signups don't get assigned a role that no longer exists.
*/

delete from public.roles where name not in ('ADMIN','MANAGER');

delete from public.role_permissions
where role_id = (select id from public.roles where name = 'MANAGER');

insert into public.role_permissions(role_id, permission_id)
select (select id from public.roles where name = 'MANAGER'), p.id
from public.permissions p
where p.key like '%.view' or p.key in ('report.export','sales.report')
on conflict do nothing;

create or replace function public.handle_new_staff_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare assigned_role uuid;
begin
  insert into public.profiles(id, full_name) values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1))) on conflict(id) do nothing;
  select id into assigned_role from public.roles where name = case when not exists(select 1 from public.user_roles) then 'ADMIN' else 'MANAGER' end;
  if assigned_role is not null then insert into public.user_roles(user_id, role_id) values(new.id, assigned_role) on conflict do nothing; end if;
  return new;
end; $$;
