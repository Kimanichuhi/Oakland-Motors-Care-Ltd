/*
# Oakland Motors RBAC hardening — real per-action permission enforcement

1. Problem being fixed
- `role_permissions` was seeded by cross-joining every permission to every role except
  OWNER_READONLY, so every staff role effectively held every permission.
- Every table's RLS policy checked the same blanket `dashboard.view` permission for
  select/insert/update regardless of the table, so the permission model had no effect
  at the database layer — only the UI hid buttons.
- Ledger tables (stock_movements, stock_adjustments, audit_logs, job_card_status_history,
  payments, mpesa_transactions, job_card_parts) are meant to be written exclusively by the
  SECURITY DEFINER RPCs (issue_stock, receive_stock, adjust_stock, record_payment,
  transition_job_status, log_audit) but could previously be written directly by any staff
  member, bypassing every balance/idempotency/audit guarantee those RPCs provide.

2. Fix
- Reconciles `permissions` with the frontend's PERMISSIONS constant (adds users.manage and
  a few keys that existed in lib/constants.ts but not in the database).
- Replaces the blanket role_permissions seed with an explicit least-privilege grant per role.
- Rewrites every table's select/insert/update policy to check the semantically correct
  permission instead of `dashboard.view`.
- Blocks direct authenticated writes entirely (`using (false)`) on ledger tables — the
  SECURITY DEFINER RPCs still work because they execute as the table owner, which bypasses RLS.
- Adds row-ownership policies for `profiles` (self-edit) and `notifications` (own rows only),
  which were previously readable/writable by any staff member.
- Adds missing insert/update/delete policies on `role_permissions` (previously had none,
  so the existing "Users & Roles" permission toggle silently failed under RLS).

3. Non-destructive
- No table/column changes, no data deleted. Only policies and role_permissions rows change.
*/

-- ── 1. Reconcile permission catalog ─────────────────────────────────────────
insert into public.permissions(key, label) values
  ('customer.delete','Delete customers'),
  ('job.deliver','Mark jobs delivered'),
  ('purchase_order.approve','Approve purchase orders'),
  ('purchase_order.receive','Receive purchase orders'),
  ('quotation.reject','Reject quotations'),
  ('invoice.void','Void invoices'),
  ('payment.reverse','Reverse payments'),
  ('users.manage','Manage users, roles and invitations')
on conflict (key) do nothing;

-- ── 2. Replace blanket role_permissions seed with least-privilege grants ───
delete from public.role_permissions
using public.roles r
where role_permissions.role_id = r.id and r.name <> 'ADMIN';
-- ADMIN keeps whatever rows exist (has_permission() short-circuits ADMIN to true regardless,
-- so ADMIN's row_permissions rows are cosmetic; leaving them avoids disturbing the ADMIN UI).

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'dashboard.view','job.view','job.update','vehicle.view','customer.view'
) where r.name = 'TECHNICIAN'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'dashboard.view','inventory.view','inventory.create','inventory.issue','inventory.receive','inventory.adjust',
  'purchase_order.view','purchase_order.create','purchase_order.receive',
  'supplier.view','supplier.create','supplier.update'
) where r.name = 'STOREKEEPER'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'dashboard.view','payment.view','payment.create','payment.reverse',
  'invoice.view','invoice.create','invoice.update','invoice.void',
  'quotation.view','customer.view','report.view','report.export'
) where r.name = 'ACCOUNTANT'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'dashboard.view','customer.view','customer.create','customer.update',
  'vehicle.view','vehicle.create','vehicle.update',
  'job.view','job.create',
  'quotation.view','quotation.create','quotation.approve','quotation.reject',
  'invoice.view','report.view'
) where r.name = 'SERVICE_ADVISOR'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'dashboard.view','customer.view','customer.create','customer.update','customer.delete',
  'vehicle.view','vehicle.create','vehicle.update',
  'job.view','job.create','job.update','job.assign','job.complete','job.deliver',
  'inventory.view','inventory.create','inventory.issue','inventory.receive','inventory.adjust',
  'supplier.view','supplier.create','supplier.update',
  'purchase_order.view','purchase_order.create','purchase_order.approve','purchase_order.receive',
  'quotation.view','quotation.create','quotation.approve','quotation.reject',
  'invoice.view','invoice.create','invoice.update','invoice.void',
  'payment.view','payment.create','payment.reverse',
  'report.view','report.export','audit.view'
) where r.name = 'MANAGER'
on conflict do nothing;

-- OWNER_READONLY: can see every corner of the business (dashboard/reports need each
-- domain's .view permission to actually return data), but holds no create/update/
-- delete/manage/issue/receive/adjust/approve/reject/void/reverse permission anywhere.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'dashboard.view','report.view','report.export',
  'customer.view','vehicle.view','job.view','inventory.view','supplier.view',
  'purchase_order.view','quotation.view','invoice.view','payment.view','audit.view'
) where r.name = 'OWNER_READONLY'
on conflict do nothing;

