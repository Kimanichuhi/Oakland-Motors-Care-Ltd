/*
# Oakland Motors authenticated staff bootstrap

1. Purpose
- Creates a profile automatically for each new authenticated user.
- Assigns the first account the ADMIN role so a new installation is usable immediately.
- Later accounts receive SERVICE_ADVISOR by default and can be changed by an administrator.

2. Security
- Role assignment is performed by a SECURITY DEFINER trigger and never trusted from browser input.
*/
create or replace function public.handle_new_staff_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare assigned_role uuid;
begin
  insert into public.profiles(id, full_name) values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1))) on conflict(id) do nothing;
  select id into assigned_role from public.roles where name = case when not exists(select 1 from public.user_roles) then 'ADMIN' else 'SERVICE_ADVISOR' end;
  if assigned_role is not null then insert into public.user_roles(user_id, role_id) values(new.id, assigned_role) on conflict do nothing; end if;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_staff_user();
revoke all on function public.handle_new_staff_user() from public;
