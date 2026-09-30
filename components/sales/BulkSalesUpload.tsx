import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatKes, formatDate } from '@/lib/formatting';
import {
  parseDailySalesCSV, planSalesRows, splitPaymentCodes, normaliseJobCardNumber, findDayBookDebts, withItemDebt, dayDebtDescription,
  type ExistingPartForSale, type JobCardRef, type SalesPlannedRow, type DayBookDebt, type DebtMode,
} from '@/lib/salesImport';
import { errorMessage, type UploadErrorReport, type UploadErrorReportRow } from '@/lib/uploadErrorReport';
import UploadErrorReportActions from '@/components/UploadErrorReportActions';
import { Upload, Download, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

function downloadSalesTemplate() {
  const header1 = 'Date,Change in days,Customer Name,Vehicle,Vehicle model,SPARES SALES,,,,,,,Day Total,CASH/MPESA/BANKED,DEBT,JOBCARD NO,REMAINING STOCK AT SHELVES,SYSTEM REMAINING STOCK,MPESA CODE';
  const header2 = ',,,,,Part/spare No,Description-& part make,Quantity sold,PRICE,Spares Total,Labour/ Service,TOTAL,,,,,,,';
  const example = '1 Aug 2026,1,,KCS 551X,Honda fit,BP-001,Brake pads,1,850,850,,850,,,,JB-066,4,3,';
  const cashExample = '1 Aug 2026,,,,,NP-001,News paper 1kg,0.5,150,75,,75,925,925,,Walk in,20,19.5,SHK3XYZ9AB';
  const csv = [header1, header2, example, cashExample].join('\r\n');
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'Oakland_Daily_Sales_Template.csv'; a.click();
  URL.revokeObjectURL(url);
}

const DEFAULT_OWED_BY = 'Spares sales day book';

export default function BulkSalesUploadDialog({ onClose, onSaved, canOverridePrice, canManageDebts }: { onClose: () => void; onSaved: (m: string) => void; canOverridePrice: boolean; canManageDebts: boolean }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [planned, setPlanned] = useState<SalesPlannedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseError, setParseError] = useState('');
  const [done, setDone] = useState<{ created: number; failed: number; dayDebts: number } | null>(null);
  const [failedRows, setFailedRows] = useState<{ row: SalesPlannedRow; message: string }[]>([]);
  // Debts found in the DEBT column: each can be the item's (the sale is saved partly
  // paid / on credit) or the whole day's (one Debt Register entry for that date).
  const [debts, setDebts] = useState<DayBookDebt[]>([]);
  const [debtModes, setDebtModes] = useState<Record<number, DebtMode>>({});
  const [debtOwedBy, setDebtOwedBy] = useState<Record<number, string>>({});
  const [existingDayDebts, setExistingDayDebts] = useState<Set<string>>(new Set());
  const [failedDebts, setFailedDebts] = useState<{ debt: DayBookDebt; message: string }[]>([]);

  async function handleFile(file: File) {
    setParseError(''); setPlanned(null); setDone(null); setFailedRows([]); setFailedDebts([]); setDebts([]); setFileName(file.name); setParsing(true);
    try {
      const text = await file.text();
      const rawRows = parseDailySalesCSV(text);
      if (rawRows.length === 0) { setParseError('No data rows found in this file.'); setParsing(false); return; }

      const [{ data: partRows }, { data: jobCardRows }, { data: saleCodeRows }, { data: debtRows }] = await Promise.all([
        supabase.from('parts').select('id,sku,name,category,selling_price_minor,quantity_on_hand,active'),
        supabase.from('job_cards').select('id,job_number,customers(full_name)').is('deleted_at', null),
        supabase.from('sales').select('payment_reference').neq('status', 'VOIDED').not('payment_reference', 'is', null),
        supabase.from('debt_records').select('incurred_date,amount_minor,item_description').like('item_description', 'Spares sales day book%'),
      ]);
      const parts = (partRows ?? []) as ExistingPartForSale[];
      const jobCardsByNumber = new Map<string, JobCardRef>();
      for (const j of (jobCardRows ?? []) as unknown as { id: string; job_number: string; customers: { full_name: string } | null }[]) {
        const key = normaliseJobCardNumber(j.job_number);
        if (key) jobCardsByNumber.set(key, { id: j.id, customerName: j.customers?.full_name ?? null });
      }
      const existingPaymentCodes = new Set(((saleCodeRows ?? []) as { payment_reference: string }[]).flatMap((s) => splitPaymentCodes(s.payment_reference)));

      const plan = planSalesRows(rawRows, parts, jobCardsByNumber, existingPaymentCodes);
      const found = findDayBookDebts(rawRows, plan);
      setPlanned(plan);
      setDebts(found);
      setDebtModes(Object.fromEntries(found.map((d) => [d.rowNumber, d.defaultMode])));
      setDebtOwedBy(Object.fromEntries(found.map((d) => [d.rowNumber, DEFAULT_OWED_BY])));
      setExistingDayDebts(new Set(((debtRows ?? []) as { incurred_date: string; amount_minor: number; item_description: string }[]).map((d) => `${d.incurred_date}|${d.amount_minor}|${d.item_description}`)));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read this file.');
    } finally { setParsing(false); }
  }

  function updateShelfCount(index: number, value: string) {
    setPlanned((prev) => {
      if (!prev) return prev;
      const row = prev[index];
      if (row.action !== 'SALE' || !row.payload) return prev;
      const parsed = value.trim() === '' ? null : parseFloat(value);
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
  const itemDebtByRow = new Map(debts.filter((d) => debtModes[d.rowNumber] === 'ITEM' && d.canBeItem).map((d) => [d.rowNumber, d]));
  const dayDebts = debts.filter((d) => debtModes[d.rowNumber] === 'DAY');
  const blockedDayDebts = canManageDebts ? [] : dayDebts;
  const isDuplicateDayDebt = (d: DayBookDebt) => existingDayDebts.has(`${d.date}|${d.amountMinor}|${dayDebtDescription(d)}`);

  function errorReport(): UploadErrorReport {
    const rows: UploadErrorReportRow[] = [
      ...errorRows.map((r) => ({ rowNumber: r.rowNumber, date: r.date, reference: r.sku, stage: 'CHECK' as const, errors: r.errors, warnings: r.warnings })),
      ...failedRows.map((f) => ({ rowNumber: f.row.rowNumber, date: f.row.date, reference: f.row.sku, stage: 'SAVE' as const, errors: [f.message] })),
      ...dayWarningRows.map((r) => ({ rowNumber: null, date: r.date, reference: 'Whole day', stage: 'NOTE' as const, errors: [], warnings: r.warnings })),
      ...failedDebts.map((f) => ({ rowNumber: f.debt.rowNumber, date: f.debt.date, reference: 'Day debt', stage: 'SAVE' as const, errors: [f.message] })),
      ...(done ? [] : blockedDayDebts.map((d) => ({ rowNumber: d.rowNumber, date: d.date, reference: 'Day debt', stage: 'NOTE' as const, errors: [], warnings: [`${formatKes(d.amountMinor)} day debt needs debt-management access to record — ask an admin, or record it in the Debt Register.`] }))),
    ];
    return { title: 'Sales', fileName, rows, referenceLabel: 'Part / SKU' };
  }
  const hasReport = errorRows.length > 0 || dayWarningRows.length > 0 || failedRows.length > 0 || failedDebts.length > 0 || (!done && blockedDayDebts.length > 0);

  async function apply() {
    if (!planned) return;
    setApplying(true); setProgress(0);
    let created = 0, failed = 0;
    const failures: { row: SalesPlannedRow; message: string }[] = [];

    for (const row of actionable) {
      try {
        const itemDebt = itemDebtByRow.get(row.rowNumber);
        const payload = itemDebt ? withItemDebt(row.payload!, itemDebt.amountMinor) : row.payload;
        const { error } = await supabase.rpc('complete_sale', payload as unknown as Record<string, unknown>);
        if (error) throw error;
        created++;
      } catch (err) {
        failed++;
        failures.push({ row, message: errorMessage(err) });
      }
      setProgress((p) => p + 1);
    }

    // Day debts go to the Debt Register as their own entries, not tied to any part.
    let dayDebtsRecorded = 0;
    const debtFailures: { debt: DayBookDebt; message: string }[] = [];
    if (canManageDebts) {
      for (const d of dayDebts) {
        const { error } = await supabase.rpc('record_debt', {
          p_debt_type: 'CUSTOMER',
          p_responsible_employee_id: null,
          p_responsible_name: (debtOwedBy[d.rowNumber] ?? '').trim() || DEFAULT_OWED_BY,
          p_item_description: dayDebtDescription(d),
          p_amount_minor: d.amountMinor,
          p_incurred_date: d.date,
          p_customer_id: null, p_job_card_id: null, p_part_id: null,
          p_notes: `Imported from ${fileName}, row ${d.rowNumber}.`,
        });
        if (error) debtFailures.push({ debt: d, message: errorMessage(error) });
        else dayDebtsRecorded++;
      }
    }

    setApplying(false);
    setFailedRows(failures);
    setFailedDebts(debtFailures);
    setDone({ created, failed, dayDebts: dayDebtsRecorded });
    if (failed === 0 && debtFailures.length === 0) onSaved(`Bulk sales upload applied: ${created} sale${created === 1 ? '' : 's'} recorded${dayDebtsRecorded ? `, ${dayDebtsRecorded} day debt${dayDebtsRecorded === 1 ? '' : 's'} added to the Debt Register` : ''}.`);
  }

  return (
    <div className="modal-backdrop" onClick={applying ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(900px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Sales</p><h2>Bulk upload</h2></div>{!applying && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>

        {!planned && !parsing && (
          <div className="modal-form">
            <p className="muted" style={{ margin: 0 }}>Upload the daily sales day book (one row per part sold). Each row checks the part exists and has enough stock, then records a sale and deducts stock automatically — the same way completing a sale in the app does. Rows with no part on them (day totals, blank spacer rows) are skipped; rows for a part not yet in the Parts module are flagged as errors, not guessed at. Shelf count comes from the file but can be corrected in the preview below; system remaining stock is always computed automatically from actual stock, never editable. Quantities can be decimals (0.5 kg, 1.5 sheets). Rows with a work order number (JB-…) are recorded as paid through that work order; &quot;Walk in&quot; rows are counter sales, recorded as Cash, or as M-Pesa when the row has a code in the MPESA CODE column (several codes can share one cell). The day&apos;s CASH/MPESA/BANKED amount is checked per day. Each DEBT amount can be recorded for the item on that row (the sale is saved as partly paid or on credit) or for the whole day (one Debt Register entry for that date) — you choose in the preview.</p>
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
              {dayWarningRows.length > 0 && <span className="status bg-amber-50 text-amber-700">{dayWarningRows.length} day note{dayWarningRows.length === 1 ? '' : 's'} to check</span>}
              {debts.length > 0 && <span className="status bg-violet-50 text-violet-700">{debts.length} debt{debts.length === 1 ? '' : 's'}</span>}
              {hasReport && <UploadErrorReportActions compact getReport={errorReport} style={{ marginLeft: 'auto' }} />}
            </div>
            {priceOverrideNeeded && !canOverridePrice && <div className="form-error"><AlertTriangle size={14} /> Some rows sell below/above the part&apos;s current price and will fail without price-override access.</div>}
            {dayWarningRows.map((r, i) => <div key={i} className="form-error" style={{ fontSize: 12 }}><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {r.warnings.join(' ')}</div>)}
            {debts.length > 0 && <div className="report-table-wrap">
              <table className="report-table"><thead><tr><th>Debt</th><th>Date</th><th>Row</th><th>Record it for</th><th>Owed by / responsible</th></tr></thead><tbody>
                {debts.map((d) => {
                  const mode = debtModes[d.rowNumber] ?? d.defaultMode;
                  return <tr key={d.rowNumber}>
                    <td style={{ fontWeight: 700, color: '#a4493d', whiteSpace: 'nowrap' }}>{formatKes(d.amountMinor)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d.dateLabel}</td>
                    <td>{d.rowNumber}</td>
                    <td>
                      <select value={mode} disabled={applying} onChange={(e) => setDebtModes((m) => ({ ...m, [d.rowNumber]: e.target.value as DebtMode }))} style={{ border: '1px solid #dfe5ea', borderRadius: 6, padding: '5px 6px', fontSize: 12, maxWidth: 260 }}>
                        <option value="ITEM" disabled={!d.canBeItem}>{d.saleSku ? `This item: ${d.saleSku}` : 'This item'}{d.canBeItem ? '' : d.saleSku ? ' (debt is more than the sale)' : ' (row not imported)'}</option>
                        <option value="DAY">The whole day ({d.dateLabel})</option>
                      </select>
                      {mode === 'DAY' && isDuplicateDayDebt(d) && <div style={{ fontSize: 11, color: '#b17b26', marginTop: 3 }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> A day debt of this amount for this date is already in the Debt Register.</div>}
                      {mode === 'DAY' && !canManageDebts && <div style={{ fontSize: 11, color: '#a4493d', marginTop: 3 }}>Needs debt-management access — this debt won&apos;t be recorded.</div>}
                      {mode === 'ITEM' && <div style={{ fontSize: 11, color: '#82909c', marginTop: 3 }}>Sale saved {d.amountMinor >= (d.saleTotalMinor ?? 0) ? 'unpaid, on credit' : `with ${formatKes(d.amountMinor)} still owed`}.</div>}
                    </td>
                    <td>
                      {mode === 'DAY'
                        ? <input value={debtOwedBy[d.rowNumber] ?? ''} disabled={applying} onChange={(e) => setDebtOwedBy((o) => ({ ...o, [d.rowNumber]: e.target.value }))} placeholder={DEFAULT_OWED_BY} style={{ width: '100%', minWidth: 140, border: '1px solid #dfe5ea', borderRadius: 6, padding: '5px 6px', fontSize: 12 }} />
                        : <span className="muted" style={{ fontSize: 11 }}>The sale&apos;s customer</span>}
                    </td>
                  </tr>;
                })}
              </tbody></table>
            </div>}
            <div className="report-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Date</th><th>SKU</th><th>Action</th><th>Shelf count</th><th>Details</th></tr></thead><tbody>
                {planned.map((r, i) => ({ r, i })).filter(({ r }) => r.action !== 'SKIP').map(({ r, i }) => <tr key={i}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.sku || '—'}</td>
                  <td><span className={`status ${r.action === 'SALE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.action}</span></td>
                  <td>
                    {r.action === 'SALE' && <input
                      type="number" min={0} step="any"
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
              {done.failed === 0 && failedDebts.length === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <strong>{done.failed === 0 && failedDebts.length === 0 ? 'Upload applied' : 'Upload finished with some failures'}</strong>
              <span>{done.created} sale{done.created === 1 ? '' : 's'} recorded{done.dayDebts > 0 ? ` · ${done.dayDebts} day debt${done.dayDebts === 1 ? '' : 's'} added to the Debt Register` : ''}{done.failed > 0 ? ` · ${done.failed} failed` : ''}{failedDebts.length > 0 ? ` · ${failedDebts.length} debt${failedDebts.length === 1 ? '' : 's'} not recorded` : ''}{errorRows.length > 0 ? ` · ${errorRows.length} not imported (errors)` : ''}</span>
            </div>
            {failedRows.length > 0 && <div className="report-table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Row</th><th>SKU</th><th>Reason</th></tr></thead><tbody>
                {failedRows.map((f) => <tr key={f.row.rowNumber}><td>{f.row.rowNumber}</td><td>{f.row.sku}</td><td style={{ fontSize: 11, color: '#a4493d' }}>{f.message}</td></tr>)}
              </tbody></table>
            </div>}
            {hasReport && <UploadErrorReportActions getReport={errorReport} />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button primary wide" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
