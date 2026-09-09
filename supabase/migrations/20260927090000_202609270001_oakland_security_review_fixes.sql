/*
# Security review fixes: signup auto-role regression, view RLS bypass, notification spoofing

1. handle_new_staff_user() — stop auto-assigning a role at signup
- 20260810120500_oakland_auth_hardening.sql deliberately removed role auto-assignment
  from this trigger (comment: exploitable race + relies on the frontend never exposing
  a signup form). 20260911090000_oakland_rbac_two_role_simplify.sql silently reintroduced
  it while collapsing RBAC to two roles, so every new auth.users row — however it was
  created — is now auto-granted MANAGER (broad .view access across the whole business)
  and self-activates the instant the user confirms their own email, no admin involved.
  Restored to the auth-hardening behavior: insert the profile as INVITED, assign no role.
  The only path that can ever grant the first ADMIN role remains initialize_system().

2. scrap_current_stock — stop bypassing scrap.view RLS
- Was a plain view granted to `authenticated` with no security_invoker, so it read
  scrap_items/stock_cycles as the view owner and ignored their scrap.view RLS policies.
  Recreated with security_invoker = true so it enforces RLS as the querying user, same
  as querying the underlying tables directly would.

3. create_notification() — remove the unused authenticated grant
- No permission check, and p_user_id/title/message/type are fully caller-controlled, so
  any authenticated account could spoof a notification into anyone else's feed. Nothing
  in the app ever calls this RPC directly — only internal SECURITY DEFINER trigger
  functions do, and those run under the (privileged) function-owner role regardless of
  grants to `authenticated`. Revoking the grant closes the direct-call path without
  touching any legitimate caller.
*/

-- ── 1. Signup no longer auto-assigns a role ─────────────────────────────────
create or replace function public.handle_new_staff_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, status)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)), 'INVITED')
  on conflict(id) do nothing;
  return new;
end; $$;

-- ── 2. scrap_current_stock enforces RLS as the querying user ───────────────
create or replace view public.scrap_current_stock
with (security_invoker = true) as
select
  si.id as scrap_item_id, si.name, si.current_rate_minor, si.active,
  sc.id as stock_cycle_id, sc.cycle_number, sc.opening_quantity, sc.opening_date,
  coalesce(sc.current_quantity, 0) as current_quantity
from public.scrap_items si
left join public.stock_cycles sc on sc.scrap_item_id = si.id and sc.status = 'OPEN';

-- ── 3. create_notification is internal-only ─────────────────────────────────
revoke execute on function public.create_notification(uuid, text, text, text) from authenticated;
