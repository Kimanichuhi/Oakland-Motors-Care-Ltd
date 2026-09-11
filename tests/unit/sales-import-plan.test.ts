import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCSVRows } from '@/lib/csv';
import { planRows } from '@/lib/partsImport';
import { parseDailySalesCSV, parseDayBookDate, planSalesRows, type ExistingPartForSale } from '@/lib/salesImport';

/** Builds the parts catalogue exactly as it would exist in the database after
 * running the parts bulk-upload plan for PARTS_ready_to_import.csv, including
 * accumulating quantity across a SKU's CREATE row and any later linked RECEIVE
 * rows in that same file (the same file has a few repeat-SKU deliveries). */
function partsFromRealImport(): ExistingPartForSale[] {
  const rows = parseCSVRows(readFileSync(join(__dirname, '../../PARTS_ready_to_import.csv'), 'utf8'));
  const plan = planRows(rows, [], new Map(), 'RECEIVE');
  const bySku = new Map<string, ExistingPartForSale>();
  for (const p of plan) {
    if (p.action === 'CREATE') {
      bySku.set(p.sku.trim().toLowerCase(), {
        id: p.sku.trim().toLowerCase(), sku: p.sku, name: (p.createPayload?.name as string) ?? p.sku,
        category: null, selling_price_minor: 0, quantity_on_hand: p.receive?.quantity ?? 0, active: true,
      });
    } else if (p.action === 'RECEIVE' && p.receive) {
      const existing = bySku.get(p.linkSku ?? p.sku.trim().toLowerCase());
      if (existing) existing.quantity_on_hand += p.receive.quantity;
    }
  }
  return Array.from(bySku.values());
}

describe('parseDayBookDate', () => {
  it('parses "D MMM YYYY" without shifting across a timezone boundary', () => {
    const d = parseDayBookDate('7 Aug 2026');
    expect(d).toBeTruthy();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7); // August
    expect(d!.getDate()).toBe(7);
  });

  it('rejects an unrecognisable date', () => {
    expect(parseDayBookDate('not a date')).toBeNull();
  });
});

describe('planSalesRows against a real-world daily sales log', () => {
  const parts = partsFromRealImport();
  const rawRows = parseDailySalesCSV(readFileSync(join(__dirname, 'fixtures/Daily sales.csv'), 'utf8'));
  const planned = planSalesRows(rawRows, parts);

  it('keeps the sale date aligned with the source row (no off-by-one from timezone conversion)', () => {
    const row = planned.find((p) => p.sku === '15208-31U00 TESON CHINA');
    expect(row).toBeTruthy();
    expect(row!.date).toBe('2026-08-07'); // source row reads "7 Aug 2026"
    expect(row!.payload?.p_sale_date).toBe('2026-08-07T00:00:00+03:00');
  });

  it('skips rows with no part on them (day-summary placeholder rows)', () => {
    const skipped = planned.filter((p) => p.action === 'SKIP' && p.rowNumber !== -1);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('rejects fractional quantities rather than silently rounding them', () => {
    const errors = planned.filter((p) => p.action === 'ERROR');
    expect(errors.length).toBe(5);
    for (const e of errors) expect(e.errors[0]).toContain('fractional');
  });

  it('flags a part sold that was never brought into the parts catalogue', () => {
    const [row] = planSalesRows(
      [{ rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'GHOST-SKU', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '' }],
      [],
    );
    expect(row.action).toBe('ERROR');
    expect(row.errors[0]).toContain('was not found');
  });

  it('blocks a sale once a SKU\'s running stock in the file is exhausted', () => {
    const testParts: ExistingPartForSale[] = [{ id: 'p1', sku: 'X-1', name: 'Widget', category: null, selling_price_minor: 100, quantity_on_hand: 1, active: true }];
    const rows = [
      { rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '' },
      { rowNumber: 4, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '' },
    ];
    const [first, second] = planSalesRows(rows, testParts);
    expect(first.action).toBe('SALE');
    expect(second.action).toBe('ERROR');
    expect(second.errors[0]).toContain('Insufficient stock');
  });

  it('treats a DEBT balance as a credit sale, otherwise cash paid in full', () => {
    const testParts: ExistingPartForSale[] = [{ id: 'p1', sku: 'X-1', name: 'Widget', category: null, selling_price_minor: 100, quantity_on_hand: 10, active: true }];
    const rows = [
      { rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '40', jobCardNo: '', shelfCount: '', systemStock: '' },
    ];
    const [row] = planSalesRows(rows, testParts);
    expect(row.payload?.p_payment_method).toBe('CREDIT');
    expect(row.payload?.p_payment_status).toBe('PARTIAL');
    expect(row.payload?.p_amount_paid_minor).toBe(6000); // 100 - 40 = 60.00
  });

  it("the two remaining day-total gaps are fully explained by that day's fractional-quantity errors, not a separate data problem", () => {
    const dayWarnings = planned.filter((p) => p.rowNumber === -1 && p.date !== '2026-08-01');
    expect(dayWarnings.length).toBe(2);
    // 2026-09-07: stated 3,555 vs summed 3,180 — the gap (375) equals the two 0.5-qty
    // sandpaper rows (150 + 150) plus the 0.5-qty newspaper row (75) that error out that day.
    expect(dayWarnings[0].warnings[0]).toContain('3,555');
    expect(dayWarnings[0].warnings[0]).toContain('3,180');
    // 2026-09-09: stated 1,150 vs summed 1,000 — the gap (150) is the 0.5-qty sandpaper row.
    expect(dayWarnings[1].warnings[0]).toContain('1,150');
    expect(dayWarnings[1].warnings[0]).toContain('1,000');
  });
});
