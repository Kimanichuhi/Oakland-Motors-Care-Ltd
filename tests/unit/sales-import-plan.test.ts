import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCSVRows } from '@/lib/csv';
import { planRows } from '@/lib/partsImport';
import { parseDailySalesCSV, parseDayBookDate, planSalesRows, normaliseJobCardNumber, type ExistingPartForSale, type JobCardRef } from '@/lib/salesImport';

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

  it('imports fractional quantities as decimals instead of rejecting them', () => {
    expect(planned.filter((p) => p.action === 'ERROR')).toHaveLength(0);
    const fractional = planned.filter((p) => p.action === 'SALE' && !Number.isInteger(p.payload!.p_items[0].quantity));
    expect(fractional.length).toBe(5);
    expect(fractional.some((p) => p.payload!.p_items[0].quantity === 0.5)).toBe(true);
  });

  it('flags a part sold that was never brought into the parts catalogue', () => {
    const [row] = planSalesRows(
      [{ rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'GHOST-SKU', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '', mpesaCode: '' }],
      [],
    );
    expect(row.action).toBe('ERROR');
    expect(row.errors[0]).toContain('was not found');
  });

  it('blocks a sale once a SKU\'s running stock in the file is exhausted', () => {
    const testParts: ExistingPartForSale[] = [{ id: 'p1', sku: 'X-1', name: 'Widget', category: null, selling_price_minor: 100, quantity_on_hand: 1, active: true }];
    const rows = [
      { rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '', mpesaCode: '' },
      { rowNumber: 4, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '', mpesaCode: '' },
    ];
    const [first, second] = planSalesRows(rows, testParts);
    expect(first.action).toBe('SALE');
    expect(second.action).toBe('ERROR');
    expect(second.errors[0]).toContain('Insufficient stock');
  });

  it("keeps the day's DEBT off the part sale and flags it for the day instead", () => {
    const testParts: ExistingPartForSale[] = [{ id: 'p1', sku: 'X-1', name: 'Widget', category: null, selling_price_minor: 100, quantity_on_hand: 10, active: true }];
    const rows = [
      { rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '40', jobCardNo: '', shelfCount: '', systemStock: '', mpesaCode: '' },
    ];
    const [row, dayNote] = planSalesRows(rows, testParts);
    expect(row.payload?.p_payment_method).toBe('CASH');
    expect(row.payload?.p_payment_status).toBe('PAID');
    expect(row.payload?.p_amount_paid_minor).toBe(10000);
    expect(dayNote.rowNumber).toBe(-1);
    expect(dayNote.warnings[0]).toMatch(/Ksh\s40 owed/);
  });

  it('day totals match once fractional rows are imported (the old 7 and 9 Sep gaps were exactly those rows)', () => {
    const dayTotalGaps = planned.filter((p) => p.rowNumber === -1 && p.summary[0] === 'Day-total check' && p.date !== '2026-08-01');
    expect(dayTotalGaps).toHaveLength(0);
  });
});

