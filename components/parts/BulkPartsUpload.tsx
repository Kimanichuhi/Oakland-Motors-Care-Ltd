import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseCSVRows } from '@/lib/csv';
import { downloadCSV } from '@/lib/formatting';
import { firstNonEmpty, planRows, MODE_LABELS, type UploadMode, type ExistingPart, type PlannedRow } from '@/lib/partsImport';
import { Upload, Download, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

function downloadTemplate() {
  downloadCSV('Oakland_Parts_Upload_Template.csv', [{
    'Part/spare No': 'BP-001',
    'Description': 'Brake pads',
    'Vehicle model & part make': 'Corolla · Bosch',
    'Remarks': '',
    'Quantity': 10,
    'Unit Cost Price': '850.00',
    'Total Stock Price': '8500.00',
    'Date Purchased': '2026-08-01',
    'Supplier': '',
  }]);
}

export default function BulkPartsUploadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<UploadMode>('RECEIVE');
  const [fileName, setFileName] = useState('');
  const [planned, setPlanned] = useState<PlannedRow[] | null>(null);
  const [suppliersCreated, setSuppliersCreated] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseError, setParseError] = useState('');
  const [done, setDone] = useState<{ created: number; received: number; updated: number; adjusted: number; failed: number } | null>(null);

  async function handleFile(file: File) {
    setParseError(''); setPlanned(null); setDone(null); setSuppliersCreated([]); setFileName(file.name); setParsing(true);
    try {
      const text = await file.text();
      const rows = parseCSVRows(text);
      if (rows.length === 0) { setParseError('No data rows found in this file.'); setParsing(false); return; }

      const [{ data: existingRows }, { data: supplierRows }] = await Promise.all([
        supabase.from('parts').select('id,sku,quantity_on_hand,cost_price_minor,name,vehicle_model,brand,remarks,date_purchased,supplier_id'),
        supabase.from('suppliers').select('id,name').is('deleted_at', null),
      ]);
      const supplierByName = new Map(((supplierRows ?? []) as { id: string; name: string }[]).map((s) => [s.name.trim().toLowerCase(), s.id]));

      // Auto-create any supplier named in the file that doesn't exist yet, so rows
      // don't get stranded with "supplier not found" — a fresh onboarding import
      // routinely references suppliers nobody has registered in the app yet.
      const neededNames = new Set<string>();
      for (const row of rows) {
        const raw = firstNonEmpty(row, ['supplier']);
        if (raw && !supplierByName.has(raw.trim().toLowerCase())) neededNames.add(raw.trim());
      }
      const created: string[] = [];
      for (const name of Array.from(neededNames)) {
        const { data, error } = await supabase.from('suppliers').insert({ name, phone: '' }).select('id').single();
        if (!error && data) { supplierByName.set(name.toLowerCase(), data.id); created.push(name); }
      }
      setSuppliersCreated(created);

      const plan = planRows(rows, (existingRows ?? []) as ExistingPart[], supplierByName, mode);
      setPlanned(plan);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read this file.');
    } finally { setParsing(false); }
  }

  const actionable = (planned ?? []).filter((r) => r.action === 'CREATE' || r.action === 'UPDATE' || r.action === 'RECEIVE');
  const errorRows = (planned ?? []).filter((r) => r.action === 'ERROR');
  const noChangeRows = (planned ?? []).filter((r) => r.action === 'NO_CHANGE');
  const skippedRows = (planned ?? []).filter((r) => r.action === 'SKIP');
  const subtotalWarnings = skippedRows.filter((r) => r.warnings.length > 0);

  async function apply() {
    if (!planned) return;
    setApplying(true); setProgress(0);
    let created = 0, received = 0, updated = 0, adjusted = 0, failed = 0;
    const skuToRealId = new Map<string, string>();

    for (const row of actionable) {
      try {
        let targetId = row.existingId ?? (row.linkSku ? skuToRealId.get(row.linkSku) : undefined);

        if (row.action === 'CREATE') {
          const { data, error } = await supabase.from('parts').insert(row.createPayload).select('id').single();
          if (error) throw error;
          const newId = (data as { id: string }).id;
          targetId = newId;
          skuToRealId.set(row.sku.trim().toLowerCase(), newId);
          created++;
        } else if (!targetId) {
          throw new Error('Could not resolve which part this row belongs to.');
        } else if (Object.keys(row.fieldUpdates).length > 0) {
          const { error } = await supabase.from('parts').update(row.fieldUpdates).eq('id', targetId);
          if (error) throw error;
        }

        if (row.receive && targetId) {
          const { error } = await supabase.rpc('receive_stock', {
            p_part_id: targetId, p_quantity: row.receive.quantity, p_unit_cost_minor: row.receive.costMinor ?? 0,
            p_reference: `Bulk upload (${fileName})`,
          });
          if (error) throw error;
          received++;
        }
        if (row.quantityChange && targetId) {
          const { delta } = row.quantityChange;
          const { error } = await supabase.rpc('adjust_stock', {
            p_part_id: targetId, p_adjustment_type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', p_quantity: Math.abs(delta),
            p_reason: `Bulk upload reconciliation (${fileName})`,
          });
          if (error) throw error;
          adjusted++;
        }
        if (row.action === 'UPDATE') updated++;
      } catch {
        failed++;
      }
      setProgress((p) => p + 1);
    }

    setApplying(false);
    setDone({ created, received, updated, adjusted, failed });
    if (failed === 0) onSaved(`Bulk upload applied: ${created} created, ${received} received, ${updated} updated.`);
  }

  return (
    <div className="modal-backdrop" onClick={applying ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(860px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Parts</p><h2>Bulk upload</h2></div>{!applying && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>

        {!planned && !parsing && (
          <div className="modal-form">
            <label>Import mode
              <select value={mode} onChange={(e) => setMode(e.target.value as UploadMode)}>
                {(Object.keys(MODE_LABELS) as UploadMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m].label}</option>)}
              </select>
            </label>
            <p className="muted" style={{ margin: '-8px 0 4px', fontSize: 12 }}>{MODE_LABELS[mode].help}</p>
            <p className="muted" style={{ margin: 0 }}>Match an existing Part/spare No to update that part; a new one creates a part. Blank cells leave existing values unchanged. Fill in Unit Cost Price, or leave it blank and give Total Stock Price + Quantity instead — the unit price will be calculated for you. Suppliers named in the file that don&apos;t exist yet are created automatically.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary wide" onClick={downloadTemplate}><Download size={16} /> Download template</button>
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
              <span className="status bg-emerald-50 text-emerald-700">{actionable.filter((r) => r.action === 'CREATE').length} new</span>
              <span className="status bg-blue-50 text-blue-700">{actionable.filter((r) => r.action === 'RECEIVE').length} receiving stock</span>
              <span className="status bg-violet-50 text-violet-700">{actionable.filter((r) => r.action === 'UPDATE').length} to update</span>
              {noChangeRows.length > 0 && <span className="status bg-slate-100 text-slate-600">{noChangeRows.length} unchanged</span>}
              {skippedRows.length > 0 && <span className="status bg-slate-100 text-slate-600">{skippedRows.length} skipped (subtotal/blank rows)</span>}
              {errorRows.length > 0 && <span className="status bg-red-50 text-red-700">{errorRows.length} errors</span>}
            </div>
            {suppliersCreated.length > 0 && <p className="muted" style={{ fontSize: 12 }}><CheckCircle2 size={12} style={{ verticalAlign: -1 }} /> Created {suppliersCreated.length} new supplier{suppliersCreated.length === 1 ? '' : 's'}: {suppliersCreated.join(', ')}.</p>}
            {subtotalWarnings.map((r) => <div key={r.rowNumber} className="form-error" style={{ fontSize: 12 }}><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> Row {r.rowNumber}: {r.warnings.join(' ')}</div>)}
            <div className="report-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Row</th><th>SKU</th><th>Action</th><th>Details</th></tr></thead><tbody>
                {planned.filter((r) => r.action !== 'NO_CHANGE' && r.action !== 'SKIP').map((r) => <tr key={r.rowNumber}>
                  <td>{r.rowNumber}</td>
                  <td>{r.sku || '—'}</td>
                  <td><span className={`status ${r.action === 'CREATE' ? 'bg-emerald-50 text-emerald-700' : r.action === 'RECEIVE' ? 'bg-blue-50 text-blue-700' : r.action === 'UPDATE' ? 'bg-violet-50 text-violet-700' : 'bg-red-50 text-red-700'}`}>{r.action}</span></td>
                  <td style={{ fontSize: 11 }}>
                    {r.errors.map((e, i) => <div key={i} style={{ color: '#a4493d' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {e}</div>)}
                    {r.summary.map((s, i) => <div key={i}>{s}</div>)}
                    {r.warnings.map((w, i) => <div key={i} style={{ color: '#b17b26' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {w}</div>)}
                  </td>
                </tr>)}
              </tbody></table>
            </div>
            {applying && <p className="muted">Applying… {progress} / {actionable.length}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary" disabled={applying} onClick={() => { setPlanned(null); setFileName(''); }}>Choose a different file</button>
              <button type="button" className="button primary wide" disabled={applying || actionable.length === 0} onClick={() => void apply()}>
                {applying ? 'Applying…' : `Apply ${actionable.length} change${actionable.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="modal-form">
            <div className="empty" style={{ padding: '18px 12px' }}>
              {done.failed === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <strong>{done.failed === 0 ? 'Upload applied' : 'Upload finished with some failures'}</strong>
              <span>{done.created} created · {done.received} receipts recorded · {done.updated} updated ({done.adjusted} with a quantity adjustment){done.failed > 0 ? ` · ${done.failed} failed` : ''}</span>
            </div>
            <button type="button" className="button primary wide" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
