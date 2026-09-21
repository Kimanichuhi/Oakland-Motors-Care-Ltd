import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/formatting';
import { parseScrapBulkCSV, planScrapRows, type ScrapPlannedRow, type ScrapPlannedOp } from '@/lib/scrapImport';
import type { ScrapItem } from '@/lib/types';
import { Upload, Download, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

function downloadScrapTemplate() {
  const header = 'Date,Change in Days,Entry Type,Scrap Type,KG,Expense Category,Amount (KES),Notes';
  const rows = [
    '1 Aug 2026,,CASH,,,,5000,Opening float from Boss',
    '1 Aug 2026,,PURCHASE,Copper,12.5,,,',
    '1 Aug 2026,,EXPENSE,,,Transport,300,',
  ];
  const csv = [header, ...rows].join('\r\n');
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'Oakland_Scrap_Daily_Records_Template.csv'; a.click();
  URL.revokeObjectURL(url);
}

const ACTION_ORDER: Record<ScrapPlannedOp['kind'], number> = { CASH: 0, PURCHASE: 1, EXPENSE: 2 };

// err instanceof Error misses real, informative failures that aren't Error
// instances — a Supabase PostgrestError still has a usable .message even if
// something upstream re-wraps it, and an aborted/timed-out fetch throws a
// DOMException, which has .name/.message but does NOT extend Error.
function errorMessage(err: unknown): string {
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

type FailedRow = { row: ScrapPlannedRow; message: string };

// Cash added first, then purchases, then expenses, grouped by date oldest-first —
// same order the manual entry form applies them in, so cash recorded earlier in
// the day covers purchases/expenses recorded later instead of tripping a false
// insufficient-cash error.
function orderRows(rows: ScrapPlannedRow[]): ScrapPlannedRow[] {
  const byDate = new Map<string, ScrapPlannedRow[]>();
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date)!.push(row);
  }
  const ordered: ScrapPlannedRow[] = [];
  for (const date of Array.from(byDate.keys()).sort()) {
    ordered.push(...byDate.get(date)!.sort((a, b) => ACTION_ORDER[a.op!.kind] - ACTION_ORDER[b.op!.kind]));
  }
  return ordered;
}

