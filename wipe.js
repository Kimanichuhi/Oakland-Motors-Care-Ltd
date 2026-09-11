const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal,count=exact' };

async function del(table, filter = 'id=not.is.null') {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: H });
  const range = res.headers.get('content-range');
  const deleted = range ? range.split('/')[1] : '?';
  const status = res.status;
  const body = status >= 400 ? await res.text() : '';
  console.log(`${table.padEnd(28)} status=${status} deleted=${deleted}${body ? '  ERROR: ' + body.slice(0, 200) : ''}`);
  if (status >= 400) throw new Error(`Failed deleting ${table}: ${body}`);
}

async function patch(table, filter, body) {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const status = res.status;
  const text = status >= 400 ? await res.text() : '';
  console.log(`RESET ${table.padEnd(23)} status=${status}${text ? '  ERROR: ' + text.slice(0, 200) : ''}`);
  if (status >= 400) throw new Error(`Failed resetting ${table}: ${text}`);
}

(async () => {
  console.log('=== TIER 1: leaf children ===');
  const tier1 = [
    'job_card_inspection_items', 'job_card_work_items', 'job_card_diagnosis', 'job_card_quality_checks',
    'job_card_signoffs', 'job_card_assignments', 'job_card_status_history', 'job_card_labour', 'job_card_parts',
    'invoice_items', 'payments', 'mpesa_transactions',
    'quotation_items', 'sale_items', 'general_receipt_items',
    'purchase_order_items', 'goods_receipts', 'supplier_contacts',
    'debt_records', 'vehicle_register', 'stock_movements', 'stock_adjustments',
    'notifications', 'audit_logs',
    'scrap_purchases', 'scrap_expenses', 'cash_transactions', 'scrap_clearance_sales',
    'scrap_stock_adjustments', 'scrap_daily_records', 'stock_cycles',
  ];
  for (const t of tier1) await del(t);
  await del('scrap_cash_summary', 'date=not.is.null'); // primary key is `date`, not `id`

  console.log('=== TIER 2: documents (children now gone, still reference job_cards/suppliers) ===');
  for (const t of ['invoices', 'quotations', 'sales', 'general_receipts', 'purchase_orders']) await del(t);

  console.log('=== TIER 3: job_cards ===');
  await del('job_cards');

  console.log('=== TIER 4: base entities ===');
  for (const t of ['vehicles', 'customers', 'parts', 'suppliers', 'employees', 'services']) await del(t);

  console.log('=== RESET numbering to restart at 001 ===');
  await patch('job_card_sequence', 'id=eq.true', { next_seq: 1 });
  await patch('sale_number_counters', 'id=eq.true', { next_seq: 1 });
  await patch('document_number_counters', 'doc_type=not.is.null', { next_seq: 1 });

  console.log('=== DONE ===');
})().catch((e) => { console.error('ABORTED:', e.message); process.exit(1); });
