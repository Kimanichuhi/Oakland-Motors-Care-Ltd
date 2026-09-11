import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatKes, formatDate } from '@/lib/formatting';
import { parseDailySalesCSV, planSalesRows, type ExistingPartForSale, type SalesPlannedRow } from '@/lib/salesImport';
import { Upload, Download, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

function downloadSalesTemplate() {
  const header1 = 'Date,Change in days,Customer Name,Vehicle,Vehicle model,SPARES SALES,,,,,,,Day Total,CASH/MPESA/BANKED,DEBT,JOBCARD NO,REMAINING STOCK AT SHELVES,SYSTEM REMAINING STOCK';
  const header2 = ',,,,,Part/spare No,Description-& part make,Quantity sold,PRICE,Spares Total,Labour/ Service,TOTAL,,,,,,';
  const example = '1 Aug 2026,,,,,BP-001,Brake pads,1,850,850,,850,,,,,,';
  const csv = [header1, header2, example].join('\r\n');
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'Oakland_Daily_Sales_Template.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function BulkSalesUploadDialog({ onClose, onSaved, canOverridePrice }: { onClose: () => void; onSaved: (m: string) => void; canOverridePrice: boolean }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [planned, setPlanned] = useState<SalesPlannedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseError, setParseError] = useState('');
  const [done, setDone] = useState<{ created: number; failed: number } | null>(null);

  async function handleFile(file: File) {
    setParseError(''); setPlanned(null); setDone(null); setFileName(file.name); setParsing(true);
    try {
      const text = await file.text();
      const rawRows = parseDailySalesCSV(text);
      if (rawRows.length === 0) { setParseError('No data rows found in this file.'); setParsing(false); return; }

      const [{ data: partRows }, { data: jobCardRows }] = await Promise.all([
        supabase.from('parts').select('id,sku,name,category,selling_price_minor,quantity_on_hand,active'),
        supabase.from('job_cards').select('id,job_number').is('deleted_at', null),
      ]);
      const parts = (partRows ?? []) as ExistingPartForSale[];
      const jobCardIdByNumber = new Map((((jobCardRows ?? [])) as { id: string; job_number: string }[]).map((j) => [j.job_number.trim().toLowerCase(), j.id]));

      setPlanned(planSalesRows(rawRows, parts, jobCardIdByNumber));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read this file.');
    } finally { setParsing(false); }
  }

  function updateShelfCount(index: number, value: string) {
    setPlanned((prev) => {
      if (!prev) return prev;
      const row = prev[index];
      if (row.action !== 'SALE' || !row.payload) return prev;
      const parsed = value.trim() === '' ? null : parseInt(value, 10);
      const shelfCount = parsed !== null && Number.isFinite(parsed) ? parsed : null;
      const next = [...prev];
      next[index] = { ...row, payload: { ...row.payload, p_items: [{ ...row.payload.p_items[0], shelf_count: shelfCount }] } };
      return next;
    });
  }

  const actionable = (planned ?? []).filter((r) => r.action === 'SALE');
  const errorRows = (planned ?? []).filter((r) => r.action === 'ERROR');
  const dayWarningRows = (planned ?? []).filter((r) => r.rowNumber === -1);
  const priceOverrideNeeded = actionable.some((r) => r.warnings.some((w) => w.includes('price-override')));

  async function apply() {
    if (!planned) return;
    setApplying(true); setProgress(0);
    let created = 0, failed = 0;

    for (const row of actionable) {
      try {
        const { error } = await supabase.rpc('complete_sale', row.payload as unknown as Record<string, unknown>);
        if (error) throw error;
        created++;
      } catch {
        failed++;
      }
      setProgress((p) => p + 1);
    }

    setApplying(false);
    setDone({ created, failed });
    if (failed === 0) onSaved(`Bulk sales upload applied: ${created} sale${created === 1 ? '' : 's'} recorded.`);
  }

  return (
    <div className="modal-backdrop" onClick={applying ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(900px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Sales</p><h2>Bulk upload</h2></div>{!applying && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>

        {!planned && !parsing && (
          <div className="modal-form">
            <p className="muted" style={{ margin: 0 }}>Upload the daily sales day book (one row per part sold). Each row checks the part exists and has enough stock, then records a sale and deducts stock automatically — the same way completing a sale in the app does. Rows with no part on them (day totals, blank spacer rows) are skipped; rows for a part not yet in the Parts module are flagged as errors, not guessed at. Shelf count comes from the file but can be corrected in the preview below; system remaining stock is always computed automatically from actual stock, never editable.</p>
            {!canOverridePrice && <p className="form-error" style={{ margin: 0 }}><AlertTriangle size={14} /> You don&apos;t have price-override access. Historical sales almost always sell at a different price than the part&apos;s current selling price, which requires it — ask an admin to run this upload, or grant you that permission first.</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary wide" onClick={downloadSalesTemplate}><Download size={16} /> Download template</button>
              <button type="button" className="button primary wide" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Choose CSV file</button>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
            {parseError && <div className="form-error">{parseError}</div>}
          </div>
        )}

        {parsing && <div className="empty"><strong>Reading {fileName}…</strong></div>}

        {planned && !done && (
          <div className="modal-form">
            <div className="action-buttons" style={{ marginBottom: 4 }}>
              <span className="status bg-emerald-50 text-emerald-700">{actionable.length} sale{actionable.length === 1 ? '' : 's'} to record</span>
              {errorRows.length > 0 && <span className="status bg-red-50 text-red-700">{errorRows.length} errors</span>}
              {dayWarningRows.length > 0 && <span className="status bg-amber-50 text-amber-700">{dayWarningRows.length} day-total check{dayWarningRows.length === 1 ? '' : 's'} flagged</span>}
            </div>
            {priceOverrideNeeded && !canOverridePrice && <div className="form-error"><AlertTriangle size={14} /> Some rows sell below/above the part&apos;s current price and will fail without price-override access.</div>}
            {dayWarningRows.map((r, i) => <div key={i} className="form-error" style={{ fontSize: 12 }}><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {r.warnings.join(' ')}</div>)}
            <div className="report-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Date</th><th>SKU</th><th>Action</th><th>Shelf count</th><th>Details</th></tr></thead><tbody>
                {planned.map((r, i) => ({ r, i })).filter(({ r }) => r.action !== 'SKIP').map(({ r, i }) => <tr key={i}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.sku || '—'}</td>
                  <td><span className={`status ${r.action === 'SALE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.action}</span></td>
                  <td>
                    {r.action === 'SALE' && <input
                      type="number" min={0}
                      value={r.payload?.p_items[0]?.shelf_count ?? ''}
                      onChange={(e) => updateShelfCount(i, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="—"
                      style={{ width: 70, border: '1px solid #dfe5ea', borderRadius: 6, padding: '5px 6px', fontSize: 12 }}
                    />}
                  </td>
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
                {applying ? 'Applying…' : `Apply ${actionable.length} sale${actionable.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="modal-form">
            <div className="empty" style={{ padding: '18px 12px' }}>
              {done.failed === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <strong>{done.failed === 0 ? 'Upload applied' : 'Upload finished with some failures'}</strong>
              <span>{done.created} sale{done.created === 1 ? '' : 's'} recorded{done.failed > 0 ? ` · ${done.failed} failed` : ''}</span>
            </div>
            <button type="button" className="button primary wide" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
