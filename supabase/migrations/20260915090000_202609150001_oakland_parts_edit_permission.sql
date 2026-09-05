/*
# Oakland Motor Care Ltd — allow admins to edit part details

1. Problem being fixed
- The `parts` table's update policy (set in the RBAC hardening migration) is
  hardcoded to `false` — direct client updates were blocked entirely so that
  quantity_on_hand could only move through the audited receive_stock/adjust_stock
  RPCs. That also blocked editing a part's non-quantity fields (name, prices,
  category, brand, reorder level, location, active flag), which has no RPC and
  no audit requirement, so there was no way to fix a part's details after
  creation from the UI.

2. Fix
- Adds an `inventory.update` permission to the catalog.
- Replaces the `parts` update policy's `false` with
  `has_permission('inventory.update')`. has_permission() already short-circuits
  true for ADMIN regardless of role_permissions rows, and MANAGER only holds
  `.view`-suffixed permissions since the two-role simplification, so this key
  is admin-only by default unless an admin explicitly grants it via
  Users & Roles.
- The parts edit form in the app never sends quantity_on_hand in its update
  payload, so this does not reopen a path around the stock-movement ledger.
*/

insert into public.permissions(key, label) values
  ('inventory.update','Edit part details')
on conflict (key) do nothing;

-- Cosmetic: mirrors the ADMIN role_permissions rows kept for other keys (has_permission()
-- bypasses ADMIN regardless, so this only keeps the Users & Roles screen's admin row checked).
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key = 'inventory.update'
where r.name = 'ADMIN'
on conflict do nothing;

drop policy if exists "staff_update_parts" on public.parts;
create policy "staff_update_parts" on public.parts for update to authenticated
  using(public.has_permission('inventory.update'))
  with check(public.has_permission('inventory.update'));
