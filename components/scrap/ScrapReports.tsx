import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCashSummary, ScrapPurchase, ScrapCurrentStockRow, StockCycle, ScrapStockAdjustment, ScrapItem } from '@/lib/types';
import { formatKes, formatKg, formatDate, localDateStr } from '@/lib/formatting';
import { statusStyles } from '@/lib/constants';
import { CalendarDays, Boxes, RotateCcw, PackageMinus } from 'lucide-react';

type ReportId = 'monthly' | 'daily' | 'stock' | 'cycles' | 'clearances';
const REPORTS: { id: ReportId; label: string; icon: React.ReactNode }[] = [
  { id: 'monthly', label: 'Monthly scrap & cash', icon: <CalendarDays size={15} /> },
  { id: 'daily', label: 'Individual daily scrap', icon: <CalendarDays size={15} /> },
  { id: 'stock', label: 'Stock position', icon: <Boxes size={15} /> },
  { id: 'cycles', label: 'Stock cycle history', icon: <RotateCcw size={15} /> },
  { id: 'clearances', label: 'Stock clearance report', icon: <PackageMinus size={15} /> },
];

function monthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ScrapReports() {
  const [reportId, setReportId] = useState<ReportId>('monthly');
  return (
    <div>
      <div className="subtab-bar">
        {REPORTS.map((r) => <button key={r.id} className={`subtab ${reportId === r.id ? 'active' : ''}`} onClick={() => setReportId(r.id)}>{r.icon} {r.label}</button>)}
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>Use the <strong>Export CSV</strong> button at the top of the page to download any of these reports.</p>
      {reportId === 'monthly' && <MonthlyReport />}
      {reportId === 'daily' && <DailyReport />}
      {reportId === 'stock' && <StockPositionReport />}
      {reportId === 'cycles' && <CycleHistoryReport />}
      {reportId === 'clearances' && <ClearanceReport />}
    </div>
  );
}

