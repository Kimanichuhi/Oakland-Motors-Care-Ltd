import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Employee, Customer, JobCard, Part, DebtRecord } from '@/lib/types';
import { localDateStr } from '@/lib/formatting';
import { X } from 'lucide-react';

const OTHER = '__other';

function ResponsiblePersonFields({ employees, employeeId, setEmployeeId, customName, setCustomName }: {
  employees: Employee[]; employeeId: string; setEmployeeId: (v: string) => void; customName: string; setCustomName: (v: string) => void;
}) {
  return <>
    <label>Responsible person
      <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
        <option value="">Select employee...</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.role ? ` (${e.role})` : ''}</option>)}
        <option value={OTHER}>Other / not on staff list</option>
      </select>
    </label>
    {employeeId === OTHER && <label>Name<input value={customName} onChange={(ev) => setCustomName(ev.target.value)} placeholder="Full name" required /></label>}
  </>;
}

export function RecordDebtForm({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [debtType, setDebtType] = useState<'CUSTOMER' | 'STAFF'>('CUSTOMER');
  const [employeeId, setEmployeeId] = useState('');
  const [customName, setCustomName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [jobCardId, setJobCardId] = useState('');
  const [partId, setPartId] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredDate, setIncurredDate] = useState(localDateStr());
  const [notes, setNotes] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobCards, setJobCards] = useState<(JobCard & { customers: { full_name: string } | null; vehicles: { registration_number: string } | null })[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (debtType !== 'CUSTOMER') return;
    if (customers.length > 0 || jobCards.length > 0) return;
    supabase.from('customers').select('*').is('deleted_at', null).order('full_name').limit(200).then(({ data }) => setCustomers((data ?? []) as Customer[]));
    supabase.from('job_cards').select('*, customers(full_name), vehicles(registration_number)').is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setJobCards((data ?? []) as (JobCard & { customers: { full_name: string } | null; vehicles: { registration_number: string } | null })[]));
  }, [debtType, customers.length, jobCards.length]);

  useEffect(() => { supabase.from('parts').select('*').eq('active', true).order('name').limit(300).then(({ data }) => setParts((data ?? []) as Part[])); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amountMinor = Math.round((parseFloat(amount) || 0) * 100);
    if (amountMinor <= 0) { setError('Enter a valid amount.'); return; }
    if (!itemDescription.trim()) { setError('Describe what caused this debt.'); return; }
    if (!employeeId) { setError('Select who is responsible.'); return; }

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('record_debt', {
      p_debt_type: debtType,
      p_responsible_employee_id: employeeId === OTHER ? null : employeeId,
      p_responsible_name: employeeId === OTHER ? customName : (employees.find((e) => e.id === employeeId)?.full_name ?? ''),
      p_item_description: itemDescription.trim(),
      p_amount_minor: amountMinor,
      p_incurred_date: incurredDate,
      p_customer_id: debtType === 'CUSTOMER' && customerId ? customerId : null,
      p_job_card_id: debtType === 'CUSTOMER' && jobCardId ? jobCardId : null,
      p_part_id: partId || null,
      p_notes: notes || null,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    onSaved('Debt recorded.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Debt register</p><h2>Record a debt</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit} className="modal-form">
          <label>Type
            <select value={debtType} onChange={(e) => setDebtType(e.target.value as typeof debtType)}>
              <option value="CUSTOMER">Customer debt (technician accountable)</option>
              <option value="STAFF">Staff liability (owed to the business)</option>
            </select>
          </label>
          <ResponsiblePersonFields employees={employees} employeeId={employeeId} setEmployeeId={setEmployeeId} customName={customName} setCustomName={setCustomName} />
          {debtType === 'CUSTOMER' && <div className="form-row">
            <label>Customer <span className="optional">Optional</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Not linked</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </label>
            <label>Work order <span className="optional">Optional</span>
              <select value={jobCardId} onChange={(e) => setJobCardId(e.target.value)}>
                <option value="">Not linked</option>
                {jobCards.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicles?.registration_number ?? 'Vehicle'}</option>)}
              </select>
            </label>
          </div>}
          <label>Product / part <span className="optional">Optional</span>
            <select value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">Not linked to a specific part</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
          </label>
          <label>What caused this debt<textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} placeholder="e.g. Brake pads issued without collecting payment" style={{ minHeight: 60 }} required /></label>
          <div className="form-row">
            <label>Amount (KES)<input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label>Date incurred<input type="date" value={incurredDate} max={localDateStr()} onChange={(e) => setIncurredDate(e.target.value)} required /></label>
          </div>
          <label>Notes <span className="optional">Optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 46 }} /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary wide" disabled={busy}>{busy ? 'Recording...' : 'Record debt'}</button>
        </form>
      </div>
    </div>
  );
}

export function DebtRecoveryForm({ debt, onClose, onSaved }: { debt: DebtRecord; onClose: () => void; onSaved: (m: string) => void }) {
  const remaining = debt.amount_minor - debt.amount_recovered_minor;
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amountMinor = Math.round((parseFloat(amount) || 0) * 100);
    if (amountMinor <= 0) { setError('Enter a valid amount.'); return; }
    if (amountMinor > remaining) { setError('Amount exceeds the outstanding balance.'); return; }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('record_debt_recovery', { p_debt_id: debt.id, p_amount_minor: amountMinor, p_notes: notes || null });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    onSaved('Recovery recorded.');
    onClose();
  }

  async function submitWriteOff() {
    const reason = window.prompt('Reason for writing off this debt:');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('write_off_debt', { p_debt_id: debt.id, p_reason: reason.trim() });
    setBusy(false);
    if (rpcError) { onSaved(rpcError.message); return; }
    onSaved('Debt written off.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">{debt.responsible_name}</p><h2>Record recovery</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submitRecovery} className="modal-form">
          <label>Amount recovered (KES) — up to {(remaining / 100).toFixed(2)}<input type="number" min={0.01} max={remaining / 100} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Deducted from salary, paid in cash..." /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Record recovery'}</button>
          <button type="button" className="button secondary wide" disabled={busy} onClick={() => void submitWriteOff()}>Write off instead</button>
        </form>
      </div>
    </div>
  );
}