-- ── 3. Rewrite RLS for "simple" tables: view/insert/update keyed per table ─
-- 'BLOCK' means the action is denied to authenticated clients entirely (RPC-only writes).
do $$
declare
  rec record;
  mapping text[][] := array[
    array['customers','customer.view','customer.create','customer.update'],
    array['vehicles','vehicle.view','vehicle.create','vehicle.update'],
    array['services','dashboard.view','settings.manage','settings.manage'],
    array['parts','inventory.view','inventory.create','BLOCK'],
    array['job_cards','job.view','job.create','job.update'],
    array['job_card_assignments','job.view','job.assign','job.assign'],
    array['job_card_labour','job.view','job.update','job.update'],
    array['job_card_parts','job.view','BLOCK','BLOCK'],
    array['job_card_status_history','job.view','BLOCK','BLOCK'],
    array['invoices','invoice.view','invoice.create','invoice.update'],
    array['invoice_items','invoice.view','invoice.create','invoice.update'],
    array['payments','payment.view','BLOCK','BLOCK'],
    array['mpesa_transactions','payment.view','BLOCK','BLOCK'],
    array['audit_logs','audit.view','BLOCK','BLOCK'],
    array['branches','dashboard.view','settings.manage','settings.manage'],
    array['suppliers','supplier.view','supplier.create','supplier.update'],
    array['supplier_contacts','supplier.view','supplier.update','supplier.update'],
    array['goods_receipts','purchase_order.view','purchase_order.receive','BLOCK'],
    array['quotation_items','quotation.view','quotation.create','quotation.create'],
    array['stock_movements','inventory.view','BLOCK','BLOCK'],
    array['stock_adjustments','inventory.view','BLOCK','BLOCK'],
    array['employees','dashboard.view','users.manage','users.manage'],
    array['business_settings','dashboard.view','settings.manage','settings.manage'],
    array['job_statuses','dashboard.view','settings.manage','settings.manage'],
    array['payment_methods','dashboard.view','settings.manage','settings.manage']
  ];
  t text; view_perm text; insert_perm text; update_perm text;
  insert_cond text; update_cond text;
begin
  for i in 1 .. array_length(mapping, 1) loop
    t := mapping[i][1]; view_perm := mapping[i][2]; insert_perm := mapping[i][3]; update_perm := mapping[i][4];
    insert_cond := case when insert_perm = 'BLOCK' then 'false' else format('public.has_permission(%L)', insert_perm) end;
    update_cond := case when update_perm = 'BLOCK' then 'false' else format('public.has_permission(%L)', update_perm) end;

    execute format('drop policy if exists "staff_select_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "staff_insert_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "staff_update_%1$s" on public.%1$s', t);
    execute format('drop policy if exists "staff_delete_%1$s" on public.%1$s', t);

    execute format('create policy "staff_select_%1$s" on public.%1$s for select to authenticated using(public.has_permission(%2$L))', t, view_perm);
    execute format('create policy "staff_insert_%1$s" on public.%1$s for insert to authenticated with check(%2$s)', t, insert_cond);
    execute format('create policy "staff_update_%1$s" on public.%1$s for update to authenticated using(%2$s) with check(%2$s)', t, update_cond);
    execute format('create policy "staff_delete_%1$s" on public.%1$s for delete to authenticated using(public.has_permission(''settings.manage''))', t);
  end loop;
end $$;

-- ── 4. Custom tables that need OR-of-permissions or row ownership ─────────

-- quotations: creation and the direct-update approve/reject actions all touch the same row.
drop policy if exists "staff_select_quotations" on public.quotations;
drop policy if exists "staff_insert_quotations" on public.quotations;
drop policy if exists "staff_update_quotations" on public.quotations;
drop policy if exists "staff_delete_quotations" on public.quotations;
create policy "staff_select_quotations" on public.quotations for select to authenticated using(public.has_permission('quotation.view'));
create policy "staff_insert_quotations" on public.quotations for insert to authenticated with check(public.has_permission('quotation.create'));
create policy "staff_update_quotations" on public.quotations for update to authenticated
  using(public.has_permission('quotation.create') or public.has_permission('quotation.approve') or public.has_permission('quotation.reject'))
  with check(public.has_permission('quotation.create') or public.has_permission('quotation.approve') or public.has_permission('quotation.reject'));
create policy "staff_delete_quotations" on public.quotations for delete to authenticated using(public.has_permission('settings.manage'));

