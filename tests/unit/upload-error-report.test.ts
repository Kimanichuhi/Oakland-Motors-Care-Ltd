import { describe, it, expect } from 'vitest';
import { buildUploadErrorReportHtml, buildUploadErrorReportText, buildUploadErrorReportClipboardHtml, buildUploadErrorReportPdf, uploadErrorReportFileName, toPdfText, errorMessage, type UploadErrorReportRow } from '@/lib/uploadErrorReport';

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

describe('copy and PDF formats', () => {
  const report = {
    title: 'Sales',
    fileName: 'daily sales_10.csv',
    referenceLabel: 'Part / SKU',
    rows: [
      { rowNumber: 59, date: '2026-09-25', reference: '90919-01192', stage: 'CHECK' as const, errors: ['Insufficient stock: only 0 available (need 4).'] },
      { rowNumber: 20, date: '2026-09-15', reference: 'Gas rods', stage: 'SAVE' as const, errors: ['Not authorized to change selling price'] },
      { rowNumber: null, date: '2026-09-16', reference: 'Whole day', stage: 'NOTE' as const, errors: [], warnings: ['Ksh 3,100 owed — record it on the work order'] },
    ],
  };

  it('copies as readable text, one block per row, in CSV order', () => {
    const text = buildUploadErrorReportText(report, new Date(2026, 8, 30, 15, 20));
    expect(text).toContain('Sales bulk upload error report');
    expect(text).toContain('1 row not imported · 1 row failed to save · 1 note to check');
    expect(text.indexOf('Row 20 · 15 Sep 2026 · Gas rods — Failed to save')).toBeLessThan(text.indexOf('Row 59 · 25 Sep 2026'));
    expect(text).toContain('Whole day · 16 Sep 2026 — Check');
  });

  it('copies a table for Excel/Word with every row', () => {
    const html = buildUploadErrorReportClipboardHtml(report);
    expect((html.match(/<tr>/g) ?? []).length).toBe(4); // header + 3 rows
  });

  it('builds a PDF with the report text in it', async () => {
    const doc = await buildUploadErrorReportPdf(report, { printedAt: new Date(2026, 8, 30, 15, 20) });
    expect(doc.getNumberOfPages()).toBe(1);
    const raw = doc.output();
    expect(raw).toContain('BULK UPLOAD ERROR REPORT');
    expect(raw).toContain('Not authorized to change selling price');
    // Characters Helvetica can't draw are swapped, not printed as boxes.
    expect(raw).toContain('Ksh 3,100 owed - record it on the work order');
  });

  it('names the file after the upload', () => {
    expect(uploadErrorReportFileName(report)).toBe('Error report - Sales - daily sales_10.pdf');
  });

  it('replaces characters the PDF font lacks', () => {
    expect(toPdfText('A → B … “q” — ✓')).toBe('A -> B ... "q" - ?');
  });
});
