/*
# Oakland Motors auth hardening — setup state, account status, race-safe initialization

1. Problem being fixed
- `handle_new_staff_user` assigned ADMIN to whichever auth.users row happened to be first
  based on `not exists(select 1 from user_roles)` — exploitable by a race between two
  concurrent signups, and relies entirely on the frontend never exposing a signup form.
- There is no account status (invited/active/suspended/disabled), so a suspended employee
  keeps full access until manually stripped of every role.

2. Fix
- Reuses `business_settings` (already a singleton row) as the system-initialization marker
  instead of creating a new table.
- Adds `initialize_system()`, a SECURITY DEFINER RPC that row-locks the singleton settings
  row (`for update`), so concurrent initialization attempts serialize instead of racing, and
  is the only path that can ever grant the first ADMIN role.
- Adds `is_system_initialized()`, callable by anon, so the pre-login screen can decide
  whether to show the setup wizard without loosening business_settings RLS.
- Adds `profiles.status` (INVITED/ACTIVE/SUSPENDED/DISABLED). `has_permission()` now also
  requires status = 'ACTIVE', so a suspended/disabled user loses all access on their very
  next query — no session revocation needed.
- Adds a trigger that flips an invited user to ACTIVE the moment they confirm their email
  (i.e. finish Supabase's invite-link password-set flow).

3. Backfill
- This deployment already has a working ADMIN and one business_settings row. The backfill
  marks business_settings as already initialized (since an ADMIN already exists) and marks
  every profile that already holds a role as ACTIVE, so this migration does not lock out
  the existing installation.
*/

-- ── 1. Setup-state columns on the existing business_settings singleton ────
alter table public.business_settings add column if not exists initialized boolean not null default false;
alter table public.business_settings add column if not exists initialized_by uuid references auth.users(id);
alter table public.business_settings add column if not exists initialized_at timestamptz;

update public.business_settings set initialized = true, initialized_at = coalesce(initialized_at, now())
where initialized = false
  and exists(select 1 from public.roles r join public.user_roles ur on ur.role_id = r.id where r.name = 'ADMIN');

-- ── 2. Account status columns on profiles ──────────────────────────────────
alter table public.profiles add column if not exists status text not null default 'INVITED' check (status in ('INVITED','ACTIVE','SUSPENDED','DISABLED'));
alter table public.profiles add column if not exists invited_by uuid references auth.users(id);
alter table public.profiles add column if not exists invited_at timestamptz;
alter table public.profiles add column if not exists activated_at timestamptz;

update public.profiles p set status = 'ACTIVE', activated_at = coalesce(activated_at, now())
where status = 'INVITED' and exists(select 1 from public.user_roles ur where ur.user_id = p.id);

-- ── 3. has_permission now also requires an ACTIVE profile ─────────────────
create or replace function public.has_permission(permission_key text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles pr on pr.id = ur.user_id
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and pr.status = 'ACTIVE'
      and (r.name = 'ADMIN' or p.key = permission_key)
  );
$$;
revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated;

-- ── 4. Bootstrap trigger no longer assigns roles ───────────────────────────
create or replace function public.handle_new_staff_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, full_name, status)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)), 'INVITED')
  on conflict(id) do nothing;
  return new;
end; $$;
revoke all on function public.handle_new_staff_user() from public;

-- ── 5. Race-safe, one-time, auditable system initialization ───────────────
create or replace function public.initialize_system(p_business_name text, p_address text default null, p_phone text default null, p_email text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_already boolean; v_admin_role uuid;
begin
  if auth.uid() is null then raise exception 'Must be authenticated to initialize the system'; end if;

  select initialized into v_already from public.business_settings limit 1 for update;
  if not found then raise exception 'business_settings has not been seeded'; end if;
  if v_already then raise exception 'System has already been initialized'; end if;

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
revoke all on function public.initialize_system(text, text, text, text) from public, anon;
grant execute on function public.initialize_system(text, text, text, text) to authenticated;

create or replace function public.is_system_initialized() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select initialized from public.business_settings limit 1), false);
$$;
revoke all on function public.is_system_initialized() from public;
grant execute on function public.is_system_initialized() to anon, authenticated;

-- ── 6. Flip INVITED -> ACTIVE when an invited user confirms their email ───
create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles set status = 'ACTIVE', activated_at = now() where id = new.id and status = 'INVITED';
    perform public.log_audit('USER_ACTIVATED', 'profiles', new.id, null, jsonb_build_object('email', new.email), null);
  end if;
  return new;
end; $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update on auth.users for each row execute function public.handle_user_confirmed();
revoke all on function public.handle_user_confirmed() from public;
