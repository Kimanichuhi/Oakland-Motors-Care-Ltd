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

export function buildUploadErrorReportHtml(opts: {
  title: string;
  fileName: string;
  rows: UploadErrorReportRow[];
  referenceLabel: string;
  logoUrl: string;
  printedAt?: Date;
}): string {
  const { title, fileName, rows, referenceLabel, logoUrl } = opts;
  const printedAt = (opts.printedAt ?? new Date()).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  const notImported = rows.filter((r) => r.stage === 'CHECK').length;
  const failedToSave = rows.filter((r) => r.stage === 'SAVE').length;
  const notes = rows.filter((r) => r.stage === 'NOTE').length;
  const sorted = [...rows].sort((a, b) => (a.rowNumber ?? Number.MAX_SAFE_INTEGER) - (b.rowNumber ?? Number.MAX_SAFE_INTEGER) || (a.date ?? '').localeCompare(b.date ?? ''));

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
  <div class="advice">Row numbers match the uploaded CSV file. Correct these rows, then upload a file containing only them — rows that were already imported would be recorded twice if the whole file is uploaded again.</div>
  <footer>Oakland Motor Care Ltd</footer>
</body></html>`;
}

/** Prints through a hidden iframe: no pop-up for a blocker to stop, and the
 * report prints on its own instead of the page behind the upload dialog. */
export function printUploadErrorReport(opts: { title: string; fileName: string; rows: UploadErrorReportRow[]; referenceLabel: string }): void {
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
