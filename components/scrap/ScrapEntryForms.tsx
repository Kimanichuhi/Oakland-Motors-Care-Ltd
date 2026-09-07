import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapItem, ScrapPurchase, ScrapExpense, CashTransaction, ScrapCurrentStockRow } from '@/lib/types';
import { formatKes, formatDate, displayToMinor } from '@/lib/formatting';
import { SCRAP_EXPENSE_CATEGORIES, byScrapTypeOrder } from '@/lib/constants';
import { X, Plus, AlertTriangle, Banknote, Wallet, Package, CircleDollarSign } from 'lucide-react';

type EntrySavedHandler = (message: string, resolvedDate: string) => void;

function InsufficientCashNotice({ message, onForce, showForce }: { message: string; onForce: () => void; showForce: boolean }) {
  return (
    <div className="form-error">
      <AlertTriangle size={14} /> {message.replace('INSUFFICIENT_CASH: ', '')}
      {showForce && <div style={{ marginTop: 8 }}><button type="button" className="button secondary small" onClick={onForce}>Record anyway (flag as discrepancy)</button></div>}
    </div>
  );
}

type ExpenseRow = { id: number; type: string; amountMinor: number };
type PurchaseOp = { kind: 'purchase'; key: string; item: ScrapItem; weight: number };
type ExpenseOp = { kind: 'expense'; key: string; row: ExpenseRow };
type CashOp = { kind: 'cash'; key: 'cash'; amountMinor: number };
type Op = CashOp | PurchaseOp | ExpenseOp;

