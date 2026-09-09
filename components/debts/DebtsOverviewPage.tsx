import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DebtRecord } from '@/lib/types';
import { formatKes } from '@/lib/formatting';
import { AlertTriangle, Users, Wrench, ClipboardList, ChevronRight } from 'lucide-react';
import { fetchJobCardDebts, type JobCardDebtRow } from './jobCardDebt';

type PersonTotal = { name: string; source: 'Manual' | 'Work Order'; amount_minor: number; count: number };

export default function DebtsOverviewPage({ onNavigateToRegister, onNavigateToReports }: { onNavigateToRegister: () => void; onNavigateToReports: () => void }) {
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [jobDebts, setJobDebts] = useState<JobCardDebtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: debtRows }, jobRows] = await Promise.all([
        supabase.from('debt_records').select('*').neq('status', 'WRITTEN_OFF').order('incurred_date', { ascending: false }).limit(500),
        fetchJobCardDebts(),
      ]);
      setDebts((debtRows ?? []) as DebtRecord[]);
      setJobDebts(jobRows);
      setLoading(false);
    })();
  }, []);

  const manualOutstanding = debts.reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0);
  const jobCardOutstanding = jobDebts.reduce((s, j) => s + j.balance_minor, 0);
  const totalOutstanding = manualOutstanding + jobCardOutstanding;
  const staffLiability = debts.filter((d) => d.debt_type === 'STAFF').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0);
  const customerDebt = debts.filter((d) => d.debt_type === 'CUSTOMER').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0) + jobCardOutstanding;

  const personMap = new Map<string, PersonTotal>();
  for (const d of debts) {
    const key = `M:${d.responsible_name}`;
    const cur = personMap.get(key) ?? { name: d.responsible_name, source: 'Manual', amount_minor: 0, count: 0 };
    cur.amount_minor += d.amount_minor - d.amount_recovered_minor;
    cur.count += 1;
    personMap.set(key, cur);
  }
  for (const j of jobDebts) {
    const name = j.technician_name ?? 'Unassigned';
    const key = `W:${name}`;
    const cur = personMap.get(key) ?? { name, source: 'Work Order', amount_minor: 0, count: 0 };
    cur.amount_minor += j.balance_minor;
    cur.count += 1;
    personMap.set(key, cur);
  }
  const topDebtors = Array.from(personMap.values()).sort((a, b) => b.amount_minor - a.amount_minor).slice(0, 6);

  if (loading) return <div className="empty"><strong>Loading...</strong></div>;

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Accountability</p><h1>Debts Overview</h1><p className="muted">Combined view of customer debt and staff liability across the whole business.</p></div>
    </div>
    <div className="metric-grid" style={{ marginBottom: 20 }}>
      <div className="metric-card"><div className="metric-icon red"><AlertTriangle size={18} /></div><div className="metric-copy"><span>Total Owed to the Business</span><strong>{formatKes(totalOutstanding)}</strong><small>Debt register + open work order balances</small></div></div>
      <div className="metric-card"><div className="metric-icon gold"><Users size={18} /></div><div className="metric-copy"><span>Customer Debt</span><strong>{formatKes(customerDebt)}</strong><small>Unpaid work + recorded customer debt</small></div></div>
      <div className="metric-card"><div className="metric-icon blue"><Wrench size={18} /></div><div className="metric-copy"><span>Staff Liability</span><strong>{formatKes(staffLiability)}</strong><small>Owed directly by staff</small></div></div>
      <div className="metric-card"><div className="metric-icon navy"><ClipboardList size={18} /></div><div className="metric-copy"><span>Work Orders with Debt</span><strong>{jobDebts.length}</strong><small>{formatKes(jobCardOutstanding)} outstanding</small></div></div>
    </div>
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Who owes / is accountable</p><h3>Top by Person</h3></div><button className="text-button" onClick={onNavigateToReports}>Full report <ChevronRight size={14} /></button></div>
        {topDebtors.length === 0 ? <div className="empty"><strong>Nothing outstanding</strong><span>No debt recorded against anyone right now.</span></div> : <div className="data-table">
          {topDebtors.map((p) => <div className="row" key={p.source + p.name} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: '1px solid #eef1f3' }}>
            <div className="job-icon"><Users size={15} /></div>
            <div style={{ flex: 1 }}><strong style={{ display: 'block', fontSize: 12 }}>{p.name}</strong><span style={{ display: 'block', fontSize: 10, color: '#82909c', marginTop: 2 }}>{p.count} {p.source === 'Manual' ? 'recorded debt' : 'work order'}{p.count === 1 ? '' : 's'}</span></div>
            <strong style={{ fontSize: 12, color: '#a4493d' }}>{formatKes(p.amount_minor)}</strong>
          </div>)}
        </div>}
      </section>
      <section className="panel attention-panel">
        <div className="panel-heading"><div><p className="eyebrow">Manual entries</p><h3>Debt Register</h3></div><button className="text-button" onClick={onNavigateToRegister}>Open <ChevronRight size={14} /></button></div>
        <p className="muted" style={{ marginBottom: 10 }}>Record a technician&apos;s shortfall, a customer debt that never went through a job card, or any staff liability.</p>
        <button className="button primary wide" onClick={onNavigateToRegister}>Go to Debt Register</button>
      </section>
    </div>
  </>;
}