describe('planSalesRows M-Pesa handling', () => {
  const testParts: ExistingPartForSale[] = [{ id: 'p1', sku: 'X-1', name: 'Widget', category: null, selling_price_minor: 100, quantity_on_hand: 10, active: true }];
  const base = { rowNumber: 3, date: '1 Aug 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: 'X-1', description: '', quantity: '1', price: '100', sparesTotal: '100', labour: '', total: '100', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '', mpesaCode: '' };

  it('reads the M-Pesa code from the last column of the day book', () => {
    const csv = [
      'Date,Change in days,Customer Name,Vehicle,Vehicle model,SPARES SALES,,,,,,,Day Total,CASH/MPESA/BANKED,DEBT,JOBCARD NO,REMAINING STOCK AT SHELVES,SYSTEM REMAINING STOCK,MPESA CODE',
      ',,,,,Part/spare No,Description-& part make,Quantity sold,PRICE,Spares Total,Labour/ Service,TOTAL,,,,,,,',
      '1 Aug 2026,,,,,X-1,Widget,1,100,100,,100,,MPESA,,,,,shk3xyz9ab',
    ].join('\n');
    const [row] = parseDailySalesCSV(csv);
    expect(row.cashMpesaBanked).toBe('MPESA');
    expect(row.mpesaCode).toBe('shk3xyz9ab');
  });

  it('records an M-Pesa sale with its code and the sale date as the payment time', () => {
    const [row] = planSalesRows([{ ...base, cashMpesaBanked: 'M-Pesa', mpesaCode: 'shk3xyz9ab' }], testParts);
    expect(row.action).toBe('SALE');
    expect(row.payload?.p_payment_method).toBe('MPESA');
    expect(row.payload?.p_payment_reference).toBe('SHK3XYZ9AB');
    expect(row.payload?.p_payment_reference_at).toBe(row.payload?.p_sale_date);
  });

  it('rejects an M-Pesa sale with no code', () => {
    const [row] = planSalesRows([{ ...base, cashMpesaBanked: 'MPESA' }], testParts);
    expect(row.action).toBe('ERROR');
    expect(row.errors[0]).toContain('no M-Pesa code');
  });

  it('treats a code with a blank method cell as M-Pesa', () => {
    const [row] = planSalesRows([{ ...base, mpesaCode: 'SHK3XYZ9AB' }], testParts);
    expect(row.payload?.p_payment_method).toBe('MPESA');
  });

  it('keeps plain cash and bank sales without a code', () => {
    const [cash, bank] = planSalesRows([{ ...base, cashMpesaBanked: 'Cash' }, { ...base, rowNumber: 4, cashMpesaBanked: 'Banked' }], testParts);
    expect(cash.payload?.p_payment_method).toBe('CASH');
    expect(cash.payload?.p_payment_reference).toBeNull();
    expect(bank.payload?.p_payment_method).toBe('BANK');
  });

  it('records a work-order row as paid through the work order, keeping its codes', () => {
    const jobs = new Map<string, JobCardRef>([['jb-066', { id: 'job-66', customerName: 'Jane Owner' }]]);
    const [row] = planSalesRows([{ ...base, jobCardNo: 'JB-066', mpesaCode: 'SHK3XYZ9AB' }], testParts, jobs);
    expect(row.payload?.p_payment_method).toBe('JOB_CARD');
    expect(row.payload?.p_payment_status).toBe('PAID');
    expect(row.payload?.p_job_card_id).toBe('job-66');
    expect(row.payload?.p_customer_name).toBe('Jane Owner');
    expect(row.payload?.p_payment_reference).toBe('SHK3XYZ9AB');
  });

  it('splits several codes in one cell and treats FT references as bank transfers', () => {
    const [mpesa, bank] = planSalesRows([
      { ...base, mpesaCode: 'SHK3XYZ9AB; SHK3XYZ9AC' },
      { ...base, rowNumber: 4, mpesaCode: 'FT262612ZG03; FT26262VFPHS' },
    ], testParts);
    expect(mpesa.payload?.p_payment_method).toBe('MPESA');
    expect(mpesa.payload?.p_payment_reference).toBe('SHK3XYZ9AB, SHK3XYZ9AC');
    expect(bank.payload?.p_payment_method).toBe('BANK');
  });

  it('ignores an amount written in the method column', () => {
    const [row] = planSalesRows([{ ...base, cashMpesaBanked: '1,200' }], testParts);
    expect(row.action).toBe('SALE');
    expect(row.payload?.p_payment_method).toBe('CASH');
    expect(row.warnings.some((w) => w.includes('payment method'))).toBe(false);
  });

  it('warns when a code is already on a sale in the system', () => {
    const [row] = planSalesRows([{ ...base, mpesaCode: 'SHK3XYZ9AB' }], testParts, new Map(), new Set(['SHK3XYZ9AB']));
    expect(row.action).toBe('SALE');
    expect(row.warnings.some((w) => w.includes('already on a sale'))).toBe(true);
  });
});

describe('part matching', () => {
  it('ignores extra spaces and case in the part name', () => {
    const parts: ExistingPartForSale[] = [{ id: 'oil', sku: '20W-50 Engine Oil  (4 Ltr) (Petrol)', name: 'Engine oil', category: null, selling_price_minor: 250000, quantity_on_hand: 4, active: true }];
    const [row] = planSalesRows([{ rowNumber: 3, date: '21 Sep 2026', changeInDays: '', customerName: '', vehicle: '', vehicleModel: '', sku: '20w-50 engine oil (4 Ltr) (Petrol)', description: '', quantity: '1', price: '2500', sparesTotal: '2500', labour: '', total: '2500', dayTotal: '', cashMpesaBanked: '', debt: '', jobCardNo: '', shelfCount: '', systemStock: '', mpesaCode: '' }], parts);
    expect(row.action).toBe('SALE');
    expect(row.payload?.p_items[0].part_id).toBe('oil');
  });
});

describe('normaliseJobCardNumber', () => {
  it('matches the day book\'s spellings of a work order number', () => {
    expect(normaliseJobCardNumber('JB-53')).toBe('jb-053');
    expect(normaliseJobCardNumber('jb053')).toBe('jb-053');
    expect(normaliseJobCardNumber('JB-100')).toBe('jb-100');
  });

  it('treats "Walk in" and blanks as no work order', () => {
    expect(normaliseJobCardNumber('Walk in')).toBeNull();
    expect(normaliseJobCardNumber('walk-in')).toBeNull();
    expect(normaliseJobCardNumber('')).toBeNull();
  });
});

describe('planSalesRows against the September day book (daily sales_10.csv)', () => {
  const raw = parseDailySalesCSV(readFileSync(join(__dirname, 'fixtures/daily sales_10.csv'), 'utf8'));
  // Stock as the book implies it just before each part's first sale in the file.
  const opening = new Map<string, number>();
  for (const r of raw) {
    const key = r.sku.trim().toLowerCase();
    if (key && !opening.has(key)) opening.set(key, parseFloat(r.systemStock) + parseFloat(r.quantity));
  }
  const parts: ExistingPartForSale[] = Array.from(opening.entries()).map(([sku, qty]) => ({ id: sku, sku, name: sku, category: null, selling_price_minor: 0, quantity_on_hand: qty, active: true }));
  const jobs = new Map<string, JobCardRef>();
  for (const r of raw) {
    const key = normaliseJobCardNumber(r.jobCardNo);
    if (key) jobs.set(key, { id: key, customerName: null });
  }
  const planned = planSalesRows(raw, parts, jobs);
  const sales = planned.filter((p) => p.action === 'SALE');

  it('plans every part row except the one the book itself shows going below zero', () => {
    expect(sales).toHaveLength(73);
    const errors = planned.filter((p) => p.action === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].sku).toContain('K16TR-11'); // book: system stock -4 after this sale
    expect(errors[0].errors[0]).toContain('Insufficient stock');
  });

  it('matches every Day Total and flags only the three days with debt', () => {
    const notes = planned.filter((p) => p.rowNumber === -1);
    expect(notes.every((n) => n.summary[0] === 'Day debt')).toBe(true);
    expect(notes.map((n) => n.date)).toEqual(['2026-09-16', '2026-09-25', '2026-09-26']);
  });

  it('stores a sixth of a sheet to 4 decimal places, a cent off the book at most', () => {
    const sixth = sales.find((p) => p.payload!.p_items[0].quantity === 0.1667)!;
    expect(sixth).toBeTruthy();
    expect(Math.round(0.1667 * sixth.payload!.p_items[0].unit_price_minor)).toBe(5001); // book: 50.00
  });

  it('never warns about "Walk in" as a missing work order', () => {
    expect(planned.some((p) => p.warnings.some((w) => w.includes('"Walk in"')))).toBe(false);
  });
});
