import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapItem, ScrapPurchase, ScrapExpense, CashTransaction } from '@/lib/types';
import { formatKes, formatDate, displayToMinor } from '@/lib/formatting';
import { SCRAP_EXPENSE_CATEGORIES } from '@/lib/constants';
import { X, Plus, AlertTriangle, Banknote } from 'lucide-react';

type EntrySavedHandler = (message: string, resolvedDate: string) => void;

function InsufficientCashNotice({ message, onForce, showForce }: { message: string; onForce: () => void; showForce: boolean }) {
  return (
    <div className="form-error">
      <AlertTriangle size={14} /> {message.replace('INSUFFICIENT_CASH: ', '')}
      {showForce && <div style={{ marginTop: 8 }}><button type="button" className="button secondary small" onClick={onForce}>Record anyway (flag as discrepancy)</button></div>}
    </div>
  );
}

export function ScrapPurchaseForm({ resolvedDate, changeInDays, onClose, onSaved, can }: {
  resolvedDate: string; changeInDays: number; onClose: () => void; onSaved: EntrySavedHandler; can: (p: string) => boolean;
}) {
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [date, setDate] = useState(resolvedDate);
  const [manualOverride, setManualOverride] = useState(false);
  const [scrapItemId, setScrapItemId] = useState('');
  const [weight, setWeight] = useState('');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [insufficientMsg, setInsufficientMsg] = useState<string | null>(null);

  useEffect(() => { supabase.from('scrap_items').select('*').eq('active', true).order('name').then(({ data }) => setItems((data ?? []) as ScrapItem[])); }, []);

  const selected = items.find((i) => i.id === scrapItemId) ?? null;
  const weightNum = parseFloat(weight) || 0;
  const amountMinor = selected?.current_rate_minor ? Math.round(weightNum * selected.current_rate_minor) : 0;

  async function save(force: boolean) {
    setError(''); setInsufficientMsg(null);
    if (!scrapItemId) { setError('Select a scrap type.'); return; }
    if (weightNum <= 0) { setError('Weight (KG) must be greater than zero.'); return; }
    if (selected?.current_rate_minor == null) { setError(`Set a rate for ${selected?.name} before recording a purchase.`); return; }

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('scrap_record_purchase', {
        p_date: date, p_change_in_days: manualOverride ? 0 : changeInDays, p_scrap_item_id: scrapItemId,
        p_weight_kg: weightNum, p_supplier: supplier || null, p_notes: notes || null, p_force: force,
      });
      if (rpcError) throw rpcError;
      const purchase = data as ScrapPurchase;
      onSaved(`${selected?.name} purchase recorded — ${formatKes(purchase.purchase_amount_minor)}.`, purchase.date);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to record this purchase.';
      if (message.startsWith('INSUFFICIENT_CASH') && can('scrap.manage')) setInsufficientMsg(message);
      else if (message.startsWith('INSUFFICIENT_CASH')) setError('⚠️ Insufficient recorded cash for this purchase. Ask management to review.');
      else setError(message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Add Purchase</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); void save(false); }} className="modal-form">
          <label>Date<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setDate(e.target.value); setManualOverride(e.target.value !== resolvedDate); }} required /></label>
          <label>Scrap type<select value={scrapItemId} onChange={(e) => setScrapItemId(e.target.value)} required>
            <option value="">Select scrap type...</option>
            {items.map((i) => <option key={i.id} value={i.id} disabled={i.current_rate_minor == null}>{i.name}{i.current_rate_minor == null ? ' (rate not set)' : ''}</option>)}
          </select></label>
          <div className="form-row">
            <label>Weight (KG)<input type="number" min={0} step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} required /></label>
            <label>Rate/kg<input value={selected?.current_rate_minor != null ? formatKes(selected.current_rate_minor) : '—'} disabled /></label>
          </div>
          <div className="info-card"><div><span>Purchase amount</span><strong>{formatKes(amountMinor)}</strong></div></div>
          <label>Supplier / source <span className="optional">Optional</span><input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
          <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {insufficientMsg && <InsufficientCashNotice message={insufficientMsg} showForce onForce={() => void save(true)} />}
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} type="submit"><Plus size={15} /> {busy ? 'Saving…' : 'Save Purchase'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ScrapExpenseForm({ resolvedDate, changeInDays, onClose, onSaved, can }: {
  resolvedDate: string; changeInDays: number; onClose: () => void; onSaved: EntrySavedHandler; can: (p: string) => boolean;
}) {
  const [date, setDate] = useState(resolvedDate);
  const [manualOverride, setManualOverride] = useState(false);
  const [expenseType, setExpenseType] = useState<string>(SCRAP_EXPENSE_CATEGORIES[0]);
  const [customType, setCustomType] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [insufficientMsg, setInsufficientMsg] = useState<string | null>(null);

  const resolvedType = expenseType === 'Other' && customType.trim() ? customType.trim() : expenseType;
  const amountMinor = displayToMinor(parseFloat(amount) || 0);

  async function save(force: boolean) {
    setError(''); setInsufficientMsg(null);
    if (amountMinor <= 0) { setError('Amount must be greater than zero.'); return; }

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('scrap_record_expense', {
        p_date: date, p_change_in_days: manualOverride ? 0 : changeInDays, p_expense_type: resolvedType,
        p_description: description || null, p_amount_minor: amountMinor, p_notes: notes || null, p_force: force,
      });
      if (rpcError) throw rpcError;
      const expense = data as ScrapExpense;
      onSaved(`${resolvedType} expense recorded — ${formatKes(expense.amount_minor)}.`, expense.date);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to record this expense.';
      if (message.startsWith('INSUFFICIENT_CASH') && can('scrap.manage')) setInsufficientMsg(message);
      else if (message.startsWith('INSUFFICIENT_CASH')) setError('⚠️ Insufficient recorded cash for this expense. Ask management to review.');
      else setError(message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(460px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Add Expense</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); void save(false); }} className="modal-form">
          <label>Date<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setDate(e.target.value); setManualOverride(e.target.value !== resolvedDate); }} required /></label>
          <label>Expense type<select value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>{SCRAP_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          {expenseType === 'Other' && <label>Specify type<input value={customType} onChange={(e) => setCustomType(e.target.value)} required /></label>}
          <label>Description <span className="optional">Optional</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label>Amount (KES)<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {insufficientMsg && <InsufficientCashNotice message={insufficientMsg} showForce onForce={() => void save(true)} />}
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} type="submit"><Plus size={15} /> {busy ? 'Saving…' : 'Save Expense'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ScrapCashForm({ resolvedDate, changeInDays, onClose, onSaved }: {
  resolvedDate: string; changeInDays: number; onClose: () => void; onSaved: EntrySavedHandler;
}) {
  const [date, setDate] = useState(resolvedDate);
  const [manualOverride, setManualOverride] = useState(false);
  const [amount, setAmount] = useState('');
  const [addedBy, setAddedBy] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amountMinor = displayToMinor(parseFloat(amount) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (amountMinor <= 0) { setError('Amount must be greater than zero.'); return; }

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('scrap_add_cash', {
        p_date: date, p_change_in_days: manualOverride ? 0 : changeInDays, p_amount_minor: amountMinor,
        p_added_by: addedBy || null, p_reason: reason || null, p_reference: reference || null, p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      const tx = data as CashTransaction;
      onSaved(`Cash added — ${formatKes(tx.amount_minor)} on ${formatDate(tx.date)}.`, tx.date);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record this cash addition.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(460px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Add Cash</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit} className="modal-form">
          <label>Date<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setDate(e.target.value); setManualOverride(e.target.value !== resolvedDate); }} required /></label>
          <label>Amount (KES)<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Added by <span className="optional">Optional</span><input value={addedBy} onChange={(e) => setAddedBy(e.target.value)} placeholder="e.g. The Boss" /></label>
          <label>Reason <span className="optional">Optional</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <label>Reference <span className="optional">Optional</span><input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} type="submit"><Banknote size={15} /> {busy ? 'Saving…' : 'Save Cash Added'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
