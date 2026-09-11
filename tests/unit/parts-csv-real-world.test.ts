import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCSVRows } from '@/lib/csv';

describe('parseCSVRows against a real-world messy parts import', () => {
  const rows = parseCSVRows(readFileSync(join(__dirname, 'fixtures/PARTS.csv'), 'utf8'));

  it('parses every data row', () => {
    expect(rows.length).toBeGreaterThan(300);
  });

  it('keeps a multi-line quoted SKU as one field', () => {
    const row = rows.find((r) => (r['Part/spare No'] ?? '').includes('04152-37010/40060') && (r['Part/spare No'] ?? '').includes('TESON CHINA'));
    expect(row).toBeTruthy();
    expect(row!['Part/spare No']).toBe('04152-37010/40060\nTESON CHINA');
  });

  it('trims header whitespace so padded column names still resolve', () => {
    const row = rows.find((r) => r['Part/spare No'] === 'D09H 34 350E-1 PERF');
    expect(row).toBeTruthy();
    expect(row!['Unit Cost Price']).toBe('600.00');
    expect(row!['Total Stock price']).toBe('1,200.00');
  });

  it('finds every SUBTOTAKL marker row, wherever the label lands', () => {
    const subtotalRows = rows.filter((r) => Object.values(r).some((v) => /subtot/i.test(v)));
    expect(subtotalRows.length).toBe(13);
    expect(subtotalRows[0]['Total Stock price']).toBe('229,795.00');
  });

  it('parses fully blank separator rows as empty, not as a jumbled row', () => {
    const blank = rows.find((r) => Object.values(r).every((v) => v === '') && rows.indexOf(r) > 0);
    expect(blank).toBeTruthy();
  });
});
