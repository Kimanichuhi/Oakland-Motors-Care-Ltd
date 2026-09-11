/*
# Oakland Motor Care Ltd — FACTORY RESET: wipe all business data

  ⚠️  THIS IS NOT A MIGRATION. Do not put this file in supabase/migrations/ or
  run it via `supabase db push` — it would replay on every fresh environment
  and wipe it again. Run it exactly once, by hand, in the Supabase SQL editor,
  only when you actually mean to erase everything below.

  ⚠️  THIS CANNOT BE UNDONE. There is no soft-delete here and no audit trail
  for this action (audit_logs itself is one of the tables being erased) —
  take a database backup/snapshot first if there is any chance you'll want
  this data back. Supabase: Database → Backups.

1. What this deletes
   Every customer, vehicle, work order (and all its labour/parts/diagnosis/
   signoff/status-history rows), invoice, payment, M-Pesa transaction,
   quotation, purchase order, supplier, part, service/labour catalog entry,
   stock movement/adjustment, sale, notification, audit log entry,
   vehicle-register entry, general receipt, debt record, and every
   scrap-module transaction (purchases, daily records, expenses, clearance
   sales, stock adjustments, cash transactions, cycles).

2. What this KEEPS (per your request to leave accounts/roles/settings intact)
   - Login accounts: auth.users (untouched — not even in this schema)
   - Staff accounts & access: profiles, user_roles, roles, role_permissions, permissions
   - Configuration: business_settings (business name, tax rate, prefixes),
     job_statuses, payment_methods, branches
   - `scrap_items` (the scrap-type registry/current stock) — kept rather than
     wiped, to match the existing wipe.js in the project root
   - Document numbering restarts at 1 (job_card_sequence, sale_number_counters
     are reset in place, not deleted, since the app expects exactly one row
     in each — see step 4); document_number_counters (the generic INV/other
     numbering table) is safe to truncate outright since it lazily
     recreates a row per document type on next use.

3. Reconciled against wipe.js (the pre-existing REST-based reset script in
   the project root): this now matches it exactly on the two points where
   they first disagreed — `services` is wiped and `scrap_items` is kept.
   `employees` (technician roster) and `parts` (the catalog itself, not just
   stock counts) are still wiped — move either into the kept list above if
   you'd rather it survive.

4. Order
   TRUNCATE ... CASCADE resolves dependency order automatically regardless
   of listing order, and also catches any owned/child row not explicitly
   listed below. The three singleton-row config/counter tables
   (job_card_sequence, sale_number_counters, scrap_settings) are reset with
   UPDATE instead of TRUNCATE, because the app's numbering and scrap-cash
   functions require exactly one row to always exist in each.
*/

begin;

truncate table
  public.job_card_signoffs,
  public.job_card_quality_checks,
  public.job_card_work_items,
  public.job_card_inspection_items,
  public.job_card_diagnosis,
  public.job_card_status_history,
  public.job_card_assignments,
  public.job_card_labour,
  public.job_card_parts,
  public.debt_records,
  public.sale_items,
  public.sales,
  public.invoice_items,
  public.mpesa_transactions,
  public.payments,
  public.invoices,
  public.quotation_items,
  public.quotations,
  public.job_cards,
  public.purchase_order_items,
  public.goods_receipts,
  public.purchase_orders,
  public.supplier_contacts,
  public.suppliers,
  public.stock_movements,
  public.stock_adjustments,
  public.parts,                     -- review: see section 3
  public.employees,                 -- review: see section 3
  public.services,
  public.vehicles,
  public.customers,
  public.notifications,
  public.audit_logs,
  public.vehicle_register,
  public.general_receipt_items,
  public.general_receipts,
  public.scrap_clearance_sales,
  public.scrap_daily_records,
  public.scrap_expenses,
  public.scrap_stock_adjustments,
  public.stock_cycles,
  public.scrap_purchases,
  public.cash_transactions,
  public.scrap_cash_summary,
  public.document_number_counters
cascade;

-- Singleton counters/config rows: reset in place, never delete the row.
update public.job_card_sequence set next_seq = 1 where id = true;
update public.sale_number_counters set next_seq = 1 where id = true;
update public.scrap_settings set opening_cash_minor = null, opening_cash_date = null, opening_notes = null, established_by = null, established_at = null where id = true;

commit;
