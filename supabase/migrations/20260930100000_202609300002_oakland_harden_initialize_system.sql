/*
# Harden initialize_system() against a stale/incorrect initialized flag

business_settings.initialized was found set to false in production despite two ADMIN
accounts already existing and the system being in active daily use — meaning
initialize_system() (gated only by that flag) would have let any authenticated user
grant themselves ADMIN. The flag has been corrected directly on the live database as
an immediate fix; this migration adds a second, independent guard so the same class of
bug (the flag falling out of sync with reality, for any reason) can never again result
in a second ADMIN role being silently grantable: it now also refuses to run if an
ADMIN role is already assigned to anyone, regardless of what the flag says.
*/

create or replace function public.initialize_system(p_business_name text, p_address text default null, p_phone text default null, p_email text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_already boolean; v_admin_role uuid;
begin
  if auth.uid() is null then raise exception 'Must be authenticated to initialize the system'; end if;

  select initialized into v_already from public.business_settings limit 1 for update;
  if not found then raise exception 'business_settings has not been seeded'; end if;
  if v_already then raise exception 'System has already been initialized'; end if;
  if exists(select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where r.name = 'ADMIN') then
    raise exception 'System has already been initialized';
  end if;

  update public.business_settings set
    initialized = true,
    initialized_by = auth.uid(),
    initialized_at = now(),
    business_name = coalesce(nullif(p_business_name, ''), business_name),
    address = coalesce(p_address, address),
    phone = coalesce(p_phone, phone),
    email = coalesce(p_email, email);

  select id into v_admin_role from public.roles where name = 'ADMIN';
  insert into public.user_roles(user_id, role_id) values (auth.uid(), v_admin_role) on conflict do nothing;

  insert into public.profiles(id, full_name, status, activated_at)
  values (auth.uid(), '', 'ACTIVE', now())
  on conflict(id) do update set status = 'ACTIVE', activated_at = now();

  perform public.log_audit('SYSTEM_INITIALIZED', 'business_settings', null, null, jsonb_build_object('business_name', p_business_name), null);
end; $$;
