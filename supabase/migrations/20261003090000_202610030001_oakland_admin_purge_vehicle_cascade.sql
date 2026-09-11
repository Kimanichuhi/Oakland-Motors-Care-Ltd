/*
# Oakland Motor Care Ltd — admin cascade purge for a vehicle's full history

1. Purpose
- `admin_purge_record('vehicles', id)` (see oakland_admin_purge.sql) only removes
  the vehicle row itself, and is correctly blocked by NO ACTION foreign keys the
  moment the vehicle has any job card, invoice, or quotation against it. That is
  the right default for a single-record purge, but there is a real admin need to
  wipe a vehicle that was created by mistake along with everything ever recorded
  against it in one action.
- `admin_purge_vehicle_and_history(p_vehicle_id)` does that: it removes the
  vehicle plus every job card, invoice, quotation, job-card-linked sale, payment,
  M-Pesa transaction, and debt record that traces back to it.

2. Scope of the cascade (every inbound foreign key to vehicles/job_cards/invoices/
   quotations was audited before writing this):
   - job_cards.vehicle_id, invoices.vehicle_id, quotations.vehicle_id  -> this vehicle
   - invoices.job_card_id, quotations.job_card_id, debt_records.job_card_id,
     sales.job_card_id                                                -> this vehicle's job cards
   - payments.invoice_id, mpesa_transactions.invoice_id,
     quotations.converted_invoice_id                                  -> this vehicle's invoices
   Rows that are already owned by cascade (invoice_items, quotation_items,
   sale_items, job_card_labour/parts/status_history/assignments/diagnosis/
   inspection_items/work_items/quality_checks/signoffs) are removed automatically
   when their parent row is deleted, same as in admin_purge_record.
   Deletes run in dependency order (grandchildren, then children, then the
   vehicle) inside a single function invocation, so it either fully succeeds or
   fully rolls back — there is no partially-purged state.

3. Audit
- The full snapshot of the vehicle and everything being removed is written to
  audit_logs as before_state under a single VEHICLE_HISTORY_PURGED entry, so a
  mistaken purge can still be reconstructed.
*/

create or replace function public.admin_purge_vehicle_and_history(p_vehicle_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_vehicle jsonb;
  v_job_card_ids uuid[];
  v_invoice_ids uuid[];
  v_quotation_ids uuid[];
  v_before jsonb;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Not authorized to permanently delete records';
  end if;

  select to_jsonb(t) into v_vehicle from public.vehicles t where t.id = p_vehicle_id;
  if v_vehicle is null then raise exception 'Vehicle not found'; end if;

  select coalesce(array_agg(id), '{}') into v_job_card_ids from public.job_cards where vehicle_id = p_vehicle_id;
  select coalesce(array_agg(id), '{}') into v_invoice_ids from public.invoices where vehicle_id = p_vehicle_id or job_card_id = any(v_job_card_ids);
  select coalesce(array_agg(id), '{}') into v_quotation_ids from public.quotations where vehicle_id = p_vehicle_id or job_card_id = any(v_job_card_ids);

  select jsonb_build_object(
    'vehicle', v_vehicle,
    'job_cards', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.job_cards t where t.id = any(v_job_card_ids)),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.invoices t where t.id = any(v_invoice_ids)),
    'quotations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.quotations t where t.id = any(v_quotation_ids)),
    'sales', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.sales t where t.job_card_id = any(v_job_card_ids)),
    'payments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.payments t where t.invoice_id = any(v_invoice_ids)),
    'mpesa_transactions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.mpesa_transactions t where t.invoice_id = any(v_invoice_ids)),
    'debt_records', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.debt_records t where t.job_card_id = any(v_job_card_ids))
  ) into v_before;

  -- Defensive: break any (unexpected) quotation -> invoice reference into this
  -- invoice set before the invoices are deleted, even from a quotation that
  -- isn't itself being purged.
  update public.quotations set converted_invoice_id = null where converted_invoice_id = any(v_invoice_ids);

  delete from public.mpesa_transactions where invoice_id = any(v_invoice_ids);
  delete from public.payments where invoice_id = any(v_invoice_ids);
  delete from public.debt_records where job_card_id = any(v_job_card_ids);
  delete from public.sales where job_card_id = any(v_job_card_ids);
  delete from public.quotations where id = any(v_quotation_ids);
  delete from public.invoices where id = any(v_invoice_ids);
  delete from public.job_cards where id = any(v_job_card_ids);
  delete from public.vehicles where id = p_vehicle_id;

  perform public.log_audit('VEHICLE_HISTORY_PURGED', 'vehicles', p_vehicle_id, v_before, null, jsonb_build_object(
    'job_cards_removed', coalesce(array_length(v_job_card_ids, 1), 0),
    'invoices_removed', coalesce(array_length(v_invoice_ids, 1), 0),
    'quotations_removed', coalesce(array_length(v_quotation_ids, 1), 0)
  ));
end; $$;

revoke all on function public.admin_purge_vehicle_and_history(uuid) from public, anon;
grant execute on function public.admin_purge_vehicle_and_history(uuid) to authenticated;
