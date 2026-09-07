import React, { useEffect, useMemo, useState } from 'react';
import { toPng } from 'html-to-image';
import { supabase } from '@/lib/supabase';
import type { ScrapCashSummary, ScrapItem, ScrapPurchase, ScrapExpense } from '@/lib/types';
import { formatKes, formatKg, formatDate } from '@/lib/formatting';
import { byScrapTypeOrder } from '@/lib/constants';
import { Search, ChevronRight, Calendar, Printer, Download } from 'lucide-react';
import ScrapDailyDetail from './ScrapDailyDetail';

export default function ScrapRecordsHistory({ can, onNotice, onRefresh, refreshKey }: {
  can: (p: string) => boolean; onNotice: (m: string) => void; onRefresh: () => void; refreshKey: number;
}) {
  const [days, setDays] = useState<ScrapCashSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [scrapItemId, setScrapItemId] = useState('');
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => { supabase.from('scrap_items').select('*').order('name').then(({ data }) => setItems(((data ?? []) as ScrapItem[]).sort(byScrapTypeOrder))); }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      let q = supabase.from('scrap_cash_summary').select('*').order('date', { ascending: sortDir === 'asc' }).limit(365);
      if (fromDate) q = q.gte('date', fromDate);
      if (toDate) q = q.lte('date', toDate);
      const { data } = await q;
      if (!mounted) return;
      setDays((data ?? []) as ScrapCashSummary[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [fromDate, toDate, sortDir, refreshKey]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return days;
    return days.filter((d) => formatDate(d.date).toLowerCase().includes(term));
  }, [days, query]);

  if (selectedDate) {
    return <ScrapDailyDetail date={selectedDate} can={can} onBack={() => setSelectedDate(null)} onNotice={onNotice} onRefresh={onRefresh} />;
  }

  return (
    <div>
      <div className="panel-heading">
        <div><p className="eyebrow">Daily records</p><h3>Scrap &amp; cash history</h3></div>
        <button className="button secondary small" onClick={() => setShowPrint(true)}><Printer size={14} /> Export PDF</button>
      </div>

      <div className="filter-bar" style={{ marginBottom: 18 }}>
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by date..." style={{ flex: '1 1 160px' }} />
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="From" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} title="To" />
        <select value={scrapItemId} onChange={(e) => setScrapItemId(e.target.value)} title="Scrap type"><option value="">All scrap types</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
      </div>

      {loading ? <div className="empty"><strong>Loading…</strong></div> : filtered.length === 0 ? (
        <div className="empty"><Calendar size={18} /><strong>No daily records</strong><span>Add a purchase, expense or cash entry to get started.</span></div>
      ) : (
        <div className="panel"><div className="data-table">
          {filtered.map((d) => (
            <div className="table-row clickable" key={d.date} onClick={() => setSelectedDate(d.date)}>
              <div><strong>{formatDate(d.date)}</strong><span>{formatKg(d.total_kg_purchased)} purchased</span></div>
              <span className="table-muted">{formatKes(d.purchases_minor)}</span>
              <span className="table-muted">Added {formatKes(d.cash_added_minor)}</span>
              <span className="table-muted">Expenses {formatKes(d.expenses_minor)}</span>
              <span className={`status ${d.has_discrepancy ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{formatKes(d.closing_cash_minor)}</span>
              <ChevronRight size={16} className="row-arrow" />
            </div>
          ))}
        </div></div>
      )}

      {showPrint && <ScrapRecordsPrintView fromDate={fromDate} toDate={toDate} scrapItemId={scrapItemId} scrapItemName={items.find((i) => i.id === scrapItemId)?.name ?? null} onClose={() => setShowPrint(false)} onNotice={onNotice} />}
    </div>
  );
}

function ScrapRecordsPrintView({ fromDate, toDate, scrapItemId, scrapItemName, onClose, onNotice }: {
  fromDate: string; toDate: string; scrapItemId: string; scrapItemName: string | null; onClose: () => void; onNotice: (m: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [purchases, setPurchases] = useState<(ScrapPurchase & { scrap_items: { name: string } | null })[]>([]);
  const [expenses, setExpenses] = useState<ScrapExpense[]>([]);
  const [days, setDays] = useState<ScrapCashSummary[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      let purchaseQuery = supabase.from('scrap_purchases').select('*, scrap_items(name)').eq('status', 'ACTIVE').order('date');
      if (fromDate) purchaseQuery = purchaseQuery.gte('date', fromDate);
      if (toDate) purchaseQuery = purchaseQuery.lte('date', toDate);
      if (scrapItemId) purchaseQuery = purchaseQuery.eq('scrap_item_id', scrapItemId);

      let expenseQuery = supabase.from('scrap_expenses').select('*').eq('status', 'ACTIVE').order('date');
      if (fromDate) expenseQuery = expenseQuery.gte('date', fromDate);
      if (toDate) expenseQuery = expenseQuery.lte('date', toDate);

      let daysQuery = supabase.from('scrap_cash_summary').select('*').order('date');
      if (fromDate) daysQuery = daysQuery.gte('date', fromDate);
      if (toDate) daysQuery = daysQuery.lte('date', toDate);

      const [{ data: purch }, { data: exp }, { data: dayRows }] = await Promise.all([purchaseQuery, expenseQuery, daysQuery]);
      if (!mounted) return;
      setPurchases((purch ?? []) as (ScrapPurchase & { scrap_items: { name: string } | null })[]);
      setExpenses((exp ?? []) as ScrapExpense[]);
      setDays((dayRows ?? []) as ScrapCashSummary[]);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [fromDate, toDate, scrapItemId]);

  const totalKg = purchases.reduce((s, p) => s + p.quantity_purchased, 0);
  const totalPurchases = purchases.reduce((s, p) => s + p.purchase_amount_minor, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount_minor, 0);
  const rangeLabel = fromDate && toDate ? `${formatDate(fromDate)} – ${formatDate(toDate)}` : fromDate ? `From ${formatDate(fromDate)}` : toDate ? `Up to ${formatDate(toDate)}` : 'All time';

  async function exportImage() {
    const original = document.getElementById('print-area');
    if (!original) return;
    setExporting(true);

    // html-to-image cannot reliably measure or render a node nested inside a
    // position:fixed ancestor (the print overlay) — clone the content into a plain,
    // off-screen, non-fixed wrapper and capture that instead, so it lays out and
    // measures like a normal document flow.
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
      link.download = `scrap-daily-records-${fromDate || 'all'}-to-${toDate || 'all'}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      onNotice('Unable to export the daily records as an image. Please try again.');
    } finally {
      document.body.removeChild(wrapper);
    }
    setExporting(false);
  }

  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Daily records — {rangeLabel}{scrapItemName ? ` · ${scrapItemName}` : ''}</strong>
        <div className="action-buttons">
          <button className="button primary small" disabled={loading} onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="button secondary small" disabled={loading || exporting} onClick={() => void exportImage()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export as image'}</button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>
      <div id="print-area" className="print-sheet">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd. — Scrap Yard</h1><p className="muted">Daily records report</p></div>
          <div style={{ textAlign: 'right' }}>
            <p className="print-field"><span>Date range</span><strong>{rangeLabel}</strong></p>
            {scrapItemName && <p className="print-field"><span>Scrap type</span><strong>{scrapItemName}</strong></p>}
          </div>
        </div>

        {loading ? <p className="muted">Loading…</p> : <>
          <div className="print-section">
            <h4>Scrap purchases{scrapItemName ? ` — ${scrapItemName}` : ''} ({purchases.length})</h4>
            {purchases.length === 0 ? <p className="muted">No purchases in this range.</p> : <table className="print-table">
              <thead><tr><th>Date</th><th>Item</th><th>Rate/kg</th><th>Weight KG</th><th>Amount</th></tr></thead>
              <tbody>{purchases.map((p) => <tr key={p.id}><td>{formatDate(p.date)}</td><td>{p.scrap_items?.name ?? ''}</td><td>{formatKes(p.rate_used_minor)}</td><td>{formatKg(p.quantity_purchased)}</td><td>{formatKes(p.purchase_amount_minor)}</td></tr>)}</tbody>
            </table>}
            {purchases.length > 0 && <div className="print-totals"><table><tbody><tr><td>Total weight</td><td>{formatKg(totalKg)}</td></tr><tr><td><strong>Total purchases</strong></td><td><strong>{formatKes(totalPurchases)}</strong></td></tr></tbody></table></div>}
          </div>

          <div className="print-section">
            <h4>Expenses ({expenses.length})</h4>
            {expenses.length === 0 ? <p className="muted">No expenses in this range.</p> : <table className="print-table">
              <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>{expenses.map((e) => <tr key={e.id}><td>{formatDate(e.date)}</td><td>{e.category}</td><td>{formatKes(e.amount_minor)}</td><td>{e.description ?? ''}</td></tr>)}</tbody>
            </table>}
            {expenses.length > 0 && <div className="print-totals"><table><tbody><tr><td><strong>Total expenses</strong></td><td><strong>{formatKes(totalExpenses)}</strong></td></tr></tbody></table></div>}
          </div>

          <div className="print-section">
            <h4>Cash position by day ({days.length})</h4>
            {days.length === 0 ? <p className="muted">No cash activity in this range.</p> : <table className="print-table">
              <thead><tr><th>Date</th><th>Cash Added</th><th>Purchases</th><th>Expenses</th><th>Closing Cash</th></tr></thead>
              <tbody>{days.map((d) => <tr key={d.date}><td>{formatDate(d.date)}</td><td>{formatKes(d.cash_added_minor)}</td><td>{formatKes(d.purchases_minor)}</td><td>{formatKes(d.expenses_minor)}</td><td>{formatKes(d.closing_cash_minor)}{d.has_discrepancy ? ' ⚠' : ''}</td></tr>)}</tbody>
            </table>}
          </div>
        </>}
      </div>
    </div>
  );
}
