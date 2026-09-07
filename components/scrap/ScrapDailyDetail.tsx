import React, { useCallback, useEffect, useState } from 'react';
import { toPng } from 'html-to-image';
import { supabase } from '@/lib/supabase';
import type { ScrapPurchase, ScrapExpense, CashTransaction, ScrapCashSummary } from '@/lib/types';
import { formatKes, formatKg, formatDate } from '@/lib/formatting';
import { ChevronRight, Printer, Download, Ban, AlertTriangle, X } from 'lucide-react';

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
  const [voidTarget, setVoidTarget] = useState<{ kind: 'purchase' | 'expense' | 'cash'; id: string; label: string } | null>(null);

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

  async function confirmVoid(reason: string) {
    if (!voidTarget) return;
    const rpc = voidTarget.kind === 'purchase' ? 'scrap_void_purchase' : voidTarget.kind === 'expense' ? 'scrap_void_expense' : 'scrap_void_cash_transaction';
    setBusyId(voidTarget.id);
    const { error } = await supabase.rpc(rpc, { p_id: voidTarget.id, p_reason: reason });
    setBusyId(null);
    if (error) { onNotice(error.message); return; }
    onNotice(`${voidTarget.label} voided.`); setVoidTarget(null); onRefresh(); void load();
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
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th>Scrap Type</th><th>Supplier</th><th className="numeric">Rate/kg</th><th className="numeric">Prev Stock</th><th className="numeric">Weight KG</th><th className="numeric">Amount</th><th className="numeric">Closing Stock</th>{can('scrap.manage') && <th></th>}
            </tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.scrap_items?.name ?? 'Scrap type'}</strong></td>
                  <td>{p.supplier ?? '—'}</td>
                  <td className="numeric">{formatKes(p.rate_used_minor)}</td>
                  <td className="numeric">{formatKg(p.opening_stock)}</td>
                  <td className="numeric">{formatKg(p.quantity_purchased)}</td>
                  <td className="numeric">{formatKes(p.purchase_amount_minor)}</td>
                  <td className="numeric">{formatKg(p.closing_stock)}</td>
                  {can('scrap.manage') && <td className="numeric"><button className="button secondary small" disabled={busyId === p.id} onClick={() => setVoidTarget({ kind: 'purchase', id: p.id, label: `${p.scrap_items?.name ?? 'Scrap'} purchase` })}><Ban size={13} /> Void</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
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
              {can('scrap.manage') && <button className="button secondary small" disabled={busyId === e.id} onClick={() => setVoidTarget({ kind: 'expense', id: e.id, label: `${e.category} expense` })}><Ban size={13} /> Void</button>}
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
              {can('scrap.manage') && <button className="button secondary small" disabled={busyId === t.id} onClick={() => setVoidTarget({ kind: 'cash', id: t.id, label: t.transaction_type === 'CASH_ADDED' ? 'Cash added entry' : 'Cash adjustment' })}><Ban size={13} /> Void</button>}
            </div>
          ))}
        </div>
      </section>}

      <div className="action-buttons" style={{ marginTop: 20 }}>
        <button className="button secondary" onClick={() => setShowPrint(true)}><Printer size={16} /> Print / Save as PDF</button>
      </div>

      {showPrint && <ScrapDailyPrintView date={date} summary={summary} purchases={purchases} expenses={expenses} cashTx={cashTx} onClose={() => setShowPrint(false)} onNotice={onNotice} />}
      {voidTarget && <VoidReasonModal label={voidTarget.label} busy={busyId === voidTarget.id} onCancel={() => setVoidTarget(null)} onConfirm={(reason) => void confirmVoid(reason)} />}
    </div>
  );
}

