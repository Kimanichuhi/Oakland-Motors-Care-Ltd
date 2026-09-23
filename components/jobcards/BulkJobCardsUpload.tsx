import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/formatting';
import {
  parseJobCardsCSV, planJobCardRows, customerKey, vehicleKey, WALK_IN_CUSTOMER_NAME,
  type JobCardPlannedRow, type ExistingCustomer, type ExistingVehicle,
} from '@/lib/jobCardsImport';
import { Upload, Download, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

function downloadJobCardsTemplate() {
  const header = 'Date In,Customer Name,Customer Phone,Registration Number,Make,Model,Technician,Reason / Service Required,Total Charge,Amount Paid,Payment Status,Amount Owed,Mpesa Code,Job Status';
  const rows = [
    '12 Aug 2026,,,KCE720A,,,MUIGAI,Welding,100,100,Paid,0,UHDDM2T6XW,Completed',
    '4 Sep 2026,PAUL CHEGE,0702107950,KCE194R,Nissan,Cube,VIONA,Brakes,500,0,Unpaid,500,,In Progress',
  ];
  const csv = [header, ...rows].join('\r\n');
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'Oakland_Work_Orders_Template.csv'; a.click();
  URL.revokeObjectURL(url);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  if (typeof err === 'string' && err) return err;
  return 'Unable to save this entry.';
}

type FailedRow = { row: JobCardPlannedRow; message: string };

export default function BulkJobCardsUploadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [planned, setPlanned] = useState<JobCardPlannedRow[] | null>(null);
  const [createdCustomers, setCreatedCustomers] = useState<string[]>([]);
  const [createdVehicles, setCreatedVehicles] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parseError, setParseError] = useState('');
  const [created, setCreated] = useState(0);
  const [failedRows, setFailedRows] = useState<FailedRow[] | null>(null);

  async function handleFile(file: File) {
    setParseError(''); setPlanned(null); setFailedRows(null); setCreated(0); setCreatedCustomers([]); setCreatedVehicles([]); setFileName(file.name); setParsing(true);
    try {
      const text = await file.text();
      const rawRows = parseJobCardsCSV(text);
      if (rawRows.length === 0) { setParseError('No data rows found in this file.'); setParsing(false); return; }

      const [{ data: customerRows }, { data: vehicleRows }] = await Promise.all([
        supabase.from('customers').select('id, full_name').is('deleted_at', null),
        supabase.from('vehicles').select('id, customer_id, registration_number').is('deleted_at', null),
      ]);
      const customersByKey = new Map<string, ExistingCustomer>(((customerRows ?? []) as ExistingCustomer[]).map((c) => [customerKey(c.full_name), c]));
      const vehiclesByKey = new Map<string, ExistingVehicle>(((vehicleRows ?? []) as ExistingVehicle[]).map((v) => [vehicleKey(v.registration_number), v]));

      // Auto-create any customer/vehicle the file references that doesn't exist
      // yet, mirroring BulkPartsUpload's auto-create-missing-suppliers pattern —
      // a fresh historical import routinely references people/vehicles nobody
      // has registered in the app yet. Every blank Customer Name shares one
      // reused "Walk-in customer" record rather than creating one per row.
      const neededCustomers = new Map<string, string>(); // key -> display name
      const neededVehicles = new Map<string, { registration: string; make: string | null; model: string | null; customerKeyForNew: string }>();
      for (const row of rawRows) {
        const cKey = customerKey(row.customerName);
        if (!customersByKey.has(cKey) && !neededCustomers.has(cKey)) neededCustomers.set(cKey, row.customerName.trim() || WALK_IN_CUSTOMER_NAME);
        const vKey = vehicleKey(row.registrationNumber);
        if (vKey && !vehiclesByKey.has(vKey) && !neededVehicles.has(vKey)) {
          neededVehicles.set(vKey, { registration: vKey, make: row.make.trim() || null, model: row.model.trim() || null, customerKeyForNew: cKey });
        }
      }

      const newCustomerNames: string[] = [];
      for (const [key, name] of Array.from(neededCustomers.entries())) {
        const { data, error } = await supabase.from('customers').insert({ full_name: name, phone: '' }).select('id, full_name').single();
        if (!error && data) { customersByKey.set(key, data as ExistingCustomer); newCustomerNames.push(name); }
      }
      setCreatedCustomers(newCustomerNames);

      const newVehicleRegs: string[] = [];
      for (const [key, v] of Array.from(neededVehicles.entries())) {
        const customer = customersByKey.get(v.customerKeyForNew);
        if (!customer) continue;
        const { data, error } = await supabase.from('vehicles').insert({ customer_id: customer.id, registration_number: v.registration, make: v.make, model: v.model }).select('id, customer_id, registration_number').single();
        if (!error && data) { vehiclesByKey.set(key, data as ExistingVehicle); newVehicleRegs.push(v.registration); }
      }
      setCreatedVehicles(newVehicleRegs);

      setPlanned(planJobCardRows(rawRows, customersByKey, vehiclesByKey));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read this file.');
    } finally { setParsing(false); }
  }

  const actionable = (planned ?? []).filter((r) => r.action === 'CREATE');
  const errorRows = (planned ?? []).filter((r) => r.action === 'ERROR');

  async function apply() {
    if (!planned) return;
    setApplying(true); setProgress(0);
    let createdCount = 0;
    const failures: FailedRow[] = [];

    for (const row of actionable) {
      const p = row.payload!;
      try {
        const { data: jobNumber, error: numberError } = await supabase.rpc('generate_job_card_number');
        if (numberError || !jobNumber) throw numberError ?? new Error('Unable to generate a work order number.');

        const { data: jobCard, error: insertError } = await supabase.from('job_cards').insert({
          job_number: jobNumber, customer_id: p.customerId, vehicle_id: p.vehicleId,
          complaint: p.complaint, job_types: [p.complaint], other_charges_minor: p.otherChargesMinor,
          created_at: p.createdAtIso,
        }).select('id').single();
        if (insertError || !jobCard) throw insertError ?? new Error('Unable to create the work order.');
        const jobCardId = (jobCard as { id: string }).id;

        for (const status of p.targetStatuses) {
          const { error: transitionError } = await supabase.rpc('transition_job_status', { p_job_card_id: jobCardId, p_new_status: status });
          if (transitionError) throw transitionError;
        }

        if (p.technicianName) {
          await supabase.from('job_card_signoffs').insert({ job_card_id: jobCardId, role: 'TECHNICIAN', name: p.technicianName });
        }

        if (p.payment) {
          const { data: invoiceId, error: invoiceError } = await supabase.rpc('ensure_job_card_invoice', { p_job_card_id: jobCardId });
          if (invoiceError || !invoiceId) throw invoiceError ?? new Error('Unable to open a running tab for this work order.');
          const { error: paymentError } = await supabase.rpc('record_payment', {
            p_invoice_id: invoiceId, p_amount_minor: p.payment.amountMinor, p_method: p.payment.method,
            p_reference: p.payment.reference, p_idempotency_key: `bulk-jobcard-${jobCardId}`, p_notes: null,
          });
          if (paymentError) throw paymentError;
        }

        createdCount++;
      } catch (err) {
        failures.push({ row, message: errorMessage(err) });
      }
      setProgress((n) => n + 1);
    }

    setApplying(false);
    setCreated(createdCount);
    setFailedRows(failures);
    if (failures.length === 0) onSaved(`Bulk work order upload applied: ${createdCount} work order${createdCount === 1 ? '' : 's'} created.`);
  }

  return (
    <div className="modal-backdrop" onClick={applying ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(940px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Work Orders</p><h2>Bulk upload</h2></div>{!applying && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>

        {!planned && !parsing && (
          <div className="modal-form">
            <p className="muted" style={{ margin: 0 }}>Upload a batch of historical work orders. Each row checks for an existing customer/vehicle and creates them automatically if missing (blank customer names all share one &quot;Walk-in customer&quot; record). Job numbers are generated by the app itself, in the same sequence live work orders use — the file&apos;s own Job Card No. column is for your reference only and isn&apos;t stored. Job Status maps to this app&apos;s statuses (Completed, In Progress, Pending → Open; On Hold has no equivalent and is also recorded as Open). Total Charge is recorded as a flat other-charge with no itemised labour/parts.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="button secondary wide" onClick={downloadJobCardsTemplate}><Download size={16} /> Download template</button>
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
              <span className="status bg-emerald-50 text-emerald-700">{actionable.length} work order{actionable.length === 1 ? '' : 's'} to create</span>
              {errorRows.length > 0 && <span className="status bg-red-50 text-red-700">{errorRows.length} errors</span>}
            </div>
            {(createdCustomers.length > 0 || createdVehicles.length > 0) && (
              <p className="muted" style={{ fontSize: 12 }}>
                <CheckCircle2 size={12} style={{ verticalAlign: -1 }} />
                {createdCustomers.length > 0 && ` Created ${createdCustomers.length} new customer${createdCustomers.length === 1 ? '' : 's'} (${createdCustomers.join(', ')}).`}
                {createdVehicles.length > 0 && ` Registered ${createdVehicles.length} new vehicle${createdVehicles.length === 1 ? '' : 's'} (${createdVehicles.join(', ')}).`}
              </p>
            )}
            <div className="report-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Row</th><th>Date</th><th>Reg.</th><th>Action</th><th>Details</th></tr></thead><tbody>
                {planned.map((r) => <tr key={r.rowNumber}>
                  <td>{r.rowNumber}</td>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.registrationNumber || '—'}</td>
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
                {applying ? 'Applying…' : `Apply ${actionable.length} work order${actionable.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {failedRows && (
          <div className="modal-form">
            <div className="empty" style={{ padding: '18px 12px' }}>
              {failedRows.length === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <strong>{failedRows.length === 0 ? 'Upload applied' : 'Upload finished with some failures'}</strong>
              <span>{created} work order{created === 1 ? '' : 's'} created{failedRows.length > 0 ? ` · ${failedRows.length} failed` : ''}</span>
            </div>
            {failedRows.length > 0 && <div className="report-table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="report-table"><thead><tr><th>Row</th><th>Reg.</th><th>Reason</th></tr></thead><tbody>
                {failedRows.map((f) => <tr key={f.row.rowNumber}>
                  <td>{f.row.rowNumber}</td>
                  <td>{f.row.registrationNumber}</td>
                  <td style={{ fontSize: 11, color: '#a4493d' }}>{f.message}</td>
                </tr>)}
              </tbody></table>
            </div>}
            <button type="button" className="button primary wide" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