export function ScrapPurchaseForm({ resolvedDate, changeInDays, onClose, onSaved, can, stock }: {
  resolvedDate: string; changeInDays: number; onClose: () => void; onSaved: EntrySavedHandler; can: (p: string) => boolean; stock: ScrapCurrentStockRow[];
}) {
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [date, setDate] = useState(resolvedDate);
  const [manualOverride, setManualOverride] = useState(false);
  const [kgs, setKgs] = useState<Record<string, string>>({});

  const [previousDayCash, setPreviousDayCash] = useState<number | null>(null);
  const [cashAdded, setCashAdded] = useState('');

  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [nextExpenseId, setNextExpenseId] = useState(1);
  const [expenseType, setExpenseType] = useState<string>(SCRAP_EXPENSE_CATEGORIES[0]);
  const [expenseCustomType, setExpenseCustomType] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingForce, setPendingForce] = useState<{ op: Op; message: string } | null>(null);

  useEffect(() => { supabase.from('scrap_items').select('*').eq('active', true).order('name').then(({ data }) => setItems(((data ?? []) as ScrapItem[]).sort(byScrapTypeOrder))); }, []);

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

  const stockByItem = new Map(stock.map((s) => [s.scrap_item_id, s.current_quantity]));
  const kgFor = (id: string) => parseFloat(kgs[id] ?? '') || 0;
  const amountFor = (item: ScrapItem) => item.current_rate_minor ? Math.round(kgFor(item.id) * item.current_rate_minor) : 0;
  const totalKg = items.reduce((s, i) => s + kgFor(i.id), 0);
  const totalPurchases = items.reduce((s, i) => s + amountFor(i), 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + r.amountMinor, 0);
  const cashAddedMinor = displayToMinor(parseFloat(cashAdded) || 0);
  const cashAvailable = (previousDayCash ?? 0) + cashAddedMinor;
  const closingCash = cashAvailable - totalPurchases - totalExpenses;

  const resolvedExpenseType = expenseType === 'Other' && expenseCustomType.trim() ? expenseCustomType.trim() : expenseType;
  function addExpenseRow() {
    const amountMinor = displayToMinor(parseFloat(expenseAmount) || 0);
    if (amountMinor <= 0) return;
    setExpenseRows((prev) => [...prev, { id: nextExpenseId, type: resolvedExpenseType, amountMinor }]);
    setNextExpenseId((n) => n + 1);
    setExpenseAmount('');
  }
  function removeExpenseRow(id: number) { setExpenseRows((prev) => prev.filter((r) => r.id !== id)); }

  function buildOps(): Op[] {
    const ops: Op[] = [];
    if (cashAddedMinor > 0) ops.push({ kind: 'cash', key: 'cash', amountMinor: cashAddedMinor });
    for (const item of items) { const weight = kgFor(item.id); if (weight > 0) ops.push({ kind: 'purchase', key: `p-${item.id}`, item, weight }); }
    for (const row of expenseRows) ops.push({ kind: 'expense', key: `e-${row.id}`, row });
    return ops;
  }

  async function submit(forceKey?: string) {
    setError('');
    const ops = buildOps().filter((op) => !savedKeys.has(op.key));
    if (ops.length === 0) { if (savedKeys.size === 0) setError('Add at least one cash, purchase or expense entry before saving.'); return; }

    setBusy(true);
    let newlySaved = 0;
    let lastDate = resolvedDate;
    for (const op of ops) {
      try {
        if (op.kind === 'cash') {
          const { data, error: rpcError } = await supabase.rpc('scrap_add_cash', { p_date: date, p_change_in_days: manualOverride ? 0 : changeInDays, p_amount_minor: op.amountMinor });
          if (rpcError) throw rpcError;
          lastDate = (data as CashTransaction).date;
        } else if (op.kind === 'purchase') {
          if (op.item.current_rate_minor == null) { setError(`Set a rate for ${op.item.name} before recording a purchase.`); setBusy(false); return; }
          const { data, error: rpcError } = await supabase.rpc('scrap_record_purchase', {
            p_date: date, p_change_in_days: manualOverride ? 0 : changeInDays, p_scrap_item_id: op.item.id,
            p_weight_kg: op.weight, p_supplier: null, p_notes: null, p_force: op.key === forceKey,
          });
          if (rpcError) throw rpcError;
          lastDate = (data as ScrapPurchase).date;
        } else {
          const { data, error: rpcError } = await supabase.rpc('scrap_record_expense', {
            p_date: date, p_change_in_days: manualOverride ? 0 : changeInDays, p_expense_type: op.row.type,
            p_description: null, p_amount_minor: op.row.amountMinor, p_notes: null, p_force: op.key === forceKey,
          });
          if (rpcError) throw rpcError;
          lastDate = (data as ScrapExpense).date;
        }
        newlySaved += 1;
        setSavedKeys((prev) => new Set(prev).add(op.key));
      } catch (err) {
        setBusy(false);
        const message = err instanceof Error ? err.message : 'Unable to save this entry.';
        if (message.startsWith('INSUFFICIENT_CASH')) {
          const savedSoFar = savedKeys.size + newlySaved;
          if (can('scrap.manage')) { setPendingForce({ op, message }); return; }
          setError(`⚠️ Insufficient recorded cash.${savedSoFar > 0 ? ` ${savedSoFar} entr${savedSoFar === 1 ? 'y' : 'ies'} already saved.` : ''} Ask management to review.`);
          return;
        }
        setError(message);
        return;
      }
    }
    setBusy(false);
    const total = savedKeys.size + newlySaved;
    onSaved(`Recorded ${total} entr${total === 1 ? 'y' : 'ies'} for ${formatDate(lastDate)}.`, lastDate);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(860px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Add Purchase</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="modal-form">
          <div className="form-row" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <label>Date<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setDate(e.target.value); setManualOverride(e.target.value !== resolvedDate); }} required /></label>
            <label>Previous day cash<input value={previousDayCash === null ? '…' : formatKes(previousDayCash)} disabled /></label>
            <label>Cash added<input type="number" min={0} step="0.01" value={cashAdded} onChange={(e) => setCashAdded(e.target.value)} placeholder="0" /></label>
            <label>Cash available<input value={formatKes(cashAvailable)} disabled /></label>
          </div>

          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>Scrap Type</th><th className="numeric">Rate / Kg</th><th className="numeric">Kgs Today</th><th className="numeric">Purchase Amount</th><th className="numeric">Stock After Today&apos;s KG</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const saved = savedKeys.has(`p-${item.id}`);
                  const stockAfter = (stockByItem.get(item.id) ?? 0) + kgFor(item.id);
                  return <tr key={item.id}>
                    <td>{item.name}{saved && <span className="table-subtext">Saved</span>}</td>
                    <td className="numeric">{item.current_rate_minor == null ? 'Not set' : formatKes(item.current_rate_minor)}</td>
                    <td className="numeric"><input type="number" min={0} step="0.01" value={kgs[item.id] ?? ''} disabled={saved || item.current_rate_minor == null} onChange={(e) => setKgs((prev) => ({ ...prev, [item.id]: e.target.value }))} style={{ width: 90, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} /></td>
                    <td className="numeric">{formatKes(amountFor(item))}</td>
                    <td className="numeric">{stockAfter}</td>
                  </tr>;
                })}
              </tbody>
              <tfoot><tr><td><strong>TOTAL</strong></td><td /><td className="numeric"><strong>{totalKg}</strong></td><td className="numeric"><strong>{formatKes(totalPurchases)}</strong></td><td /></tr></tfoot>
            </table>
          </div>

          <section className="panel" style={{ marginTop: 4 }}>
            <div className="panel-heading"><div><p className="eyebrow">Today</p><h3>Expenses</h3></div></div>
            <div className="form-row" style={{ gridTemplateColumns: expenseType === 'Other' ? '1fr 1fr 140px auto' : '1fr 140px auto', alignItems: 'end' }}>
              <label>Type<select value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>{SCRAP_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              {expenseType === 'Other' && <label>Specify<input value={expenseCustomType} onChange={(e) => setExpenseCustomType(e.target.value)} /></label>}
              <label>Amount (KES)<input type="number" min={0} step="0.01" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} /></label>
              <button type="button" className="button secondary" disabled={!(parseFloat(expenseAmount) > 0) || (expenseType === 'Other' && !expenseCustomType.trim())} onClick={addExpenseRow}><Plus size={15} /> Add</button>
            </div>
            {expenseRows.length > 0 && <div className="data-table" style={{ marginTop: 12 }}>{expenseRows.map((r) => {
              const saved = savedKeys.has(`e-${r.id}`);
              return <div className="table-row" key={r.id}>
                <div className="job-icon"><Banknote size={16} /></div>
                <div><strong>{r.type}</strong>{saved && <span className="table-subtext">Saved</span>}</div>
                <span className="table-muted">{formatKes(r.amountMinor)}</span>
                {!saved && <button type="button" className="close-button" style={{ width: 28, height: 28 }} onClick={() => removeExpenseRow(r.id)}><X size={14} /></button>}
              </div>;
            })}</div>}
            {expenseRows.length > 0 && <div className="total-row"><strong>Total expenses</strong><span>{formatKes(totalExpenses)}</span></div>}
          </section>

          <section className="panel" style={{ marginTop: 4 }}>
            <div className="panel-heading"><div><p className="eyebrow">Automated</p><h3>Daily Cash Calculation</h3></div></div>
            <div className="detail-info-grid">
              <div className="info-card"><Wallet size={16} /><div><span>Cash available</span><strong>{formatKes(cashAvailable)}</strong></div></div>
              <div className="info-card"><Package size={16} /><div><span>Total scrap purchases</span><strong>-{formatKes(totalPurchases)}</strong></div></div>
              <div className="info-card"><Banknote size={16} /><div><span>Total expenses</span><strong>-{formatKes(totalExpenses)}</strong></div></div>
              <div className="info-card"><CircleDollarSign size={16} /><div><span>Closing cash</span><strong style={{ color: closingCash < 0 ? '#a4493d' : undefined }}>{formatKes(closingCash)}</strong></div></div>
            </div>
          </section>

          {pendingForce && <InsufficientCashNotice message={pendingForce.message} showForce onForce={() => { const op = pendingForce.op; setPendingForce(null); void submit(op.key); }} />}
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>{savedKeys.size > 0 ? 'Done' : 'Cancel'}</button>
            <button className="button primary wide" disabled={busy} type="submit"><Plus size={15} /> {busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