-- purchase_orders: creation and the receive-goods flow both update the same row.
drop policy if exists "staff_select_purchase_orders" on public.purchase_orders;
drop policy if exists "staff_insert_purchase_orders" on public.purchase_orders;
drop policy if exists "staff_update_purchase_orders" on public.purchase_orders;
drop policy if exists "staff_delete_purchase_orders" on public.purchase_orders;
create policy "staff_select_purchase_orders" on public.purchase_orders for select to authenticated using(public.has_permission('purchase_order.view'));
create policy "staff_insert_purchase_orders" on public.purchase_orders for insert to authenticated with check(public.has_permission('purchase_order.create'));
create policy "staff_update_purchase_orders" on public.purchase_orders for update to authenticated
  using(public.has_permission('purchase_order.create') or public.has_permission('purchase_order.approve') or public.has_permission('purchase_order.receive'))
  with check(public.has_permission('purchase_order.create') or public.has_permission('purchase_order.approve') or public.has_permission('purchase_order.receive'));
create policy "staff_delete_purchase_orders" on public.purchase_orders for delete to authenticated using(public.has_permission('settings.manage'));

-- purchase_order_items: quantity_received is updated directly by the client during goods receipt.
drop policy if exists "staff_select_purchase_order_items" on public.purchase_order_items;
drop policy if exists "staff_insert_purchase_order_items" on public.purchase_order_items;
drop policy if exists "staff_update_purchase_order_items" on public.purchase_order_items;
drop policy if exists "staff_delete_purchase_order_items" on public.purchase_order_items;
create policy "staff_select_purchase_order_items" on public.purchase_order_items for select to authenticated using(public.has_permission('purchase_order.view'));
create policy "staff_insert_purchase_order_items" on public.purchase_order_items for insert to authenticated with check(public.has_permission('purchase_order.create'));
create policy "staff_update_purchase_order_items" on public.purchase_order_items for update to authenticated
  using(public.has_permission('purchase_order.create') or public.has_permission('purchase_order.receive'))
  with check(public.has_permission('purchase_order.create') or public.has_permission('purchase_order.receive'));
create policy "staff_delete_purchase_order_items" on public.purchase_order_items for delete to authenticated using(public.has_permission('settings.manage'));

-- profiles: any staff can see the directory (needed for assignment pickers), but only the
-- owner or a users.manage admin can edit a profile; direct client inserts are blocked
-- (rows are created by the auth trigger / initialize_system / admin-users function).
drop policy if exists "staff_select_profiles" on public.profiles;
drop policy if exists "staff_insert_profiles" on public.profiles;
drop policy if exists "staff_update_profiles" on public.profiles;
drop policy if exists "staff_delete_profiles" on public.profiles;
create policy "staff_select_profiles" on public.profiles for select to authenticated using(public.has_permission('dashboard.view'));
create policy "staff_insert_profiles" on public.profiles for insert to authenticated with check(false);
create policy "staff_update_profiles" on public.profiles for update to authenticated
  using(auth.uid() = id or public.has_permission('users.manage'))
  with check(auth.uid() = id or public.has_permission('users.manage'));
create policy "staff_delete_profiles" on public.profiles for delete to authenticated using(public.has_permission('users.manage'));

-- notifications: strictly own-row; creation is RPC-only (create_notification).
drop policy if exists "staff_select_notifications" on public.notifications;
drop policy if exists "staff_insert_notifications" on public.notifications;
drop policy if exists "staff_update_notifications" on public.notifications;
drop policy if exists "staff_delete_notifications" on public.notifications;
create policy "staff_select_notifications" on public.notifications for select to authenticated using(user_id = auth.uid());
create policy "staff_insert_notifications" on public.notifications for insert to authenticated with check(false);
create policy "staff_update_notifications" on public.notifications for update to authenticated using(user_id = auth.uid()) with check(user_id = auth.uid());
create policy "staff_delete_notifications" on public.notifications for delete to authenticated using(user_id = auth.uid());

-- role_permissions: previously had select-only; the Users & Roles permission toggle needs
-- insert/delete which silently failed under RLS with no policy present.
drop policy if exists "staff_insert_role_permissions" on public.role_permissions;
drop policy if exists "staff_delete_role_permissions" on public.role_permissions;
create policy "staff_insert_role_permissions" on public.role_permissions for insert to authenticated with check(public.has_permission('users.manage'));
create policy "staff_delete_role_permissions" on public.role_permissions for delete to authenticated using(public.has_permission('users.manage'));

-- user_roles: previously select-only gated on settings.manage, which every role held under
-- the old blanket grant. Now that grants are least-privilege, a normal staff member must
-- still be able to read their OWN role assignment (loadUserPermissions() depends on this)
-- even without users.manage; management of OTHER users' roles still requires users.manage.
drop policy if exists "staff_select_user_roles" on public.user_roles;
create policy "staff_select_user_roles" on public.user_roles for select to authenticated using(user_id = auth.uid() or public.has_permission('users.manage'));
