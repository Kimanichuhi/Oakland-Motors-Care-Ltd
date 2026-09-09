import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseCSVRows } from '@/lib/csv';
import { formatKes, formatDate, displayToMinor } from '@/lib/formatting';
import { Upload, X, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';

type ExistingPart = {
  id: string; sku: string; quantity_on_hand: number; cost_price_minor: number;
  name: string | null; vehicle_model: string | null; brand: string | null; remarks: string | null; date_purchased: string | null; supplier_id: string | null;
};

type PlannedRow = {
  rowNumber: number;
  sku: string;
  action: 'CREATE' | 'UPDATE' | 'NO_CHANGE' | 'ERROR';
  errors: string[];
  warnings: string[];
  existingId?: string;
  updatePayload: Record<string, unknown>;
  quantityChange?: { from: number; to: number; delta: number };
  summary: string[];
};

function firstNonEmpty(row: Record<string, string>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.trim().toLowerCase()) && row[k].trim() !== '') return row[k].trim();
  }
  return '';
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? displayToMinor(n) : null;
}

function planRows(rows: Record<string, string>[], existing: ExistingPart[], suppliers: { id: string; name: string }[]): PlannedRow[] {
  const bySku = new Map(existing.map((p) => [p.sku.trim().toLowerCase(), p]));
  const supplierByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));

  return rows.map((row, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const sku = firstNonEmpty(row, ['part/spare no', 'part / spare no', 'sku', 'part number']);
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];

    if (!sku) {
      return { rowNumber, sku: '', action: 'ERROR', errors: ['Missing Part/spare No (SKU) — row skipped.'], warnings, updatePayload: {}, summary };
    }

    const description = firstNonEmpty(row, ['description', 'part name', 'name']);
    const remarksRaw = firstNonEmpty(row, ['remarks', 'notes']);
    const vehicleModelCol = firstNonEmpty(row, ['vehicle model']);
    const partMakeCol = firstNonEmpty(row, ['part make', 'brand']);
    const combined = firstNonEmpty(row, ['vehicle model & part make', 'vehicle model and part make']);
    let vehicleModel = vehicleModelCol;
    let brand = partMakeCol;
    if (!vehicleModel && !brand && combined) {
      const parts = combined.split(/·|\/|,/).map((s) => s.trim()).filter(Boolean);
      vehicleModel = parts[0] ?? ''; brand = parts[1] ?? '';
    }
    const qtyRaw = firstNonEmpty(row, ['quantity', 'qty']);
    const costRaw = firstNonEmpty(row, ['unit cost price', 'unit cost', 'cost price']);
    const dateRaw = firstNonEmpty(row, ['date purchased', 'date']);
    const supplierRaw = firstNonEmpty(row, ['supplier']);

    let quantity: number | null = null;
    if (qtyRaw !== '') {
      const n = parseInt(qtyRaw, 10);
      if (!Number.isFinite(n) || n < 0) errors.push(`Invalid Quantity "${qtyRaw}".`);
      else quantity = n;
    }
    let costMinor: number | null = null;
    if (costRaw !== '') {
      costMinor = parseMoney(costRaw);
      if (costMinor === null) errors.push(`Invalid Unit Cost Price "${costRaw}".`);
    }
    let datePurchased: string | null | undefined;
    if (dateRaw !== '') {
      const d = new Date(dateRaw);
      if (Number.isNaN(d.getTime())) errors.push(`Invalid Date Purchased "${dateRaw}" — use YYYY-MM-DD.`);
      else datePurchased = d.toISOString().slice(0, 10);
    }
    let supplierId: string | null | undefined;
    if (supplierRaw !== '') {
      const match = supplierByName.get(supplierRaw.trim().toLowerCase());
      if (match) supplierId = match;
      else warnings.push(`Supplier "${supplierRaw}" not found — left unchanged rather than guessed.`);
    }

    const existingPart = bySku.get(sku.trim().toLowerCase());

    if (!existingPart) {
      if (!description) errors.push('New part needs a Description.');
      if (errors.length > 0) return { rowNumber, sku, action: 'ERROR', errors, warnings, updatePayload: {}, summary };
      const payload: Record<string, unknown> = {
        sku, name: description, category: 'General', selling_price_minor: 0,
        brand: brand || null, vehicle_model: vehicleModel || null, remarks: remarksRaw || null,
        date_purchased: datePurchased ?? null, supplier_id: supplierId ?? null,
        cost_price_minor: costMinor ?? 0, quantity_on_hand: quantity ?? 0, reorder_level: 0,
      };
      warnings.push('New part — category defaults to "General" and selling price to KES 0; edit those afterward.');
      summary.push('New part will be created');
      return { rowNumber, sku, action: 'CREATE', errors, warnings, updatePayload: payload, summary };
    }

    if (errors.length > 0) return { rowNumber, sku, action: 'ERROR', errors, warnings, existingId: existingPart.id, updatePayload: {}, summary };

    const updatePayload: Record<string, unknown> = {};
    if (description && description !== existingPart.name) { updatePayload.name = description; summary.push(`Description → "${description}"`); }
    if (vehicleModel && vehicleModel !== (existingPart.vehicle_model ?? '')) { updatePayload.vehicle_model = vehicleModel; summary.push(`Vehicle model → "${vehicleModel}"`); }
    if (brand && brand !== (existingPart.brand ?? '')) { updatePayload.brand = brand; summary.push(`Part make → "${brand}"`); }
    if (remarksRaw && remarksRaw !== (existingPart.remarks ?? '')) { updatePayload.remarks = remarksRaw; summary.push('Remarks updated'); }
    if (datePurchased && datePurchased !== existingPart.date_purchased) { updatePayload.date_purchased = datePurchased; summary.push(`Date purchased → ${formatDate(datePurchased)}`); }
    if (costMinor !== null && costMinor !== existingPart.cost_price_minor) { updatePayload.cost_price_minor = costMinor; summary.push(`Unit cost → ${formatKes(costMinor)}`); }
    if (supplierId && supplierId !== existingPart.supplier_id) { updatePayload.supplier_id = supplierId; summary.push('Supplier updated'); }

    let quantityChange: PlannedRow['quantityChange'];
    if (quantity !== null && quantity !== existingPart.quantity_on_hand) {
      quantityChange = { from: existingPart.quantity_on_hand, to: quantity, delta: quantity - existingPart.quantity_on_hand };
      summary.push(`Quantity ${existingPart.quantity_on_hand} → ${quantity} (via audited stock adjustment)`);
    }

    if (Object.keys(updatePayload).length === 0 && !quantityChange) {
      return { rowNumber, sku, action: 'NO_CHANGE', errors, warnings, existingId: existingPart.id, updatePayload, quantityChange, summary: ['No changes'] };
    }
    return { rowNumber, sku, action: 'UPDATE', errors, warnings, existingId: existingPart.id, updatePayload, quantityChange, summary };
  });
}

