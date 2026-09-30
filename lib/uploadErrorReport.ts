// Printable error report for the CSV bulk uploads (Parts, Sales, Scrap, Work
// Orders), so staff can take the list of problem rows back to the paper book.

// err instanceof Error misses real, informative failures that aren't Error
// instances — a Supabase PostgrestError still has a usable .message even if
// something upstream re-wraps it, and an aborted/timed-out fetch throws a
// DOMException, which has .name/.message but does NOT extend Error.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) {
      const name = typeof obj.name === 'string' && obj.name !== 'Error' ? `${obj.name}: ` : '';
      return `${name}${obj.message}`;
    }
  }
  if (typeof err === 'string' && err) return err;
  return 'Unable to save this entry (no error detail was returned).';
}

export type UploadErrorStage = 'CHECK' | 'SAVE' | 'NOTE';

export type UploadErrorReportRow = {
  /** CSV row number, or null for a note about a whole day. */
  rowNumber: number | null;
  date?: string;
  /** What the row is about: a SKU, registration, scrap type… */
  reference?: string;
  /** CHECK = rejected before saving, SAVE = failed while saving, NOTE = day-level warning. */
  stage: UploadErrorStage;
  errors: string[];
  warnings?: string[];
};

const STAGE_LABEL: Record<UploadErrorStage, string> = {
  CHECK: 'Not imported',
  SAVE: 'Failed to save',
  NOTE: 'Check',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-11" → "11 Sep 2026", the way the paper books write dates. */
function displayDate(raw: string | undefined): string {
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}` : raw;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export type UploadErrorReport = {
  /** Which upload: "Sales", "Parts", "Scrap daily records", "Work orders". */
  title: string;
  fileName: string;
  rows: UploadErrorReportRow[];
  /** Heading for the reference column: "Part / SKU", "Registration"… */
  referenceLabel: string;
};

/** CSV order, with whole-day notes (no row number) after the rows, by date. */
function sortReportRows(rows: UploadErrorReportRow[]): UploadErrorReportRow[] {
  return [...rows].sort((a, b) => (a.rowNumber ?? Number.MAX_SAFE_INTEGER) - (b.rowNumber ?? Number.MAX_SAFE_INTEGER) || (a.date ?? '').localeCompare(b.date ?? ''));
}

function reportCounts(rows: UploadErrorReportRow[]) {
  return {
    notImported: rows.filter((r) => r.stage === 'CHECK').length,
    failedToSave: rows.filter((r) => r.stage === 'SAVE').length,
    notes: rows.filter((r) => r.stage === 'NOTE').length,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summaryParts(rows: UploadErrorReportRow[]): string[] {
  const { notImported, failedToSave, notes } = reportCounts(rows);
  return [
    notImported ? `${plural(notImported, 'row', 'rows')} not imported` : '',
    failedToSave ? `${plural(failedToSave, 'row', 'rows')} failed to save` : '',
    notes ? `${plural(notes, 'note', 'notes')} to check` : '',
  ].filter(Boolean);
}

function formatPrintedAt(d: Date): string {
  return d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

const ADVICE = 'Row numbers match the uploaded CSV file. Correct these rows, then upload a file containing only them — rows that were already imported would be recorded twice if the whole file is uploaded again.';

export function buildUploadErrorReportHtml(opts: UploadErrorReport & { logoUrl: string; printedAt?: Date }): string {
  const { title, fileName, rows, referenceLabel, logoUrl } = opts;
  const printedAt = formatPrintedAt(opts.printedAt ?? new Date());
  const { notImported, failedToSave, notes } = reportCounts(rows);
  const sorted = sortReportRows(rows);

  const body = sorted.map((r) => `
      <tr class="${r.stage.toLowerCase()}">
        <td class="num">${r.rowNumber === null ? '—' : r.rowNumber}</td>
        <td class="date">${escapeHtml(displayDate(r.date))}</td>
        <td class="ref">${escapeHtml(r.reference ?? '')}</td>
        <td><span class="stage">${STAGE_LABEL[r.stage]}</span></td>
        <td>
          ${r.errors.map((e) => `<div class="err">${escapeHtml(e)}</div>`).join('')}
          ${(r.warnings ?? []).map((w) => `<div class="warn">${escapeHtml(w)}</div>`).join('')}
        </td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(title)} — ${escapeHtml(fileName)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&display=swap">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Josefin Sans', 'Segoe UI', Arial, sans-serif; color: #172536; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 10px; border-bottom: 3px solid #b98a3d; margin-bottom: 12px; }
  header img { height: 46px; width: auto; border-radius: 6px; }
  .eyebrow { margin: 0 0 4px; font-size: 8pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #b98a3d; }
  h1 { margin: 0; font-size: 18pt; color: #10263f; }
  .meta { text-align: right; font-size: 8.5pt; color: #718093; line-height: 1.5; }
  .meta strong { color: #10263f; }
  .summary { display: flex; gap: 8px; margin: 0 0 12px; }
  .pill { padding: 5px 10px; border-radius: 20px; font-size: 8.5pt; font-weight: 700; }
  .pill.check { background: #fdeceb; color: #a4493d; }
  .pill.save { background: #fdf0d8; color: #9b6d1d; }
  .pill.note { background: #eaf0f6; color: #10263f; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: #fff; background: #10263f; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #e7ebef; vertical-align: top; }
  tr { page-break-inside: avoid; }
  td.num, td.date { white-space: nowrap; }
  td.num { font-weight: 700; color: #10263f; }
  td.ref { font-weight: 600; word-break: break-word; }
  .stage { display: inline-block; font-size: 7.5pt; font-weight: 700; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  tr.check .stage { background: #fdeceb; color: #a4493d; }
  tr.save .stage { background: #fdf0d8; color: #9b6d1d; }
  tr.note .stage { background: #eaf0f6; color: #10263f; }
  .err { color: #a4493d; margin-bottom: 2px; }
  .warn { color: #8a6421; font-size: 8.8pt; margin-bottom: 2px; }
  .advice { margin-top: 12px; padding: 8px 10px; border-radius: 6px; background: #fffaf4; border: 1px solid #f0e5d2; font-size: 8.8pt; color: #5b4a2e; }
  footer { margin-top: 14px; font-size: 7.5pt; color: #a1abb4; text-align: center; }
</style></head>
<body>
  <header>
    <div>
      <p class="eyebrow">Bulk upload error report</p>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="meta">
      <img src="${escapeHtml(logoUrl)}" alt="Oakland Motor Care Ltd"><br>
      File: <strong>${escapeHtml(fileName)}</strong><br>
      Printed ${escapeHtml(printedAt)}
    </div>
  </header>
  <div class="summary">
    ${notImported ? `<span class="pill check">${notImported} row${notImported === 1 ? '' : 's'} not imported</span>` : ''}
    ${failedToSave ? `<span class="pill save">${failedToSave} row${failedToSave === 1 ? '' : 's'} failed to save</span>` : ''}
    ${notes ? `<span class="pill note">${notes} note${notes === 1 ? '' : 's'} to check</span>` : ''}
  </div>
  <table>
    <thead><tr><th style="width:9%">Row</th><th style="width:13%">Date</th><th style="width:20%">${escapeHtml(referenceLabel)}</th><th style="width:13%">Status</th><th>Problem</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="advice">${escapeHtml(ADVICE)}</div>
  <footer>Oakland Motor Care Ltd</footer>
</body></html>`;
}

/** Prints through a hidden iframe: no pop-up for a blocker to stop, and the
 * report prints on its own instead of the page behind the upload dialog. */
export function printUploadErrorReport(opts: UploadErrorReport): void {
  const html = buildUploadErrorReportHtml({ ...opts, logoUrl: `${window.location.origin}/logo.png` });
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();

  let printed = false;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  const go = () => {
    if (printed) return;
    printed = true;
    win.addEventListener('afterprint', cleanup, { once: true });
    win.focus();
    win.print();
    setTimeout(() => { if (frame.isConnected) frame.remove(); }, 60_000);
  };
  // Wait for the logo and font so they appear on the printout, but never hang on them.
  const img = doc.querySelector('img');
  const imgReady = !img || img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });
  const fontsReady = doc.fonts ? doc.fonts.ready.then(() => undefined) : Promise.resolve();
  void Promise.race([Promise.all([imgReady, fontsReady]), new Promise((resolve) => setTimeout(resolve, 2500))]).then(go);
}

/** Plain text for WhatsApp, SMS or email: one block per row. */
export function buildUploadErrorReportText(report: UploadErrorReport, printedAt: Date = new Date()): string {
  const lines = [
    `Oakland Motor Care Ltd — ${report.title} bulk upload error report`,
    `File: ${report.fileName} · Printed ${formatPrintedAt(printedAt)}`,
    summaryParts(report.rows).join(' · '),
    '',
  ];
  for (const r of sortReportRows(report.rows)) {
    const where = [r.rowNumber === null ? 'Whole day' : `Row ${r.rowNumber}`, displayDate(r.date), r.rowNumber === null ? '' : r.reference ?? ''].filter(Boolean).join(' · ');
    lines.push(`${where} — ${STAGE_LABEL[r.stage]}`);
    for (const e of r.errors) lines.push(`  • ${e}`);
    for (const w of r.warnings ?? []) lines.push(`  ! ${w}`);
  }
  lines.push('', ADVICE);
  return lines.join('\n');
}

/** A plain table, so pasting into Excel, Word or an email keeps the columns. */
export function buildUploadErrorReportClipboardHtml(report: UploadErrorReport, printedAt: Date = new Date()): string {
  const cell = 'border:1px solid #d5dde5;padding:4px 6px;vertical-align:top;';
  const head = ['Row', 'Date', report.referenceLabel, 'Status', 'Problem'].map((h) => `<th style="${cell}background:#10263f;color:#fff;text-align:left">${escapeHtml(h)}</th>`).join('');
  const body = sortReportRows(report.rows).map((r) => `<tr>
    <td style="${cell}">${r.rowNumber === null ? '' : r.rowNumber}</td>
    <td style="${cell}">${escapeHtml(displayDate(r.date))}</td>
    <td style="${cell}">${escapeHtml(r.reference ?? '')}</td>
    <td style="${cell}">${STAGE_LABEL[r.stage]}</td>
    <td style="${cell}">${[...r.errors, ...(r.warnings ?? [])].map(escapeHtml).join('<br>')}</td>
  </tr>`).join('');
  return `<p><strong>Oakland Motor Care Ltd — ${escapeHtml(report.title)} bulk upload error report</strong><br>File: ${escapeHtml(report.fileName)} · Printed ${escapeHtml(formatPrintedAt(printedAt))}<br>${escapeHtml(summaryParts(report.rows).join(' · '))}</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Copies the report as both a table (Excel/Word/email) and plain text
 * (WhatsApp/SMS); whichever the paste target understands is used. */
export async function copyUploadErrorReport(report: UploadErrorReport): Promise<void> {
  const text = buildUploadErrorReportText(report);
  const html = buildUploadErrorReportClipboardHtml(report);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return;
    } catch { /* fall through to plain text */ }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fall through to the legacy copy */ }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px' });
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Copy is blocked in this browser.');
}

// The PDF's built-in Helvetica only covers Latin-1, so swap the few typographic
// characters the reasons use for plain equivalents instead of printing boxes.
export function toPdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/→/g, '->').replace(/…/g, '...')
    .replace(/ /g, ' ').replace(/•/g, '-')
    .replace(/[^\u0000-ÿ]/g, '?');
}

const NAVY: [number, number, number] = [16, 38, 63];
const GOLD: [number, number, number] = [185, 138, 61];
const MUTED: [number, number, number] = [113, 128, 147];
const STAGE_COLOR: Record<UploadErrorStage, [number, number, number]> = { CHECK: [164, 73, 61], SAVE: [155, 109, 29], NOTE: [16, 38, 63] };

/** Builds the report as a real PDF document (selectable text, A4). The logo is
 * passed in as a data URL so this also runs outside the browser (tests). */
export async function buildUploadErrorReportPdf(report: UploadErrorReport, opts: { logoDataUrl?: string; printedAt?: Date } = {}) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const printedAt = formatPrintedAt(opts.printedAt ?? new Date());
  const sorted = sortReportRows(report.rows);

  if (opts.logoDataUrl) {
    try { doc.addImage(opts.logoDataUrl, 'PNG', pageW - margin - 34, 9, 34, 17, undefined, 'FAST'); } catch { /* print without the logo */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5); doc.setTextColor(...GOLD);
  doc.text('BULK UPLOAD ERROR REPORT', margin, 16, { charSpace: 0.6 });
  doc.setFontSize(18); doc.setTextColor(...NAVY);
  doc.text(toPdfText(report.title), margin, 24);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text(toPdfText(`File: ${report.fileName}`), pageW - margin, 31, { align: 'right' });
  doc.text(toPdfText(`Printed ${printedAt}`), pageW - margin, 35.5, { align: 'right' });
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8);
  doc.line(margin, 39, pageW - margin, 39);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY);
  doc.text(toPdfText(summaryParts(report.rows).join('   ·   ')), margin, 45);

  autoTable(doc, {
    startY: 49,
    rowPageBreak: 'avoid',
    margin: { left: margin, right: margin, top: 14, bottom: 16 },
    head: [['Row', 'Date', toPdfText(report.referenceLabel), 'Status', 'Problem']],
    body: sorted.map((r) => [
      r.rowNumber === null ? '-' : String(r.rowNumber),
      displayDate(r.date),
      toPdfText(r.reference ?? ''),
      STAGE_LABEL[r.stage],
      toPdfText([...r.errors, ...(r.warnings ?? []).map((w) => (r.errors.length ? `Warning: ${w}` : w))].join('\n')),
    ]),
    styles: { font: 'helvetica', fontSize: 8.3, cellPadding: 1.8, textColor: [23, 37, 54], lineColor: [231, 235, 239], lineWidth: 0.2, valign: 'top' },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: { 0: { cellWidth: 11, fontStyle: 'bold' }, 1: { cellWidth: 22 }, 2: { cellWidth: 38, fontStyle: 'bold' }, 3: { cellWidth: 23, fontStyle: 'bold' } },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const row = sorted[data.row.index];
      if (data.column.index === 3) data.cell.styles.textColor = STAGE_COLOR[row.stage];
      if (data.column.index === 4) data.cell.styles.textColor = row.stage === 'NOTE' ? [138, 100, 33] : [164, 73, 61];
    },
  });

  // Advice box under the table, on a new page if it won't fit.
  const tableEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3);
  const advice = doc.splitTextToSize(toPdfText(ADVICE), pageW - margin * 2 - 6) as string[];
  const boxH = advice.length * 3.8 + 4;
  let y = tableEnd + 5;
  if (y + boxH > pageH - 18) { doc.addPage(); y = 16; }
  doc.setFillColor(255, 250, 244); doc.setDrawColor(240, 229, 210); doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, pageW - margin * 2, boxH, 1.5, 1.5, 'FD');
  doc.setTextColor(91, 74, 46);
  doc.text(advice, margin + 3, y + 5);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(161, 171, 180);
    doc.text(toPdfText(`Oakland Motor Care Ltd · ${report.title} upload error report`), margin, pageH - 8);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 8, { align: 'right' });
  }
  return doc;
}

/** The logo file is 1774×887; embedded as-is it makes a 4–5 MB PDF. It's
 * printed 34 mm wide, so 400 px is plenty and keeps the file small enough to
 * send on WhatsApp. */
function loadLogoDataUrl(widthPx = 400): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * widthPx);
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(undefined); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(undefined); }
    };
    img.onerror = () => resolve(undefined);
    img.src = '/logo.png';
  });
}

export function uploadErrorReportFileName(report: UploadErrorReport): string {
  const source = report.fileName.replace(/\.csv$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'upload';
  return `Error report - ${report.title} - ${source}.pdf`;
}

/** Downloads the report as a PDF file. */
export async function exportUploadErrorReportPdf(report: UploadErrorReport): Promise<void> {
  const doc = await buildUploadErrorReportPdf(report, { logoDataUrl: await loadLogoDataUrl() });
  doc.save(uploadErrorReportFileName(report));
}
