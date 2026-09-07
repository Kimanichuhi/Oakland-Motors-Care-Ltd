import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCashSummary, ScrapExpense } from '@/lib/types';
import { formatKes, formatKg, formatDate, localDateStr } from '@/lib/formatting';
import { Wallet, Banknote, Package, TrendingDown, AlertTriangle, CircleDollarSign } from 'lucide-react';

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function ScrapFinancesPage() {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(localDateStr());
  const [days, setDays] = useState<ScrapCashSummary[]>([]);
  const [expenses, setExpenses] = useState<ScrapExpense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [{ data: dayRows }, { data: expenseRows }] = await Promise.all([
        supabase.from('scrap_cash_summary').select('*').gte('date', fromDate).lte('date', toDate).order('date'),
        supabase.from('scrap_expenses').select('*').eq('status', 'ACTIVE').gte('date', fromDate).lte('date', toDate),
      ]);
      if (!mounted) return;
      setDays((dayRows ?? []) as ScrapCashSummary[]);
      setExpenses((expenseRows ?? []) as ScrapExpense[]);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [fromDate, toDate]);

  const totals = useMemo(() => days.reduce((acc, d) => ({
    cashAdded: acc.cashAdded + d.cash_added_minor,
    purchases: acc.purchases + d.purchases_minor,
    expenses: acc.expenses + d.expenses_minor,
    adjustments: acc.adjustments + d.adjustments_minor,
    kg: acc.kg + d.total_kg_purchased,
  }), { cashAdded: 0, purchases: 0, expenses: 0, adjustments: 0, kg: 0 }), [days]);

  const netCashFlow = totals.cashAdded + totals.adjustments - totals.purchases - totals.expenses;
  const discrepancyDays = days.filter((d) => d.has_discrepancy).length;
  const latestClosingCash = days.length > 0 ? days[days.length - 1].closing_cash_minor : null;

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount_minor);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount_minor, 0);
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount, pct: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Scrap yard</p><h1>Finances</h1><p className="muted">Cash added, money spent on purchases and expenses, and where it went.</p></div>
      </div>

      <div className="filter-bar" style={{ marginBottom: 18 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From<input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To<input type="date" value={toDate} min={fromDate} max={localDateStr()} onChange={(e) => setToDate(e.target.value)} /></label>
      </div>

      {loading ? <div className="empty"><strong>Loading…</strong></div> : days.length === 0 ? <div className="empty"><strong>No activity in this date range</strong></div> : (
        <>
          <div className="kpi-row">
            <div className="metric-card"><div className="metric-icon gold"><Banknote size={17} /></div><div className="metric-copy"><span>Cash added</span><strong>{formatKes(totals.cashAdded)}</strong></div></div>
            <div className="metric-card"><div className="metric-icon blue"><Package size={17} /></div><div className="metric-copy"><span>Spent on purchases</span><strong>{formatKes(totals.purchases)}</strong></div></div>
            <div className="metric-card"><div className="metric-icon red"><TrendingDown size={17} /></div><div className="metric-copy"><span>Spent on expenses</span><strong>{formatKes(totals.expenses)}</strong></div></div>
            <div className="metric-card"><div className="metric-icon green"><CircleDollarSign size={17} /></div><div className="metric-copy"><span>Net cash flow</span><strong style={{ color: netCashFlow < 0 ? '#a4493d' : undefined }}>{formatKes(netCashFlow)}</strong></div></div>
            <div className="metric-card"><div className="metric-icon navy"><Wallet size={17} /></div><div className="metric-copy"><span>Closing cash (latest)</span><strong>{latestClosingCash !== null ? formatKes(latestClosingCash) : '—'}</strong></div></div>
            <div className="metric-card"><div className="metric-icon gold"><AlertTriangle size={17} /></div><div className="metric-copy"><span>Discrepancy days</span><strong>{discrepancyDays}</strong></div></div>
          </div>

          <div className="dashboard-grid" style={{ marginTop: 20 }}>
            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Breakdown</p><h3>Expenses by category</h3></div></div>
              {byCategory.length === 0 ? <div className="empty"><strong>No expenses in this range</strong></div> : (
                <div className="data-table">
                  {byCategory.map((c) => (
                    <div className="table-row" key={c.category}>
                      <div><strong>{c.category}</strong><span>{c.pct.toFixed(0)}% of expenses</span></div>
                      <span className="table-muted">{formatKes(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {byCategory.length > 0 && <div className="total-row"><strong>Total expenses</strong><span>{formatKes(totals.expenses)}</span></div>}
            </section>
            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Flow metrics</p><h3>Activity totals</h3></div></div>
              <div className="status-row"><strong>KG purchased</strong><span>{formatKg(totals.kg)}</span></div>
              <div className="status-row"><strong>Cash added</strong><span>{formatKes(totals.cashAdded)}</span></div>
              <div className="status-row"><strong>Cash adjustments</strong><span>{formatKes(totals.adjustments)}</span></div>
              <div className="status-row"><strong>Spent on purchases</strong><span>-{formatKes(totals.purchases)}</span></div>
              <div className="status-row"><strong>Spent on expenses</strong><span>-{formatKes(totals.expenses)}</span></div>
              <div className="status-row"><strong>Net cash flow</strong><span style={{ fontWeight: 800, color: netCashFlow < 0 ? '#a4493d' : undefined }}>{formatKes(netCashFlow)}</span></div>
            </section>
          </div>

          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-heading"><div><p className="eyebrow">Day by day</p><h3>Cash position</h3></div></div>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead><tr><th>Date</th><th className="numeric">Cash Added</th><th className="numeric">Purchases</th><th className="numeric">Expenses</th><th className="numeric">Closing Cash</th></tr></thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <td>{formatDate(d.date)}</td>
                      <td className="numeric">{formatKes(d.cash_added_minor)}</td>
                      <td className="numeric">{formatKes(d.purchases_minor)}</td>
                      <td className="numeric">{formatKes(d.expenses_minor)}</td>
                      <td className="numeric">{d.has_discrepancy ? <span className="status bg-amber-50 text-amber-700">{formatKes(d.closing_cash_minor)}</span> : formatKes(d.closing_cash_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
