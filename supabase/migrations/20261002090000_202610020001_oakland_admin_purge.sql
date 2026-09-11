/*
# Oakland Motor Care Ltd — admin permanent delete (purge)

1. Purpose
- Every delete in this app has so far been a soft delete (`deleted_at`) or a
  status change (VOID/CANCELLED/ARCHIVED). There is no way to permanently
  remove a wrongly-created record. This adds that, restricted to ADMIN.

2. Design
- `admin_purge_record(p_entity, p_id)` is SECURITY DEFINER and gated on
  `has_permission('settings.manage')` — under the current two-role model
  (see oakland_rbac_two_role_simplify.sql) only ADMIN ever passes a
  permission check, so this is effectively admin-only.
- `p_entity` is checked against a fixed allowlist of table names before it is
  ever interpolated into SQL, so this can never be steered at an arbitrary
  table — not even other tables in the `public` schema.
- The delete itself is a plain `delete from <table> where id = $1`. Rows that
  are genuinely owned by the record (line items, labour, status history,
  sale items, quotation items, PO items, etc.) already cascade via existing
  foreign keys, so purging a job card, invoice, quotation, sale, or PO also
  removes its own child rows. Rows in *other* tables that still point at the
  record (e.g. a payment against an invoice, a job card against a customer)
  are protected by the existing NO ACTION foreign keys — the delete is
  rejected and re-raised as a plain-English message instead of a raw
  constraint error, so nothing is ever silently cascaded away outside the
  record's own children.
- Every purge is written to `audit_logs` with the full row as `before_state`
  before it is deleted, so a mistaken purge can still be reconstructed from
  the audit trail.
*/

create or replace function public.admin_purge_record(p_entity text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Not authorized to permanently delete records';
  end if;

  if p_entity not in (
    'customers', 'vehicles', 'job_cards', 'quotations', 'invoices',
    'sales', 'purchase_orders', 'suppliers', 'parts'
  ) then
    raise exception 'Unsupported entity: %', p_entity;
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1', p_entity) into v_before using p_id;
  if v_before is null then raise exception 'Record not found'; end if;

  begin
    execute format('delete from public.%I where id = $1', p_entity) using p_id;
  exception when foreign_key_violation then
    raise exception 'This record cannot be deleted because other records still depend on it (e.g. payments, invoices, or linked documents). Remove those first, then try again.';
  end;

  perform public.log_audit('RECORD_PURGED', p_entity, p_id, v_before, null, null);
end; $$;

revoke all on function public.admin_purge_record(text, uuid) from public, anon;
grant execute on function public.admin_purge_record(text, uuid) to authenticated;
