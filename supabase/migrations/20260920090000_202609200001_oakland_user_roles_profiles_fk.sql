/*
# Fix empty "Users & Roles" staff directory for admins

1. Problem
- The Users & Roles page loads staff via
  `supabase.from('profiles').select('*, user_roles(role_id, roles(name,label))')`,
  which asks PostgREST to embed `user_roles` under `profiles`.
- `user_roles.user_id` only has a foreign key to `auth.users(id)`, not to
  `public.profiles(id)`, so PostgREST cannot resolve that embed relationship.
  The request fails, `s.data` comes back null, and since the caller does
  `staff = s.data ?? []` without checking `s.error`, the directory silently
  renders "No staff yet" instead of surfacing the real error.

2. Fix
- Add a foreign key from `user_roles.user_id` to `public.profiles(id)` (in
  addition to the existing one on `auth.users(id)`) so PostgREST can embed
  `user_roles`/`roles` under `profiles`. Every `user_roles` row already has a
  matching `profiles` row (the `handle_new_user` trigger creates the profile
  before the role assignment), so this is safe to add against existing data.
*/

alter table public.user_roles drop constraint if exists user_roles_user_id_profiles_fkey;
alter table public.user_roles
  add constraint user_roles_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