export default function BulkScrapUploadDialog({ onClose, onSaved, can }: { onClose: () => void; onSaved: (m: string) => void; can: (p: string) => boolean }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [planned, setPlanned] = useState<ScrapPlannedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseError, setParseError] = useState('');
  const [created, setCreated] = useState(0);
  const [failedRows, setFailedRows] = useState<FailedRow[] | null>(null);

  async function handleFile(file: File) {
    setParseError(''); setPlanned(null); setFailedRows(null); setCreated(0); setFileName(file.name); setParsing(true);
    try {
      const text = await file.text();
      const rawRows = parseScrapBulkCSV(text);
      if (rawRows.length === 0) { setParseError('No data rows found in this file.'); setParsing(false); return; }

      const { data: itemRows } = await supabase.from('scrap_items').select('*');
      setPlanned(planScrapRows(rawRows, (itemRows ?? []) as ScrapItem[]));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read this file.');
    } finally { setParsing(false); }
  }

  const actionable = (planned ?? []).filter((r) => r.op);
  const errorRows = (planned ?? []).filter((r) => r.action === 'ERROR');

  async function runOps(rows: ScrapPlannedRow[], force: boolean): Promise<{ created: number; failures: FailedRow[] }> {
    let createdCount = 0;
    const failures: FailedRow[] = [];
    for (const row of orderRows(rows)) {
      const op = row.op!;
      try {
        if (op.kind === 'CASH') {
          const { error } = await supabase.rpc('scrap_add_cash', {
            p_date: op.date, p_change_in_days: op.changeInDays, p_amount_minor: op.amountMinor,
            p_added_by: null, p_reason: 'Bulk import', p_reference: null, p_notes: op.notes,
          });
          if (error) throw error;
        } else if (op.kind === 'PURCHASE') {
          const { error } = await supabase.rpc('scrap_record_purchase', {
            p_date: op.date, p_change_in_days: op.changeInDays, p_scrap_item_id: op.scrapItemId,
            p_weight_kg: op.weightKg, p_supplier: null, p_notes: op.notes, p_force: force,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc('scrap_record_expense', {
            p_date: op.date, p_change_in_days: op.changeInDays, p_expense_type: op.category,
            p_description: null, p_amount_minor: op.amountMinor, p_notes: op.notes, p_force: force,
          });
          if (error) throw error;
        }
        createdCount++;
      } catch (err) {
        failures.push({ row, message: errorMessage(err) });
      }
      setProgress((p) => p + 1);
    }
    return { created: createdCount, failures };
  }

  async function apply() {
    if (!planned) return;
    setApplying(true); setProgress(0);
    const { created: createdCount, failures } = await runOps(actionable, false);
    setApplying(false);
    setCreated(createdCount);
    setFailedRows(failures);
    if (failures.length === 0) onSaved(`Bulk scrap upload applied: ${createdCount} entr${createdCount === 1 ? 'y' : 'ies'} recorded.`);
  }

  const insufficientCashRows = (failedRows ?? []).filter((f) => f.message.startsWith('INSUFFICIENT_CASH'));

  async function retryInsufficientCashWithForce() {
    if (!failedRows) return;
    setApplying(true); setProgress(0);
    const stillFailed = failedRows.filter((f) => !f.message.startsWith('INSUFFICIENT_CASH'));
    const { created: retriedCount, failures: retryFailures } = await runOps(insufficientCashRows.map((f) => f.row), true);
    setApplying(false);
    const newCreated = created + retriedCount;
    const newFailedRows = [...stillFailed, ...retryFailures];
    setCreated(newCreated);
    setFailedRows(newFailedRows);
    if (newFailedRows.length === 0) onSaved(`Bulk scrap upload applied: ${newCreated} entr${newCreated === 1 ? 'y' : 'ies'} recorded.`);
  }

  return (
    <div className="modal-backdrop" onClick={applying ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(900px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Bulk upload — Daily Records</h2></div>{!applying && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>

        {!planned && !parsing && (
          <div className="modal-form">
            <p className="muted" style={{ margin: 0 }}>Upload several days of scrap purchases, expenses and cash added in one file — one row per entry, as many rows per date as needed, just like adding them one at a time. Entry Type must be PURCHASE, EXPENSE or CASH. For a PURCHASE row, fill in Scrap Type and KG (the rate is taken from the scrap type&apos;s current rate); for an EXPENSE row, fill in Expense Category and Amount; for a CASH row, fill in Amount only.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary wide" onClick={downloadScrapTemplate}><Download size={16} /> Download template</button>
              <button type="button" className="button primary wide" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Choose CSV file</button>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
            {parseError && <div className="form-error">{parseError}</div>}
          </div>
        )}

        {parsing && <div className="empty"><strong>Reading {fileName}…</strong></div>}

        {planned && !failedRows && (
          <div className="modal-form">
            <div className="action-buttons" style={{ marginBottom: 4 }}>
              <span className="status bg-emerald-50 text-emerald-700">{actionable.length} entr{actionable.length === 1 ? 'y' : 'ies'} to record</span>
              {errorRows.length > 0 && <span className="status bg-red-50 text-red-700">{errorRows.length} errors</span>}
            </div>
            <div className="report-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Row</th><th>Date</th><th>Type</th><th>Details</th></tr></thead><tbody>
                {planned.map((r) => <tr key={r.rowNumber}>
                  <td>{r.rowNumber}</td>
                  <td>{formatDate(r.date)}</td>
                  <td><span className={`status ${r.action === 'ERROR' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.action}</span></td>
                  <td style={{ fontSize: 11 }}>
                    {r.errors.map((e, j) => <div key={j} style={{ color: '#a4493d' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {e}</div>)}
                    {r.summary.map((s, j) => <div key={j}>{s}</div>)}
                    {r.warnings.map((w, j) => <div key={j} style={{ color: '#b17b26' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {w}</div>)}
                  </td>
                </tr>)}
              </tbody></table>
            </div>
            {applying && <p className="muted">Applying… {progress} / {actionable.length}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary" disabled={applying} onClick={() => { setPlanned(null); setFileName(''); }}>Choose a different file</button>
              <button type="button" className="button primary wide" disabled={applying || actionable.length === 0} onClick={() => void apply()}>
                {applying ? 'Applying…' : `Apply ${actionable.length} entr${actionable.length === 1 ? 'y' : 'ies'}`}
              </button>
            </div>
          </div>
        )}

        {failedRows && (
          <div className="modal-form">
            <div className="empty" style={{ padding: '18px 12px' }}>
              {failedRows.length === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <strong>{failedRows.length === 0 ? 'Upload applied' : 'Upload finished with some failures'}</strong>
              <span>{created} entr{created === 1 ? 'y' : 'ies'} recorded{failedRows.length > 0 ? ` · ${failedRows.length} failed` : ''}</span>
            </div>

            {failedRows.length > 0 && <>
              <div className="report-table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="report-table"><thead><tr><th>Row</th><th>Date</th><th>Reason</th></tr></thead><tbody>
                  {failedRows.map((f) => <tr key={f.row.rowNumber}>
                    <td>{f.row.rowNumber}</td>
                    <td>{formatDate(f.row.date)}</td>
                    <td style={{ fontSize: 11, color: '#a4493d' }}>{f.message.replace('INSUFFICIENT_CASH: ', '')}</td>
                  </tr>)}
                </tbody></table>
              </div>
              {insufficientCashRows.length > 0 && can('scrap.manage') && (
                <p className="muted" style={{ fontSize: 12 }}>
                  {insufficientCashRows.length} of these failed only because recorded cash would go negative that day — common when a paper ledger&apos;s day-to-day cash doesn&apos;t perfectly reconcile. You can force them in anyway; each gets flagged as a discrepancy for review.
                </p>
              )}
            </>}

            {applying && <p className="muted">Applying… {progress} / {insufficientCashRows.length}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary wide" onClick={onClose}>Close</button>
              {insufficientCashRows.length > 0 && can('scrap.manage') && (
                <button type="button" className="button primary wide" disabled={applying} onClick={() => void retryInsufficientCashWithForce()}>
                  {applying ? 'Applying…' : `Force in ${insufficientCashRows.length} flagged as discrepancy`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
