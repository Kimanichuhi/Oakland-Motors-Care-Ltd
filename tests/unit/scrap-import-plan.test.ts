import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseScrapBulkCSV, planScrapRows } from '@/lib/scrapImport';
import type { ScrapItem } from '@/lib/types';

function item(overrides: Partial<ScrapItem> = {}): ScrapItem {
  return { id: 'cast-id', name: 'Cast', current_rate_minor: 100000, active: true, show_in_purchase_form: true, created_at: '', updated_at: '', ...overrides };
}

describe('parseScrapBulkCSV', () => {
  it('reads a header-keyed row and drops fully blank rows', () => {
    const csv = [
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2026,,CASH,,,,5000,Opening float',
      ',,,,,,,',
    ].join('\r\n');
    const rows = parseScrapBulkCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryType).toBe('CASH');
    expect(rows[0].amount).toBe('5000');
  });
});

describe('planScrapRows', () => {
  const items = [item()];

  it('plans a PURCHASE row using the scrap item current rate', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,PURCHASE,Cast,10,,,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned).toHaveLength(1);
    expect(planned[0].action).toBe('PURCHASE');
    expect(planned[0].op).toMatchObject({ kind: 'PURCHASE', scrapItemId: 'cast-id', weightKg: 10 });
  });

  it('plans an EXPENSE row', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,EXPENSE,,,Transport,300,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('EXPENSE');
    expect(planned[0].op).toMatchObject({ kind: 'EXPENSE', category: 'Transport', amountMinor: 30000 });
  });

  it('plans a CASH row', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,CASH,,,,5000,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('CASH');
    expect(planned[0].op).toMatchObject({ kind: 'CASH', amountMinor: 500000 });
  });

  it('errors on an unrecognised scrap type', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,PURCHASE,Aluminium,10,,,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/Aluminium/);
  });

  it('errors when the scrap item has no rate set', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,PURCHASE,Cast,10,,,',
    ].join('\n'));
    const planned = planScrapRows(rows, [item({ current_rate_minor: null })]);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/rate/i);
  });

  it('errors on a scrap type not in the allowed enum, even if it exists in the database', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,PURCHASE,Copper,10,,,',
    ].join('\n'));
    const planned = planScrapRows(rows, [item({ id: 'copper-id', name: 'Copper' })]);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/not one of the allowed types/);
  });

  it('errors on an expense category not in the allowed enum', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,EXPENSE,,,Bribe,300,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/not one of the allowed categories/);
  });

  it('rejects a PURCHASE row that also sets Expense Category or Amount', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,PURCHASE,Cast,10,Transport,300,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors).toContain('Expense Category must be blank on a PURCHASE row.');
    expect(planned[0].errors).toContain('Amount (KES) must be blank on a PURCHASE row.');
  });

  it('rejects an EXPENSE row that also sets Scrap Type or KG', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,EXPENSE,Cast,10,Transport,300,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors).toContain('Scrap Type must be blank on an EXPENSE row.');
    expect(planned[0].errors).toContain('KG must be blank on an EXPENSE row.');
  });

  it('rejects a CASH row that also sets Scrap Type, KG or Expense Category', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,CASH,Cast,10,Transport,5000,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors).toContain('Scrap Type must be blank on a CASH row.');
    expect(planned[0].errors).toContain('KG must be blank on a CASH row.');
    expect(planned[0].errors).toContain('Expense Category must be blank on a CASH row.');
  });

  it('errors on a future-dated row', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Jan 2099,,CASH,,,,5000,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/future/);
  });

  it('errors on an unrecognised entry type', () => {
    const rows = parseScrapBulkCSV([
      'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes',
      '1 Aug 2020,,DEPOSIT,,,,5000,',
    ].join('\n'));
    const planned = planScrapRows(rows, items);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/Entry Type/);
  });
});

describe('planScrapRows against the real historical scrap ledger import', () => {
  // The full catalogue this file's Scrap Type values are validated against —
  // same 21 types (and reference rates) added by the
  // oakland_add_missing_scrap_types migration.
  const catalogue: ScrapItem[] = [
    ['Heavy', 4500], ['Heavy 2', 4000], ['Heavy 3', 5000], ['Light', 3000], ['Light 2', 3500],
    ['Dawa', 100000], ['Dawa 2', 70000], ['Battery', 8000], ['Battery 2', 4000], ['Battery 3', 7000],
    ['Battery 4', 6000], ['Cast', 4000], ['Cast 2', 3500], ['Alu Hard', 13000], ['Alu Hard 2', 15000],
    ['Soft', 20000], ['Plastic', 2000], ['Brass', 40000], ['Gumboots', 5000], ['Radiator', 20000],
    ['Radiator Brass', 20000],
  ].map(([name, rate], i) => ({ id: `id-${i}`, name: name as string, current_rate_minor: rate as number, active: true, show_in_purchase_form: true, created_at: '', updated_at: '' }));

  it('plans every row cleanly, with no ERROR rows', () => {
    const csvPath = join(__dirname, '../../Scrap_Daily_Records_ready_to_import.csv');
    const rawRows = parseScrapBulkCSV(readFileSync(csvPath, 'utf8'));
    const planned = planScrapRows(rawRows, catalogue);
    const errorRows = planned.filter((r) => r.action === 'ERROR');
    expect(errorRows.map((r) => ({ row: r.rowNumber, errors: r.errors }))).toEqual([]);
    expect(planned.length).toBe(rawRows.length);
  });
});
