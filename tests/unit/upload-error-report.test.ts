import { describe, it, expect } from 'vitest';
import { buildUploadErrorReportHtml, errorMessage, type UploadErrorReportRow } from '@/lib/uploadErrorReport';

describe('buildUploadErrorReportHtml', () => {
  const rows: UploadErrorReportRow[] = [
    { rowNumber: 12, date: '2026-09-14', reference: 'P40', stage: 'CHECK', errors: ['Missing Quantity sold.'], warnings: ['Check the price'] },
    { rowNumber: 4, date: '2026-09-11', reference: 'Masking tape', stage: 'SAVE', errors: ['Not authorized <b>x</b>'] },
    { rowNumber: null, date: '2026-09-16', reference: 'Whole day', stage: 'NOTE', errors: [], warnings: ['Ksh 3,100 owed'] },
  ];
  const html = buildUploadErrorReportHtml({ title: 'Sales', fileName: 'daily <sales>.csv', rows, referenceLabel: 'Part / SKU', logoUrl: '/logo.png', printedAt: new Date(2026, 8, 30, 15, 20) });

  it('counts each kind of problem in the summary', () => {
    expect(html).toContain('1 row not imported');
    expect(html).toContain('1 row failed to save');
    expect(html).toContain('1 note to check');
  });

  it('lists rows in CSV order with whole-day notes last', () => {
    const order = ['Masking tape', 'P40', 'Whole day'].map((ref) => html.indexOf(`>${ref}<`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('writes dates the way the day book does', () => {
    expect(html).toContain('14 Sep 2026');
  });

  it('escapes file names and error text', () => {
    expect(html).toContain('daily &lt;sales&gt;.csv');
    expect(html).toContain('Not authorized &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('errorMessage', () => {
  it('reads Supabase errors that are plain objects, not Error instances', () => {
    expect(errorMessage({ message: 'Insufficient stock', code: 'P0001' })).toBe('Insufficient stock');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(undefined)).toContain('no error detail');
  });
});
