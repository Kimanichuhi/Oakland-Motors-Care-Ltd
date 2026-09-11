import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCSVRows } from '@/lib/csv';
import { planRows, type ExistingPart } from '@/lib/partsImport';

const realRows = parseCSVRows(readFileSync(join(__dirname, 'fixtures/PARTS.csv'), 'utf8'));

describe('planRows against a real-world messy parts import (RECEIVE mode)', () => {
  const planned = planRows(realRows, [], new Map(), 'RECEIVE');

  it('skips every SUBTOTAL and blank separator row rather than erroring on a missing SKU', () => {
    const skipped = planned.filter((p) => p.action === 'SKIP');
    expect(skipped.length).toBeGreaterThan(15);
    expect(planned.filter((p) => p.action === 'ERROR' && p.errors[0]?.includes('Missing Part/spare No')).length).toBe(0);
  });

  it('treats a lone dash cell as empty, not invalid data', () => {
    const row = planned.find((p) => p.sku === '12401-JD01B');
    expect(row).toBeTruthy();
    expect(row!.action).not.toBe('ERROR');
  });

  it('only errors on rows genuinely missing a description', () => {
    const errors = planned.filter((p) => p.action === 'ERROR');
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) expect(e.errors).toEqual(['New part needs a Description.']);
  });

  it('flags a batch whose stated subtotal does not match its line items', () => {
    const mismatch = planned.find((p) => p.action === 'SKIP' && p.warnings.some((w) => w.includes("subtotal")));
    expect(mismatch).toBeTruthy();
    // The Hill Top Auto Spares batch is stated as 27,780 but its 20 lines sum to 29,380 —
    // exactly the value of its last line item, suggesting it was left out of the total.
    expect(mismatch!.warnings[0]).toContain('27,780');
    expect(mismatch!.warnings[0]).toContain('29,380');
  });

  it('links a second occurrence of a brand-new SKU to the part its first occurrence will create, as an additive receipt', () => {
    const rowsForSku = planned.filter((p) => p.sku === 'Chevrons- Pick up');
    expect(rowsForSku.length).toBe(2);
    expect(rowsForSku[0].action).toBe('CREATE');
    expect(rowsForSku[0].receive).toEqual({ quantity: 1, costMinor: 25000 });
    expect(rowsForSku[1].action).toBe('RECEIVE');
    expect(rowsForSku[1].linkSku).toBe('chevrons- pick up');
    expect(rowsForSku[1].receive).toEqual({ quantity: 4, costMinor: 25000 });
  });
});

describe('planRows quantity semantics', () => {
  const existing: ExistingPart[] = [{
    id: 'part-1', sku: 'BP-001', quantity_on_hand: 5, cost_price_minor: 80000,
    name: 'Brake pads', vehicle_model: null, brand: null, remarks: null, date_purchased: null, supplier_id: null,
  }];
  const rows = [
    { 'Part/spare No': 'BP-001', 'Description': 'Brake pads', 'Quantity': '3', 'Unit Cost Price': '900.00' },
  ];

  it('RECEIVE mode adds to existing stock rather than replacing it', () => {
    const [row] = planRows(rows, existing, new Map(), 'RECEIVE');
    expect(row.action).toBe('RECEIVE');
    expect(row.receive).toEqual({ quantity: 3, costMinor: 90000 });
    expect(row.quantityChange).toBeUndefined();
  });

  it('RECONCILE mode sets stock to the given value via a delta adjustment', () => {
    const [row] = planRows(rows, existing, new Map(), 'RECONCILE');
    expect(row.action).toBe('UPDATE');
    expect(row.quantityChange).toEqual({ from: 5, to: 3, delta: -2 });
    expect(row.receive).toBeUndefined();
  });

  it('derives Unit Cost Price from Total Stock Price ÷ Quantity when cost is blank', () => {
    const rowsWithTotal = [{ 'Part/spare No': 'NEW-1', 'Description': 'Widget', 'Quantity': '4', 'Total Stock Price': '400.00' }];
    const [row] = planRows(rowsWithTotal, [], new Map(), 'RECEIVE');
    expect(row.action).toBe('CREATE');
    expect(row.createPayload?.cost_price_minor).toBe(10000); // 100.00 per unit
  });
});
