import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapPurchase, ScrapExpense, CashTransaction, ScrapCashSummary } from '@/lib/types';
import { formatKes, formatKg, formatDate } from '@/lib/formatting';
import { ChevronRight, Printer, Ban, AlertTriangle } from 'lucide-react';

type PurchaseWithItem = ScrapPurchase & { scrap_items: { name: string } | null };

export default function ScrapDailyDetail({ date, can, onBack, onNotice, onRefresh }: {
  date: string; can: (p: string) => boolean; onBack: () => void; onNotice: (m: string) => void; onRefresh: () => void;
}) {
  const [summary, setSummary] = useState<ScrapCashSummary | null>(null);
  const [purchases, setPurchases] = useState<PurchaseWithItem[]>([]);
  const [expenses, setExpenses] = useState<ScrapExpense[]>([]);
  const [cashTx, setCashTx] = useState<CashTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrint, setShowPrint] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: sum }, { data: purch }, { data: exp }, { data: cash }] = await Promise.all([
      supabase.from('scrap_cash_summary').select('*').eq('date', date).maybeSingle(),
      supabase.from('scrap_purchases').select('*, scrap_items(name)').eq('date', date).eq('status', 'ACTIVE').order('created_at'),
      supabase.from('scrap_expenses').select('*').eq('date', date).eq('status', 'ACTIVE').order('created_at'),
      supabase.from('cash_transactions').select('*').eq('date', date).eq('status', 'ACTIVE').order('created_at'),
    ]);
    setSummary(sum as ScrapCashSummary | null);
    setPurchases((purch ?? []) as PurchaseWithItem[]);
    setExpenses((exp ?? []) as ScrapExpense[]);
    setCashTx((cash ?? []) as CashTransaction[]);
    setLoading(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  async function voidPurchase(p: PurchaseWithItem) {
    const reason = window.prompt(`Reason for voiding this ${p.scrap_items?.name ?? 'scrap'} purchase?`);
    if (!reason) return;
    setBusyId(p.id);
    const { error } = await supabase.rpc('scrap_void_purchase', { p_id: p.id, p_reason: reason });
    setBusyId(null);
    if (error) { onNotice(error.message); return; }
    onNotice('Purchase voided.'); onRefresh(); void load();
  }

  async function voidExpense(e: ScrapExpense) {
    const reason = window.prompt(`Reason for voiding this ${e.category} expense?`);
    if (!reason) return;
    setBusyId(e.id);
    const { error } = await supabase.rpc('scrap_void_expense', { p_id: e.id, p_reason: reason });
    setBusyId(null);
    if (error) { onNotice(error.message); return; }
    onNotice('Expense voided.'); onRefresh(); void load();
  }

  async function voidCash(t: CashTransaction) {
    const reason = window.prompt('Reason for voiding this cash transaction?');
    if (!reason) return;
    setBusyId(t.id);
    const { error } = await supabase.rpc('scrap_void_cash_transaction', { p_id: t.id, p_reason: reason });
    setBusyId(null);
    if (error) { onNotice(error.message); return; }
    onNotice('Cash transaction voided.'); onRefresh(); void load();
  }

  if (loading) return <div className="empty"><strong>Loading…</strong></div>;

  return (
    <div>
      <div className="back-bar"><button onClick={onBack}><ChevronRight size={16} className="back-icon" /> Daily records</button></div>
      <div className="detail-header">
        <div className="detail-avatar"><strong>{new Date(date).getDate()}</strong></div>
        <div className="flex-1"><h2>{formatDate(date)}</h2><p className="muted">{purchases.length} scrap {purchases.length === 1 ? 'entry' : 'entries'} · {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} · {cashTx.length} cash {cashTx.length === 1 ? 'entry' : 'entries'}</p></div>
        {summary && <span className={`status ${summary.has_discrepancy ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{summary.has_discrepancy ? 'DISCREPANCY' : 'OK'}</span>}
      </div>

      {summary?.has_discrepancy && <div className="form-error"><AlertTriangle size={14} /> This day&apos;s closing cash is negative and is flagged for management review.</div>}
      {!summary && <div className="empty"><strong>No activity for this date</strong></div>}

      {purchases.length > 0 && <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-heading"><div><p className="eyebrow">Stream A</p><h3>Scrap purchases</h3></div></div>
        <div className="data-table">
          {purchases.map((p) => (
            <div className="table-row" key={p.id}>
              <div><strong>{p.scrap_items?.name ?? 'Scrap type'}</strong><span>{formatKes(p.rate_used_minor)}/kg · Prev {formatKg(p.opening_stock)}{p.supplier ? ` · ${p.supplier}` : ''}</span></div>
              <span className="table-muted">{formatKg(p.quantity_purchased)}</span>
              <span className="table-muted">{formatKes(p.purchase_amount_minor)}</span>
              <span className="table-muted">Closing {formatKg(p.closing_stock)}</span>
              {can('scrap.manage') && <button className="button secondary small" disabled={busyId === p.id} onClick={() => void voidPurchase(p)}><Ban size={13} /> Void</button>}
            </div>
          ))}
        </div>
      </section>}

      <div className="dashboard-grid" style={{ marginTop: 20 }}>
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Stream B</p><h3>Cash control</h3></div></div>
          {summary ? <>
            <div className="status-row"><strong>Opening cash</strong><span>{formatKes(summary.opening_cash_minor)}</span></div>
            <div className="status-row"><strong>Cash added</strong><span>{formatKes(summary.cash_added_minor)}</span></div>
            <div className="status-row"><strong>Adjustments</strong><span>{formatKes(summary.adjustments_minor)}</span></div>
            <div className="status-row"><strong>Scrap purchases</strong><span>-{formatKes(summary.purchases_minor)}</span></div>
            <div className="status-row"><strong>Expenses</strong><span>-{formatKes(summary.expenses_minor)}</span></div>
            <div className="status-row"><strong>Closing cash</strong><span style={{ fontWeight: 800, color: summary.closing_cash_minor < 0 ? '#a4493d' : undefined }}>{formatKes(summary.closing_cash_minor)}</span></div>
          </> : <p className="muted">No cash activity.</p>}
        </section>
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Breakdown</p><h3>Expenses</h3></div></div>
          {expenses.length === 0 ? <div className="empty"><strong>No expenses</strong></div> : <div className="data-table">
            {expenses.map((e) => <div className="table-row" key={e.id}>
              <div><strong>{e.category}</strong>{e.description && <span>{e.description}</span>}</div>
              <span className="table-muted">{formatKes(e.amount_minor)}</span>
              {can('scrap.manage') && <button className="button secondary small" disabled={busyId === e.id} onClick={() => void voidExpense(e)}><Ban size={13} /> Void</button>}
            </div>)}
          </div>}
        </section>
      </div>

      {cashTx.length > 0 && <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow">Cash transactions</p><h3>Cash added &amp; adjustments</h3></div></div>
        <div className="data-table">
          {cashTx.map((t) => (
            <div className="table-row" key={t.id}>
              <div><strong>{t.transaction_type === 'CASH_ADDED' ? 'Cash added' : 'Adjustment'}</strong><span>{t.added_by ? `By ${t.added_by} · ` : ''}{t.reason ?? ''}</span></div>
              <span className="table-muted">{formatKes(t.amount_minor)}</span>
              {can('scrap.manage') && <button className="button secondary small" disabled={busyId === t.id} onClick={() => void voidCash(t)}><Ban size={13} /> Void</button>}
            </div>
          ))}
        </div>
      </section>}

      <div className="action-buttons" style={{ marginTop: 20 }}>
        <button className="button secondary" onClick={() => setShowPrint(true)}><Printer size={16} /> Print / Save as PDF</button>
      </div>

      {showPrint && <ScrapDailyPrintView date={date} summary={summary} purchases={purchases} expenses={expenses} onClose={() => setShowPrint(false)} />}
    </div>
  );
}

function ScrapDailyPrintView({ date, summary, purchases, expenses, onClose }: { date: string; summary: ScrapCashSummary | null; purchases: PurchaseWithItem[]; expenses: ScrapExpense[]; onClose: () => void }) {
  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Daily scrap record — {formatDate(date)}</strong>
        <div className="action-buttons">
          <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>
      <div id="print-area" className="print-sheet">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd. — Scrap Yard</h1><p className="muted">Daily scrap &amp; cash record</p></div>
          <div style={{ textAlign: 'right' }}><p className="print-field"><span>Date</span><strong>{formatDate(date)}</strong></p></div>
        </div>
        <div className="print-section">
          <h4>Scrap purchases</h4>
          <table className="print-table"><thead><tr><th>Item</th><th>Rate/kg</th><th>Prev stock</th><th>Weight KG</th><th>Purchase</th><th>Closing stock</th></tr></thead>
          <tbody>{purchases.map((p) => <tr key={p.id}><td>{p.scrap_items?.name}</td><td>{formatKes(p.rate_used_minor)}</td><td>{formatKg(p.opening_stock)}</td><td>{formatKg(p.quantity_purchased)}</td><td>{formatKes(p.purchase_amount_minor)}</td><td>{formatKg(p.closing_stock)}</td></tr>)}</tbody></table>
        </div>
        {summary && <div className="print-section">
          <h4>Cash</h4>
          <table className="print-table"><tbody>
            <tr><td>Opening cash</td><td>{formatKes(summary.opening_cash_minor)}</td></tr>
            <tr><td>Cash added</td><td>{formatKes(summary.cash_added_minor)}</td></tr>
            <tr><td>Scrap purchases</td><td>-{formatKes(summary.purchases_minor)}</td></tr>
            <tr><td>Expenses</td><td>-{formatKes(summary.expenses_minor)}</td></tr>
            <tr><td><strong>Closing cash</strong></td><td><strong>{formatKes(summary.closing_cash_minor)}</strong></td></tr>
          </tbody></table>
        </div>}
        <div className="print-section">
          <h4>Expenses</h4>
          <table className="print-table"><thead><tr><th>Category</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>{expenses.map((e) => <tr key={e.id}><td>{e.category}</td><td>{formatKes(e.amount_minor)}</td><td>{e.description ?? ''}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}
