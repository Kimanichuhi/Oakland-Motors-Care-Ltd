import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DebtRecord, Employee } from '@/lib/types';
import { formatKes, formatDate } from '@/lib/formatting';
import { Plus, AlertTriangle, Edit } from 'lucide-react';
import { RecordDebtForm, DebtRecoveryForm } from './DebtForms';

const STATUS_STYLE: Record<string, string> = {
  OUTSTANDING: 'bg-red-50 text-red-700',
  PARTIALLY_RECOVERED: 'bg-amber-50 text-amber-700',
  RECOVERED: 'bg-emerald-50 text-emerald-700',
  WRITTEN_OFF: 'bg-slate-100 text-slate-600',
};

function EditDebtForm({ debt, onClose, onSaved }: { debt: DebtRecord; onClose: () => void; onSaved: (m: string) => void }) {
  const [itemDescription, setItemDescription] = useState(debt.item_description);
  const [amount, setAmount] = useState((debt.amount_minor / 100).toString());
  const [notes, setNotes] = useState(debt.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amountMinor = Math.round((parseFloat(amount) || 0) * 100);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('update_debt_record', {
      p_debt_id: debt.id, p_item_description: itemDescription, p_amount_minor: amountMinor, p_notes: notes || null,
      p_responsible_employee_id: debt.responsible_employee_id, p_responsible_name: debt.responsible_name,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    onSaved('Debt record updated.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">{debt.responsible_name}</p><h2>Edit debt</h2></div></div>
        <form onSubmit={submit} className="modal-form">
          <label>What caused this debt<textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} style={{ minHeight: 60 }} required /></label>
          <label>Amount (KES){debt.amount_recovered_minor > 0 && <span className="optional"> Locked — a recovery has been recorded</span>}
            <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={debt.amount_recovered_minor > 0} required />
          </label>
          <label>Notes <span className="optional">Optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 46 }} /></label>
          {error && <div className="form-error">{error}</div>}
          <div className="action-buttons">
            <button className="button primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DebtRegisterPage({ can, onNotice }: { can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [recoveryDebt, setRecoveryDebt] = useState<DebtRecord | null>(null);
  const [editDebt, setEditDebt] = useState<DebtRecord | null>(null);

  function refresh() { setRefreshKey((k) => k + 1); }

  useEffect(() => {
    supabase.from('employees').select('*').eq('active', true).order('full_name').then(({ data }) => setEmployees((data ?? []) as Employee[]));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase.from('debt_records').select('*').order('incurred_date', { ascending: false }).order('created_at', { ascending: false });
      if (typeFilter !== 'ALL') q = q.eq('debt_type', typeFilter);
      if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
      const { data } = await q.limit(300);
      setDebts((data ?? []) as DebtRecord[]);
      setLoading(false);
    })();
  }, [typeFilter, statusFilter, refreshKey]);

  const totalOutstanding = debts.filter((d) => d.status !== 'WRITTEN_OFF').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0);
  const openCount = debts.filter((d) => d.status === 'OUTSTANDING' || d.status === 'PARTIALLY_RECOVERED').length;

  function onNoticeAndRefresh(m: string) { onNotice(m); refresh(); }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Accountability</p><h1>Debt Register</h1><p className="muted">Every debt the business is owed — by a customer or by a staff member — with who&apos;s responsible and why.</p></div>
      {can('debt.manage') && <div className="heading-actions"><button className="button primary" onClick={() => setShowForm(true)}><Plus size={16} /> Record debt</button></div>}
    </div>
    <div className="metric-grid" style={{ marginBottom: 20 }}>
      <div className="metric-card"><div className="metric-icon red"><AlertTriangle size={18} /></div><div className="metric-copy"><span>Total Outstanding</span><strong>{formatKes(totalOutstanding)}</strong><small>{openCount} open debt{openCount === 1 ? '' : 's'}</small></div></div>
      <div className="metric-card"><div className="metric-copy"><span>Customer debt</span><strong>{formatKes(debts.filter((d) => d.debt_type === 'CUSTOMER' && d.status !== 'WRITTEN_OFF').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0))}</strong></div></div>
      <div className="metric-card"><div className="metric-copy"><span>Staff liability</span><strong>{formatKes(debts.filter((d) => d.debt_type === 'STAFF' && d.status !== 'WRITTEN_OFF').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0))}</strong></div></div>
      <div className="metric-card"><div className="metric-copy"><span>Recovered (this view)</span><strong>{formatKes(debts.reduce((s, d) => s + d.amount_recovered_minor, 0))}</strong></div></div>
    </div>
    <div className="filter-bar">
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="ALL">All types</option><option value="CUSTOMER">Customer debt</option><option value="STAFF">Staff liability</option></select>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="ALL">All statuses</option><option value="OUTSTANDING">Outstanding</option><option value="PARTIALLY_RECOVERED">Partially recovered</option><option value="RECOVERED">Recovered</option><option value="WRITTEN_OFF">Written off</option>
      </select>
    </div>
    {loading ? <div className="empty"><strong>Loading...</strong></div> : debts.length === 0 ? <div className="empty"><AlertTriangle size={20} /><strong>No debts recorded</strong><span>Nothing owed matches this filter.</span></div> : (
      <div className="report-table-wrap"><table className="report-table"><thead><tr>
        <th>Date</th><th>Type</th><th>Responsible</th><th>What</th><th>Amount</th><th>Balance</th><th>Status</th><th />
      </tr></thead><tbody>{debts.map((d) => <tr key={d.id} className="clickable" onClick={() => { if (d.status === 'OUTSTANDING' || d.status === 'PARTIALLY_RECOVERED') setRecoveryDebt(d); }}>
        <td>{formatDate(d.incurred_date)}</td>
        <td><span className={`status ${d.debt_type === 'STAFF' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{d.debt_type}</span></td>
        <td><strong>{d.responsible_name}</strong></td>
        <td>{d.item_description}</td>
        <td>{formatKes(d.amount_minor)}</td>
        <td style={{ fontWeight: 800, color: d.amount_minor - d.amount_recovered_minor > 0 ? '#a4493d' : undefined }}>{formatKes(d.amount_minor - d.amount_recovered_minor)}</td>
        <td><span className={`status ${STATUS_STYLE[d.status] ?? ''}`}>{d.status.replaceAll('_', ' ')}</span></td>
        <td>{can('debt.manage') && (d.status === 'OUTSTANDING' || d.status === 'PARTIALLY_RECOVERED') && <button className="close-button" style={{ width: 28, height: 28 }} title="Edit" onClick={(e) => { e.stopPropagation(); setEditDebt(d); }}><Edit size={13} /></button>}</td>
      </tr>)}</tbody></table></div>
    )}
    {showForm && <RecordDebtForm employees={employees} onClose={() => setShowForm(false)} onSaved={onNoticeAndRefresh} />}
    {recoveryDebt && <DebtRecoveryForm debt={recoveryDebt} onClose={() => setRecoveryDebt(null)} onSaved={onNoticeAndRefresh} />}
    {editDebt && <EditDebtForm debt={editDebt} onClose={() => setEditDebt(null)} onSaved={onNoticeAndRefresh} />}
  </>;
}