function VoidReasonModal({ label, busy, onCancel, onConfirm }: { label: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ width: 'min(440px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Void entry</p><h2>{label}</h2></div><button className="close-button" onClick={onCancel}><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onConfirm(reason.trim()); }} className="modal-form">
          <label>Reason for voiding<textarea value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
            <button className="button primary wide" type="submit" disabled={busy || !reason.trim()}><Ban size={15} /> {busy ? 'Voiding…' : 'Void entry'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ScrapDailyPrintView({ date, summary, purchases, expenses, cashTx, onClose, onNotice }: { date: string; summary: ScrapCashSummary | null; purchases: PurchaseWithItem[]; expenses: ScrapExpense[]; cashTx: CashTransaction[]; onClose: () => void; onNotice: (m: string) => void }) {
  const [exporting, setExporting] = useState(false);

  async function exportImage() {
    const original = document.getElementById('print-area');
    if (!original) return;
    setExporting(true);

    // html-to-image cannot reliably measure or render a node nested inside a
    // position:fixed ancestor (the print overlay) — that's what was causing the
    // capture to be misaligned/cropped no matter what width/height was passed.
    // Clone the content into a plain, off-screen, non-fixed wrapper and capture
    // that instead, so it lays out and measures like a normal document flow.
    const clone = original.cloneNode(true) as HTMLElement;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '-99999px';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    try {
      await document.fonts?.ready;
      const images = Array.from(clone.querySelectorAll('img'));
      await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }))));

      const dataUrl = await toPng(clone, { pixelRatio: 2, width: clone.scrollWidth, height: clone.scrollHeight, backgroundColor: '#ffffff', cacheBust: true });
      const link = document.createElement('a');
      link.download = `scrap-daily-record-${date}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      onNotice('Unable to export the daily record as an image. Please try again.');
    } finally {
      document.body.removeChild(wrapper);
    }
    setExporting(false);
  }

  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Daily scrap record — {formatDate(date)}</strong>
        <div className="action-buttons">
          <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="button secondary small" disabled={exporting} onClick={() => void exportImage()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export as image'}</button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>
      <div id="print-area" className="print-sheet">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd. — Scrap Yard</h1><p className="muted">Daily scrap &amp; cash record</p></div>
          <div style={{ textAlign: 'right' }}><p className="print-field"><span>Date</span><strong style={{ fontSize: 18 }}>{formatDate(date)}</strong></p></div>
        </div>
        <div className="print-section">
          <h4>Scrap purchases</h4>
          {purchases.length === 0 ? <p className="muted">No purchases recorded.</p> : <table className="print-table"><thead><tr><th style={{ width: '22%' }}>Item</th><th>Rate/kg</th><th>Prev stock</th><th>Weight KG</th><th>Purchase</th><th>Closing stock</th></tr></thead>
          <tbody>{purchases.map((p) => <tr key={p.id}><td>{p.scrap_items?.name}</td><td>{formatKes(p.rate_used_minor)}</td><td>{formatKg(p.opening_stock)}</td><td>{formatKg(p.quantity_purchased)}</td><td>{formatKes(p.purchase_amount_minor)}</td><td>{formatKg(p.closing_stock)}</td></tr>)}</tbody></table>}
        </div>
        {summary && <div className="print-section">
          <h4>Cash</h4>
          <table className="print-table"><tbody>
            <tr><td>Opening cash</td><td>{formatKes(summary.opening_cash_minor)}</td></tr>
            <tr><td>Cash added</td><td>{formatKes(summary.cash_added_minor)}</td></tr>
            <tr><td>Scrap purchases</td><td>-{formatKes(summary.purchases_minor)}</td></tr>
            <tr><td>Expenses</td><td>-{formatKes(summary.expenses_minor)}</td></tr>
            <tr><td>Adjustments</td><td>{formatKes(summary.adjustments_minor)}</td></tr>
            <tr><td><strong>Closing cash</strong></td><td><strong>{formatKes(summary.closing_cash_minor)}</strong></td></tr>
          </tbody></table>
        </div>}
        <div className="print-section">
          <h4>Expenses</h4>
          {expenses.length === 0 ? <p className="muted">No expenses recorded.</p> : <table className="print-table"><thead><tr><th style={{ width: '35%' }}>Category</th><th style={{ width: '25%' }}>Amount</th><th>Notes</th></tr></thead>
          <tbody>{expenses.map((e) => <tr key={e.id}><td>{e.category}</td><td>{formatKes(e.amount_minor)}</td><td>{e.description ?? ''}</td></tr>)}</tbody></table>}
        </div>
        <div className="print-section">
          <h4>Cash added &amp; adjustments</h4>
          {cashTx.length === 0 ? <p className="muted">No cash transactions recorded.</p> : <table className="print-table"><thead><tr><th style={{ width: '25%' }}>Type</th><th style={{ width: '20%' }}>Amount</th><th style={{ width: '20%' }}>By</th><th>Reason</th></tr></thead>
          <tbody>{cashTx.map((t) => <tr key={t.id}><td>{t.transaction_type === 'CASH_ADDED' ? 'Cash added' : 'Adjustment'}</td><td>{formatKes(t.amount_minor)}</td><td>{t.added_by ?? ''}</td><td>{t.reason ?? ''}</td></tr>)}</tbody></table>}
        </div>
      </div>
    </div>
  );
}