function MonthlyReport() {
  const [month, setMonth] = useState(monthInput());
  const [days, setDays] = useState<ScrapCashSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01`;
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const { data } = await supabase.from('scrap_cash_summary').select('*').gte('date', start).lte('date', end).order('date');
      if (!mounted) return;
      setDays((data ?? []) as ScrapCashSummary[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [month]);

  const totals = days.reduce((acc, d) => ({
    kg: acc.kg + d.total_kg_purchased,
    purchases: acc.purchases + d.purchases_minor,
    cashAdded: acc.cashAdded + d.cash_added_minor,
    expenses: acc.expenses + d.expenses_minor,
  }), { kg: 0, purchases: 0, cashAdded: 0, expenses: 0 });
  const endingCash = days.length > 0 ? days[days.length - 1].closing_cash_minor : null;

  return (
    <>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div><p className="eyebrow">Monthly report</p><h1 style={{ fontSize: 24 }}>Monthly scrap &amp; cash report</h1></div>
        <div className="heading-actions"><label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label></div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : days.length === 0 ? <div className="empty"><strong>No records for this month</strong></div> : (
        <>
          <div className="panel"><div className="data-table">
            {days.map((d) => (
              <div className="table-row" key={d.date}>
                <div><strong>{formatDate(d.date)}</strong></div>
                <span className="table-muted">{formatKg(d.total_kg_purchased)}</span>
                <span className="table-muted">{formatKes(d.purchases_minor)}</span>
                <span className="table-muted">Added {formatKes(d.cash_added_minor)}</span>
                <span className="table-muted">Exp {formatKes(d.expenses_minor)}</span>
                <span className="table-muted">{formatKes(d.closing_cash_minor)}</span>
              </div>
            ))}
          </div></div>
          <div className="dashboard-grid" style={{ marginTop: 20 }}>
            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Flow metrics (this month)</p><h3>Activity totals</h3></div></div>
              <div className="status-row"><strong>Total KG purchased</strong><span>{formatKg(totals.kg)}</span></div>
              <div className="status-row"><strong>Total scrap purchased (KES)</strong><span>{formatKes(totals.purchases)}</span></div>
              <div className="status-row"><strong>Total cash added</strong><span>{formatKes(totals.cashAdded)}</span></div>
              <div className="status-row"><strong>Total expenses</strong><span>{formatKes(totals.expenses)}</span></div>
            </section>
            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Balance metric (point in time)</p><h3>Ending cash</h3></div></div>
              <p className="muted">This is the closing balance on the last recorded day of the month — not a sum of daily closing balances.</p>
              <div className="status-row"><strong>Ending cash balance</strong><span style={{ fontWeight: 800 }}>{endingCash !== null ? formatKes(endingCash) : '—'}</span></div>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function DailyReport() {
  const [date, setDate] = useState(localDateStr());
  const [scrapItemId, setScrapItemId] = useState('');
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [purchases, setPurchases] = useState<(ScrapPurchase & { scrap_items: { name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { supabase.from('scrap_items').select('*').order('name').then(({ data }) => setItems((data ?? []) as ScrapItem[])); }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      let q = supabase.from('scrap_purchases').select('*, scrap_items(name)').eq('date', date).eq('status', 'ACTIVE');
      if (scrapItemId) q = q.eq('scrap_item_id', scrapItemId);
      const { data } = await q;
      if (!mounted) return;
      setPurchases((data ?? []) as (ScrapPurchase & { scrap_items: { name: string } | null })[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [date, scrapItemId]);

  return (
    <>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div><p className="eyebrow">Individual daily scrap report</p><h1 style={{ fontSize: 24 }}>{formatDate(date)}</h1></div>
        <div className="heading-actions">
          <label style={{ marginRight: 10 }}><input type="date" value={date} max={localDateStr()} onChange={(e) => setDate(e.target.value)} /></label>
          <label><select value={scrapItemId} onChange={(e) => setScrapItemId(e.target.value)}><option value="">All scrap types</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        </div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : purchases.length === 0 ? <div className="empty"><strong>No scrap purchased on this date</strong></div> : (
        <div className="panel"><div className="data-table">
          {purchases.map((p) => (
            <div className="table-row" key={p.id}>
              <div><strong>{p.scrap_items?.name}</strong>{p.supplier && <span>{p.supplier}</span>}</div>
              <span className="table-muted">{formatKes(p.rate_used_minor)}/kg</span>
              <span className="table-muted">{formatKg(p.quantity_purchased)}</span>
              <span className="table-muted">{formatKes(p.purchase_amount_minor)}</span>
              <span className="table-muted">Stock after: {formatKg(p.closing_stock)}</span>
            </div>
          ))}
        </div></div>
      )}
    </>
  );
}

function StockPositionReport() {
  const [stock, setStock] = useState<ScrapCurrentStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('scrap_current_stock').select('*').order('name').then(({ data }) => { setStock((data ?? []) as ScrapCurrentStockRow[]); setLoading(false); }); }, []);

  return (
    <>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div><p className="eyebrow">Stock position report</p><h1 style={{ fontSize: 24 }}>Current stock — every scrap type</h1></div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : (
        <div className="panel"><div className="data-table">
          {stock.map((s) => (
            <div className="table-row" key={s.scrap_item_id}>
              <div><strong>{s.name}</strong>{!s.active && <span>Inactive</span>}</div>
              <span className="table-muted">{formatKg(s.current_quantity)}</span>
              <span className="table-muted">{s.current_rate_minor === null ? 'Rate not set' : formatKes(s.current_rate_minor)}</span>
              <span className="table-muted">{formatKes(s.current_quantity * (s.current_rate_minor ?? 0))}</span>
            </div>
          ))}
        </div></div>
      )}
    </>
  );
}

function CycleHistoryReport() {
  const [cycles, setCycles] = useState<(StockCycle & { scrap_items: { name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('stock_cycles').select('*, scrap_items(name)').order('opening_date', { ascending: false }).then(({ data }) => { setCycles((data ?? []) as (StockCycle & { scrap_items: { name: string } | null })[]); setLoading(false); }); }, []);

  return (
    <>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div><p className="eyebrow">Stock cycle history</p><h1 style={{ fontSize: 24 }}>Every stock cycle, open and closed</h1></div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : cycles.length === 0 ? <div className="empty"><strong>No stock cycles yet</strong></div> : (
        <div className="panel"><div className="data-table">
          {cycles.map((c) => (
            <div className="table-row" key={c.id}>
              <div><strong>{c.scrap_items?.name}</strong><span>Cycle {c.cycle_number} · Opened {formatDate(c.opening_date)}{c.closing_date ? ` · Closed ${formatDate(c.closing_date)}` : ''}</span></div>
              <span className="table-muted">Opening {formatKg(c.opening_quantity)}</span>
              <span className="table-muted">{c.status === 'OPEN' ? `Current ${formatKg(c.current_quantity)}` : `Closing ${formatKg(c.closing_quantity ?? 0)}`}</span>
              <span className={`status ${statusStyles[c.status] ?? ''}`}>{c.status}</span>
            </div>
          ))}
        </div></div>
      )}
    </>
  );
}

function ClearanceReport() {
  const [adjustments, setAdjustments] = useState<(ScrapStockAdjustment & { scrap_items: { name: string } | null; stock_cycles: { cycle_number: number } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('scrap_stock_adjustments').select('*, scrap_items(name), stock_cycles(cycle_number)').eq('adjustment_type', 'CLEARANCE').order('date', { ascending: false }).then(({ data }) => {
      setAdjustments((data ?? []) as (ScrapStockAdjustment & { scrap_items: { name: string } | null; stock_cycles: { cycle_number: number } | null })[]);
      setLoading(false);
    });
  }, []);

  return (
    <>
      <div className="page-heading" style={{ marginBottom: 18 }}>
        <div><p className="eyebrow">Stock clearance report</p><h1 style={{ fontSize: 24 }}>Every clearance event</h1></div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : adjustments.length === 0 ? <div className="empty"><strong>No clearances recorded</strong></div> : (
        <div className="panel"><div className="data-table">
          {adjustments.map((a) => (
            <div className="table-row" key={a.id}>
              <div><strong>{a.scrap_items?.name}</strong><span>{formatDate(a.date)} · Cycle {a.stock_cycles?.cycle_number} · {a.reason}</span></div>
              <span className="table-muted">Before {formatKg(a.previous_stock)}</span>
              <span className="table-muted">Cleared {formatKg(a.quantity)}</span>
              <span className="table-muted">Remaining {formatKg(a.resulting_stock)}</span>
              <span className="table-muted">By {a.authorized_by}</span>
            </div>
          ))}
        </div></div>
      )}
    </>
  );
}
