import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapExpense, CashTransaction } from '@/lib/types';
import type { PurchaseWithItem } from './ScrapDailyDetail';
import { formatKes, displayToMinor } from '@/lib/formatting';
import { SCRAP_EXPENSE_CATEGORIES } from '@/lib/constants';
import { X, Plus, Pencil, AlertTriangle, Banknote, Wallet, Package, CircleDollarSign } from 'lucide-react';

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
  return 'Unable to save this entry.';
}

type PurchaseEdit = { weight: string; rate: string; amount: string; amountTouched: boolean; supplier: string; notes: string };
type ExpenseEdit = { category: string; customCategory: string; amount: string; description: string; notes: string };
type CashEdit = { amount: string; reason: string; reference: string; notes: string };
type NewExpenseRow = { id: number; type: string; amountMinor: number };

type NewOp = { kind: 'new-expense'; key: string; row: NewExpenseRow };

export default function EditDailyRecordDialog({ date, can, isAdmin, purchases, expenses, cashTx, onClose, onSaved }: {
  date: string; can: (p: string) => boolean; isAdmin: boolean; purchases: PurchaseWithItem[]; expenses: ScrapExpense[]; cashTx: CashTransaction[];
  onClose: () => void; onSaved: (m: string) => void;
}) {
  const [previousDayCash, setPreviousDayCash] = useState<number | null>(null);
  const [purchaseEdits, setPurchaseEdits] = useState<Record<string, PurchaseEdit>>({});
  const [expenseEdits, setExpenseEdits] = useState<Record<string, ExpenseEdit>>({});
  const [cashEdits, setCashEdits] = useState<Record<string, CashEdit>>({});

  const [newCashAdded, setNewCashAdded] = useState('');
  const [newExpenseRows, setNewExpenseRows] = useState<NewExpenseRow[]>([]);
  const [nextExpenseId, setNextExpenseId] = useState(1);
  const [expenseType, setExpenseType] = useState<string>(SCRAP_EXPENSE_CATEGORIES[0]);
  const [expenseCustomType, setExpenseCustomType] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  const [savedNewKeys, setSavedNewKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [pendingForce, setPendingForce] = useState<{ op: NewOp; message: string } | null>(null);

  const [addCashBusy, setAddCashBusy] = useState(false);
  const [addCashError, setAddCashError] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: existing } = await supabase.from('scrap_cash_summary').select('opening_cash_minor').eq('date', date).maybeSingle();
      if (!mounted) return;
      if (existing) { setPreviousDayCash((existing as { opening_cash_minor: number }).opening_cash_minor); return; }
      const { data: prev } = await supabase.from('scrap_cash_summary').select('closing_cash_minor').lt('date', date).order('date', { ascending: false }).limit(1).maybeSingle();
      if (!mounted) return;
      if (prev) { setPreviousDayCash((prev as { closing_cash_minor: number }).closing_cash_minor); return; }
      const { data: settings } = await supabase.from('scrap_settings').select('opening_cash_minor').limit(1).maybeSingle();
      if (!mounted) return;
      setPreviousDayCash((settings as { opening_cash_minor: number | null } | null)?.opening_cash_minor ?? 0);
    })();
    return () => { mounted = false; };
  }, [date]);

  useEffect(() => {
    const edits: Record<string, PurchaseEdit> = {};
    for (const p of purchases) edits[p.id] = { weight: String(p.quantity_purchased), rate: (p.rate_used_minor / 100).toString(), amount: (p.purchase_amount_minor / 100).toString(), amountTouched: false, supplier: p.supplier ?? '', notes: p.notes ?? '' };
    setPurchaseEdits(edits);
  }, [purchases]);

  useEffect(() => {
    const edits: Record<string, ExpenseEdit> = {};
    for (const e of expenses) {
      const known = (SCRAP_EXPENSE_CATEGORIES as readonly string[]).includes(e.category);
      edits[e.id] = { category: known ? e.category : 'Other', customCategory: known ? '' : e.category, amount: (e.amount_minor / 100).toString(), description: e.description ?? '', notes: e.notes ?? '' };
    }
    setExpenseEdits(edits);
  }, [expenses]);

  useEffect(() => {
    const edits: Record<string, CashEdit> = {};
    for (const t of cashTx) edits[t.id] = { amount: (t.amount_minor / 100).toString(), reason: t.reason ?? '', reference: t.reference ?? '', notes: t.notes ?? '' };
    setCashEdits(edits);
  }, [cashTx]);

  function updatePurchaseEdit(id: string, patch: Partial<PurchaseEdit>) {
    setPurchaseEdits((prev) => {
      const current = prev[id];
      const next = { ...current, ...patch };
      if (!next.amountTouched && (patch.weight !== undefined || patch.rate !== undefined)) {
        const w = parseFloat(next.weight) || 0; const r = parseFloat(next.rate) || 0;
        next.amount = (w * r).toFixed(2);
      }
      return { ...prev, [id]: next };
    });
  }

  const resolvedNewExpenseType = expenseType === 'Other' && expenseCustomType.trim() ? expenseCustomType.trim() : expenseType;
  function addNewExpenseRow() {
    const amountMinor = displayToMinor(parseFloat(expenseAmount) || 0);
    if (amountMinor <= 0) return;
    setNewExpenseRows((prev) => [...prev, { id: nextExpenseId, type: resolvedNewExpenseType, amountMinor }]);
    setNextExpenseId((n) => n + 1);
    setExpenseAmount('');
  }
  function removeNewExpenseRow(id: number) { setNewExpenseRows((prev) => prev.filter((r) => r.id !== id)); }

  function buildNewOps(): NewOp[] {
    return newExpenseRows.map((row) => ({ kind: 'new-expense' as const, key: `ne-${row.id}`, row }));
  }

  async function addCash() {
    setAddCashError('');
    const amountMinor = displayToMinor(parseFloat(newCashAdded) || 0);
    if (amountMinor <= 0) { setAddCashError('Enter an amount greater than zero.'); return; }
    setAddCashBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('scrap_add_cash', { p_date: date, p_change_in_days: 0, p_amount_minor: amountMinor });
      if (rpcError) throw rpcError;
      onSaved('Cash added.');
      onClose();
    } catch (err) {
      setAddCashBusy(false);
      setAddCashError(errorMessage(err));
    }
  }

  // Live totals for the summary panel, reflecting the current edit state —
  // existing entries at their (possibly edited) values, plus anything staged
  // to be added but not yet saved.
  const totalPurchasesMinor = purchases.reduce((s, p) => s + displayToMinor(parseFloat(purchaseEdits[p.id]?.amount ?? '0') || 0), 0);
  const totalExistingCashMinor = cashTx.reduce((s, t) => s + displayToMinor(parseFloat(cashEdits[t.id]?.amount ?? '0') || 0), 0);
  const newCashAddedMinor = displayToMinor(parseFloat(newCashAdded) || 0);
  const cashAddedMinor = totalExistingCashMinor + newCashAddedMinor;
  const cashAvailableMinor = (previousDayCash ?? 0) + cashAddedMinor;
  const totalExistingExpensesMinor = expenses.reduce((s, e) => s + displayToMinor(parseFloat(expenseEdits[e.id]?.amount ?? '0') || 0), 0);
  const totalNewExpensesMinor = newExpenseRows.reduce((s, r) => s + r.amountMinor, 0);
  const totalExpensesMinor = totalExistingExpensesMinor + totalNewExpensesMinor;
  const closingCashMinor = cashAvailableMinor - totalPurchasesMinor - totalExpensesMinor;

  async function save(forceKey?: string) {
    setError('');
    setBusy(true);
    let editedCount = 0;
    let createdCount = 0;
    const failures: string[] = [];

    if (!forceKey) {
      // Edits never block on insufficient cash (a correction made by someone
      // who already has scrap.manage) so they always run first, in one pass.
      for (const p of purchases) {
        const edit = purchaseEdits[p.id];
        if (!edit) continue;
        const weightChanged = parseFloat(edit.weight) !== p.quantity_purchased;
        const rateChanged = displayToMinor(parseFloat(edit.rate) || 0) !== p.rate_used_minor;
        const amountChanged = displayToMinor(parseFloat(edit.amount) || 0) !== p.purchase_amount_minor;
        const supplierChanged = (edit.supplier || null) !== p.supplier;
        const notesChanged = (edit.notes || null) !== p.notes;
        if (!weightChanged && !rateChanged && !amountChanged && !supplierChanged && !notesChanged) continue;
        setProgress(`Saving ${p.scrap_items?.name ?? 'purchase'}…`);
        try {
          const { error: rpcError } = await supabase.rpc('scrap_edit_purchase', {
            p_id: p.id, p_weight_kg: parseFloat(edit.weight), p_rate_used_minor: displayToMinor(parseFloat(edit.rate) || 0),
            p_purchase_amount_minor: displayToMinor(parseFloat(edit.amount) || 0), p_supplier: edit.supplier || null, p_notes: edit.notes || null,
          });
          if (rpcError) throw rpcError;
          editedCount++;
        } catch (err) { failures.push(`${p.scrap_items?.name ?? 'Purchase'}: ${errorMessage(err)}`); }
      }

      for (const e of expenses) {
        const edit = expenseEdits[e.id];
        if (!edit) continue;
        const resolvedCategory = edit.category === 'Other' && edit.customCategory.trim() ? edit.customCategory.trim() : edit.category;
        const amountMinor = displayToMinor(parseFloat(edit.amount) || 0);
        const categoryChanged = resolvedCategory !== e.category;
        const amountChanged = amountMinor !== e.amount_minor;
        const descriptionChanged = (edit.description || null) !== e.description;
        const notesChanged = (edit.notes || null) !== e.notes;
        if (!categoryChanged && !amountChanged && !descriptionChanged && !notesChanged) continue;
        setProgress(`Saving ${e.category} expense…`);
        try {
          const { error: rpcError } = await supabase.rpc('scrap_edit_expense', {
            p_id: e.id, p_category: resolvedCategory, p_amount_minor: amountMinor, p_description: edit.description || null, p_notes: edit.notes || null,
          });
          if (rpcError) throw rpcError;
          editedCount++;
        } catch (err) { failures.push(`${e.category} expense: ${errorMessage(err)}`); }
      }

      if (isAdmin) {
        for (const t of cashTx) {
          const edit = cashEdits[t.id];
          if (!edit) continue;
          const amountMinor = displayToMinor(parseFloat(edit.amount) || 0);
          const amountChanged = amountMinor !== t.amount_minor;
          const reasonChanged = (edit.reason || null) !== t.reason;
          const referenceChanged = (edit.reference || null) !== t.reference;
          const notesChanged = (edit.notes || null) !== t.notes;
          if (!amountChanged && !reasonChanged && !referenceChanged && !notesChanged) continue;
          setProgress(`Saving ${t.transaction_type === 'CASH_ADDED' ? 'cash added' : 'cash adjustment'}…`);
          try {
            const { error: rpcError } = await supabase.rpc('scrap_edit_cash_transaction', {
              p_id: t.id, p_amount_minor: amountMinor, p_reason: edit.reason || null, p_reference: edit.reference || null, p_notes: edit.notes || null,
            });
            if (rpcError) throw rpcError;
            editedCount++;
          } catch (err) { failures.push(`${t.transaction_type === 'CASH_ADDED' ? 'Cash added' : 'Cash adjustment'}: ${errorMessage(err)}`); }
        }
      }
    }

    const newOps = buildNewOps().filter((op) => !savedNewKeys.has(op.key));
    for (const op of newOps) {
      setProgress(`Saving ${op.row.type}…`);
      try {
        const { error: rpcError } = await supabase.rpc('scrap_record_expense', {
          p_date: date, p_change_in_days: 0, p_expense_type: op.row.type, p_description: null, p_amount_minor: op.row.amountMinor, p_notes: null, p_force: op.key === forceKey,
        });
        if (rpcError) throw rpcError;
        createdCount++;
        setSavedNewKeys((prev) => new Set(prev).add(op.key));
      } catch (err) {
        const message = errorMessage(err);
        if (message.startsWith('INSUFFICIENT_CASH')) {
          setBusy(false); setProgress('');
          if (can('scrap.manage')) { setPendingForce({ op, message }); return; }
          setError(`⚠️ Insufficient recorded cash. Ask management to review.`);
          return;
        }
        failures.push(message);
      }
    }

    setBusy(false);
    setProgress('');
    if (failures.length > 0) { setError(failures.join(' · ')); return; }
    const parts = [editedCount > 0 ? `${editedCount} updated` : null, createdCount > 0 ? `${createdCount} added` : null].filter(Boolean);
    onSaved(parts.length > 0 ? `${parts.join(', ')} for this day.` : 'No changes to save.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ width: 'min(920px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Edit Daily Record</h2></div>{!busy && <button className="close-button" onClick={onClose}><X size={18} /></button>}</div>
        <div className="modal-form">

          {purchases.length > 0 && <section className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Existing</p><h3>Purchases</h3></div></div>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead><tr><th>Scrap Type</th><th className="numeric">Weight KG</th><th className="numeric">Rate/kg</th><th className="numeric">Amount</th></tr></thead>
                <tbody>{purchases.map((p) => {
                  const edit = purchaseEdits[p.id];
                  if (!edit) return null;
                  return <tr key={p.id}>
                    <td>{p.scrap_items?.name ?? 'Scrap type'}</td>
                    <td className="numeric"><input type="number" min={0} step="0.01" value={edit.weight} onChange={(e) => updatePurchaseEdit(p.id, { weight: e.target.value })} style={{ width: 90, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} /></td>
                    <td className="numeric"><input type="number" min={0} step="0.01" value={edit.rate} onChange={(e) => updatePurchaseEdit(p.id, { rate: e.target.value })} style={{ width: 80, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} /></td>
                    <td className="numeric"><input type="number" min={0} step="0.01" value={edit.amount} onChange={(e) => updatePurchaseEdit(p.id, { amount: e.target.value, amountTouched: true })} style={{ width: 100, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} /></td>
                  </tr>;
                })}</tbody>
                <tfoot><tr><td><strong>TOTAL</strong></td><td /><td /><td className="numeric"><strong>{formatKes(totalPurchasesMinor)}</strong></td></tr></tfoot>
              </table>
            </div>
          </section>}

          <section className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Stream B</p><h3>Cash control</h3></div></div>
            <div className="form-row" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              <label>Previous day cash<input value={previousDayCash === null ? '…' : formatKes(previousDayCash)} disabled /></label>
              <label>Cash added<input value={formatKes(cashAddedMinor)} disabled /></label>
              <label>Cash available<input value={formatKes(cashAvailableMinor)} disabled /></label>
            </div>
            {cashTx.length > 0 && <div style={{ marginTop: 10 }}>{cashTx.map((t) => {
              const edit = cashEdits[t.id];
              if (!edit) return null;
              return <div className="form-row" key={t.id} style={{ gridTemplateColumns: '1fr 120px', alignItems: 'center', marginBottom: 8 }}>
                <span>{t.transaction_type === 'CASH_ADDED' ? 'Cash added' : 'Adjustment'}{t.reason ? ` — ${t.reason}` : ''}</span>
                {isAdmin
                  ? <input type="number" step="0.01" value={edit.amount} onChange={(e) => setCashEdits((prev) => ({ ...prev, [t.id]: { ...prev[t.id], amount: e.target.value } }))} style={{ border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} />
                  : <span className="table-muted" style={{ textAlign: 'right' }}>{formatKes(t.amount_minor)}</span>}
              </div>;
            })}</div>}
            {isAdmin ? <>
              <div className="form-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', marginTop: 10 }}>
                <label>Add cash <span className="optional">Admin only</span><input type="number" min={0} step="0.01" value={newCashAdded} onChange={(e) => setNewCashAdded(e.target.value)} placeholder="0" disabled={addCashBusy} /></label>
                <button type="button" className="button secondary" disabled={addCashBusy || !(parseFloat(newCashAdded) > 0)} onClick={() => void addCash()}><Plus size={15} /> {addCashBusy ? 'Adding…' : 'Add cash'}</button>
              </div>
              {addCashError && <div className="form-error" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {addCashError}</div>}
            </> : <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Only an administrator can edit or add cash entries.</p>}
          </section>

          <section className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Today</p><h3>Expenses</h3></div></div>
            {expenses.length > 0 && <div style={{ marginBottom: 10 }}>{expenses.map((e) => {
              const edit = expenseEdits[e.id];
              if (!edit) return null;
              return <div key={e.id} style={{ marginBottom: 8 }}>
                <div className="expense-entry-row">
                  <label>Type<select value={edit.category} onChange={(ev) => setExpenseEdits((prev) => ({ ...prev, [e.id]: { ...prev[e.id], category: ev.target.value } }))}>{SCRAP_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                  {edit.category === 'Other' && <label>Specify<input value={edit.customCategory} onChange={(ev) => setExpenseEdits((prev) => ({ ...prev, [e.id]: { ...prev[e.id], customCategory: ev.target.value } }))} placeholder="Name this expense" /></label>}
                  <label className="expense-entry-amount">Amount (KES)<input type="number" min={0} step="0.01" value={edit.amount} onChange={(ev) => setExpenseEdits((prev) => ({ ...prev, [e.id]: { ...prev[e.id], amount: ev.target.value } }))} /></label>
                </div>
              </div>;
            })}</div>}

            <div className="expense-entry-row">
              <label>Type<select value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>{SCRAP_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              {expenseType === 'Other' && <label>Specify<input value={expenseCustomType} onChange={(e) => setExpenseCustomType(e.target.value)} placeholder="Name this expense" autoFocus /></label>}
              <label className="expense-entry-amount">Amount (KES)<input type="number" min={0} step="0.01" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} /></label>
              <button type="button" className="button secondary" disabled={!(parseFloat(expenseAmount) > 0) || (expenseType === 'Other' && !expenseCustomType.trim())} onClick={addNewExpenseRow}><Plus size={15} /> Add</button>
            </div>
            {newExpenseRows.length > 0 && <div className="data-table" style={{ marginTop: 12 }}>{newExpenseRows.map((r) => {
              const saved = savedNewKeys.has(`ne-${r.id}`);
              return <div className="table-row" key={r.id}>
                <div className="job-icon"><Banknote size={16} /></div>
                <div><strong>{r.type}</strong>{saved && <span className="table-subtext">Saved</span>}</div>
                <span className="table-muted">{formatKes(r.amountMinor)}</span>
                {!saved && <button type="button" className="close-button" style={{ width: 28, height: 28 }} onClick={() => removeNewExpenseRow(r.id)}><X size={14} /></button>}
              </div>;
            })}</div>}
            <div className="total-row"><strong>Total expenses</strong><span>{formatKes(totalExpensesMinor)}</span></div>
          </section>

          <section className="panel" style={{ marginTop: 4 }}>
            <div className="panel-heading"><div><p className="eyebrow">Automated</p><h3>Daily Cash Calculation</h3></div></div>
            <div className="detail-info-grid">
              <div className="info-card"><Wallet size={16} /><div><span>Cash available</span><strong>{formatKes(cashAvailableMinor)}</strong></div></div>
              <div className="info-card"><Package size={16} /><div><span>Total scrap purchases</span><strong>-{formatKes(totalPurchasesMinor)}</strong></div></div>
              <div className="info-card"><Banknote size={16} /><div><span>Total expenses</span><strong>-{formatKes(totalExpensesMinor)}</strong></div></div>
              <div className="info-card"><CircleDollarSign size={16} /><div><span>Closing cash</span><strong style={{ color: closingCashMinor < 0 ? '#a4493d' : undefined }}>{formatKes(closingCashMinor)}</strong></div></div>
            </div>
          </section>

          {pendingForce && <div className="form-error">
            <AlertTriangle size={14} /> {pendingForce.message.replace('INSUFFICIENT_CASH: ', '')}
            <div style={{ marginTop: 8 }}><button type="button" className="button secondary small" onClick={() => { const op = pendingForce.op; setPendingForce(null); void save(op.key); }}>Record anyway (flag as discrepancy)</button></div>
          </div>}
          {progress && <p className="muted">{progress}</p>}
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="button primary wide" type="button" disabled={busy} onClick={() => void save()}><Pencil size={15} /> {busy ? 'Saving…' : 'Save all changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