export default function BulkPartsUploadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [planned, setPlanned] = useState<PlannedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseError, setParseError] = useState('');
  const [done, setDone] = useState<{ created: number; updated: number; adjusted: number; failed: number } | null>(null);

  async function handleFile(file: File) {
    setParseError(''); setPlanned(null); setDone(null); setFileName(file.name); setParsing(true);
    try {
      const text = await file.text();
      const rows = parseCSVRows(text);
      if (rows.length === 0) { setParseError('No data rows found in this file.'); setParsing(false); return; }
      const [{ data: existingRows }, { data: supplierRows }] = await Promise.all([
        supabase.from('parts').select('id,sku,quantity_on_hand,cost_price_minor,name,vehicle_model,brand,remarks,date_purchased,supplier_id'),
        supabase.from('suppliers').select('id,name').is('deleted_at', null),
      ]);
      const plan = planRows(rows, (existingRows ?? []) as ExistingPart[], (supplierRows ?? []) as { id: string; name: string }[]);
      setPlanned(plan);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read this file.');
    } finally { setParsing(false); }
  }

  const actionable = (planned ?? []).filter((r) => r.action === 'CREATE' || r.action === 'UPDATE');
  const errorRows = (planned ?? []).filter((r) => r.action === 'ERROR');
  const noChangeRows = (planned ?? []).filter((r) => r.action === 'NO_CHANGE');

  async function apply() {
    if (!planned) return;
    setApplying(true); setProgress(0);
    let created = 0, updated = 0, adjusted = 0, failed = 0;

    for (const row of actionable) {
      try {
        if (row.action === 'CREATE') {
          const { error } = await supabase.from('parts').insert(row.updatePayload);
          if (error) throw error;
          created++;
        } else if (row.action === 'UPDATE') {
          if (Object.keys(row.updatePayload).length > 0) {
            const { error } = await supabase.from('parts').update(row.updatePayload).eq('id', row.existingId);
            if (error) throw error;
          }
          if (row.quantityChange && row.existingId) {
            const { delta } = row.quantityChange;
            const { error } = await supabase.rpc('adjust_stock', {
              p_part_id: row.existingId,
              p_adjustment_type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
              p_quantity: Math.abs(delta),
              p_reason: `Bulk upload reconciliation (${fileName})`,
            });
            if (error) throw error;
            adjusted++;
          }
          updated++;
        }
      } catch {
        failed++;
      }
      setProgress((p) => p + 1);
    }

    setApplying(false);
    setDone({ created, updated, adjusted, failed });
    if (failed === 0) onSaved(`Bulk upload applied: ${created} created, ${updated} updated.`);
  }

  return (
    <div className="modal-backdrop" onClick={applying ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(820px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Parts</p><h2>Bulk upload</h2></div>{!applying && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>

        {!planned && !parsing && (
          <div className="modal-form">
            <p className="muted" style={{ margin: 0 }}>
              Upload a CSV with the same columns as the Parts table: <strong>Part/spare No, Description, Vehicle model &amp; part make (or separate Vehicle Model / Part Make columns), Remarks, Quantity, Unit Cost Price, Date Purchased, Supplier</strong>.
              Rows matching an existing Part/spare No update that part; unrecognized numbers are created new. Blank cells leave the existing value unchanged. Quantity changes go through the same audited stock-adjustment ledger as Adjust Stock, so nothing bypasses it.
            </p>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
            <button type="button" className="button primary wide" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Choose CSV file</button>
            {parseError && <div className="form-error">{parseError}</div>}
          </div>
        )}

        {parsing && <div className="empty"><strong>Reading {fileName}…</strong></div>}

        {planned && !done && (
          <div className="modal-form">
            <div className="action-buttons" style={{ marginBottom: 4 }}>
              <span className="status bg-emerald-50 text-emerald-700">{actionable.filter((r) => r.action === 'CREATE').length} new</span>
              <span className="status bg-blue-50 text-blue-700">{actionable.filter((r) => r.action === 'UPDATE').length} to update</span>
              {noChangeRows.length > 0 && <span className="status bg-slate-100 text-slate-600">{noChangeRows.length} unchanged</span>}
              {errorRows.length > 0 && <span className="status bg-red-50 text-red-700">{errorRows.length} errors</span>}
            </div>
            <div className="report-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Row</th><th>SKU</th><th>Action</th><th>Details</th></tr></thead><tbody>
                {planned.filter((r) => r.action !== 'NO_CHANGE').map((r) => <tr key={r.rowNumber}>
                  <td>{r.rowNumber}</td>
                  <td>{r.sku || '—'}</td>
                  <td><span className={`status ${r.action === 'CREATE' ? 'bg-emerald-50 text-emerald-700' : r.action === 'UPDATE' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>{r.action}</span></td>
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
              <span>{done.created} created · {done.updated} updated ({done.adjusted} with a quantity adjustment){done.failed > 0 ? ` · ${done.failed} failed` : ''}</span>
            </div>
            <button type="button" className="button primary wide" onClick={onClose}>Close</button>
          </div>
        )}

        {!planned && !parsing && (
          <p className="muted" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={13} /> Tip: use &quot;Export CSV&quot; on the Parts list first — edit that file and re-upload it here.</p>
        )}
      </div>
    </div>
  );
}
