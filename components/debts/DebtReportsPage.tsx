import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DebtRecord } from '@/lib/types';
import { formatKes, formatDate, downloadCSV } from '@/lib/formatting';
import { Download, Wrench, AlertTriangle, CheckCircle2, Ban, ChevronRight } from 'lucide-react';
import { fetchJobCardDebts, type JobCardDebtRow } from './jobCardDebt';

type Row = { key: string; label: string; sub: string; amount_minor: number; count: number };
type TypeFilter = 'ALL' | 'CUSTOMER' | 'STAFF';

function aggregate(items: { key: string; label: string; sub?: string; amount_minor: number }[]): Row[] {
  const map = new Map<string, Row>();
  for (const it of items) {
    const cur = map.get(it.key) ?? { key: it.key, label: it.label, sub: it.sub ?? '', amount_minor: 0, count: 0 };
    cur.amount_minor += it.amount_minor;
    cur.count += 1;
    map.set(it.key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.amount_minor - a.amount_minor);
}

function RankedTable({ rows, headLabel }: { rows: Row[]; headLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount_minor));
  return (
    <div className="data-table">
      {rows.map((r) => <div key={r.key} style={{ padding: '10px 0', borderTop: '1px solid #eef1f3' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 12.5 }}>{r.label || headLabel}</strong>
            <span className="status bg-slate-100 text-slate-600" style={{ marginLeft: 7 }}>{r.sub}</span>
            <span className="muted" style={{ marginLeft: 7, fontSize: 10.5 }}>{r.count} {r.count === 1 ? 'entry' : 'entries'}</span>
          </div>
          <strong style={{ fontSize: 12.5, color: '#a4493d', flexShrink: 0 }}>{formatKes(r.amount_minor)}</strong>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: '#f1f3f5', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(3, (r.amount_minor / max) * 100)}%`, background: 'var(--gold)', borderRadius: 3 }} />
        </div>
      </div>)}
    </div>
  );
}

export default function DebtReportsPage({ onSelectJob }: { onSelectJob?: (id: string) => void }) {
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [jobDebts, setJobDebts] = useState<JobCardDebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: debtRows }, jobRows] = await Promise.all([
        supabase.from('debt_records').select('*').order('incurred_date', { ascending: false }).limit(1000),
        fetchJobCardDebts(),
      ]);
      setDebts((debtRows ?? []) as DebtRecord[]);
      setJobDebts(jobRows);
      setLoading(false);
    })();
  }, []);

  const openDebts = useMemo(() => debts.filter((d) => d.status !== 'WRITTEN_OFF'), [debts]);
  const includeCustomer = typeFilter !== 'STAFF';
  const includeStaff = typeFilter !== 'CUSTOMER';
  const includeJobDebts = includeCustomer; // job-card balances are always customer debt

  const visibleDebts = useMemo(() => openDebts.filter((d) => (d.debt_type === 'CUSTOMER' ? includeCustomer : includeStaff)), [openDebts, includeCustomer, includeStaff]);
  const visibleJobDebts = includeJobDebts ? jobDebts : [];

  const totalOutstanding = visibleDebts.reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0) + visibleJobDebts.reduce((s, j) => s + j.balance_minor, 0);
  const customerOutstanding = openDebts.filter((d) => d.debt_type === 'CUSTOMER').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0) + jobDebts.reduce((s, j) => s + j.balance_minor, 0);
  const staffOutstanding = openDebts.filter((d) => d.debt_type === 'STAFF').reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0);
  const totalRecovered = debts.reduce((s, d) => s + d.amount_recovered_minor, 0);
  const writtenOff = debts.filter((d) => d.status === 'WRITTEN_OFF');
  const writtenOffAmount = writtenOff.reduce((s, d) => s + (d.amount_minor - d.amount_recovered_minor), 0);

  const byPerson = aggregate([
    ...visibleDebts.map((d) => ({ key: `M:${d.responsible_name}`, label: d.responsible_name, sub: 'Debt Register', amount_minor: d.amount_minor - d.amount_recovered_minor })),
    ...visibleJobDebts.map((j) => ({ key: `W:${j.technician_name ?? 'Unassigned'}`, label: j.technician_name ?? 'Unassigned', sub: 'Work Orders', amount_minor: j.balance_minor })),
  ]);

  const byProduct = aggregate([
    ...visibleDebts.map((d) => ({ key: `P:${d.item_description}`, label: d.item_description, sub: 'Debt Register', amount_minor: d.amount_minor - d.amount_recovered_minor })),
    ...visibleJobDebts.map((j) => ({ key: `P:${j.complaint ?? 'Work order'}`, label: j.complaint ?? 'Work order', sub: 'Work Orders', amount_minor: j.balance_minor })),
  ]);

  function exportByPerson() {
    downloadCSV(`Oakland_Debt_By_Person_${new Date().toISOString().slice(0, 10)}.csv`, byPerson.map((r) => ({
      'Responsible Person': r.label, 'Source': r.sub, 'Entries': r.count, 'Outstanding (KES)': (r.amount_minor / 100).toFixed(2),
    })));
  }

  function exportRegister() {
    downloadCSV(`Oakland_Debt_Register_${new Date().toISOString().slice(0, 10)}.csv`, debts.map((d) => ({
      'Date': formatDate(d.incurred_date), 'Type': d.debt_type, 'Responsible': d.responsible_name, 'What': d.item_description,
      'Amount (KES)': (d.amount_minor / 100).toFixed(2), 'Recovered (KES)': (d.amount_recovered_minor / 100).toFixed(2),
      'Balance (KES)': ((d.amount_minor - d.amount_recovered_minor) / 100).toFixed(2), 'Status': d.status,
    })));
  }

  if (loading) return <div className="empty"><strong>Loading...</strong></div>;

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Accountability</p><h1>Debt Reports</h1><p className="muted">Who&apos;s responsible, and what caused it — across the debt register and open work orders.</p></div>
      <div className="heading-actions"><button className="button secondary" onClick={exportRegister}><Download size={16} /> Export register CSV</button></div>
    </div>

    <div className="metric-grid" style={{ marginBottom: 18 }}>
      <div className="metric-card"><div className="metric-icon red"><AlertTriangle size={18} /></div><div className="metric-copy"><span>Total Outstanding</span><strong>{formatKes(totalOutstanding)}</strong><small>{visibleDebts.length + visibleJobDebts.length} open item{visibleDebts.length + visibleJobDebts.length === 1 ? '' : 's'}</small></div></div>
      <div className="metric-card"><div className="metric-copy"><span>Customer debt</span><strong>{formatKes(customerOutstanding)}</strong></div></div>
      <div className="metric-card"><div className="metric-copy"><span>Staff liability</span><strong>{formatKes(staffOutstanding)}</strong></div></div>
      <div className="metric-card"><div className="metric-icon green"><CheckCircle2 size={18} /></div><div className="metric-copy"><span>Recovered (all-time)</span><strong>{formatKes(totalRecovered)}</strong></div></div>
      <div className="metric-card"><div className="metric-icon navy"><Ban size={18} /></div><div className="metric-copy"><span>Written off</span><strong>{formatKes(writtenOffAmount)}</strong><small>{writtenOff.length} debt{writtenOff.length === 1 ? '' : 's'}</small></div></div>
    </div>

    <div className="chip-row" style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
      <button className={`chip ${typeFilter === 'ALL' ? 'active' : ''}`} onClick={() => setTypeFilter('ALL')}>All debt</button>
      <button className={`chip ${typeFilter === 'CUSTOMER' ? 'active' : ''}`} onClick={() => setTypeFilter('CUSTOMER')}>Customer debt</button>
      <button className={`chip ${typeFilter === 'STAFF' ? 'active' : ''}`} onClick={() => setTypeFilter('STAFF')}>Staff liability</button>
    </div>

    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Ranked</p><h3>Debt by Responsible Person</h3></div><button className="text-button" onClick={exportByPerson}><Download size={13} /> CSV</button></div>
        {byPerson.length === 0 ? <div className="empty"><strong>Nothing outstanding</strong></div> : <RankedTable rows={byPerson} headLabel="Unknown" />}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Ranked</p><h3>Debt by Product / Service</h3></div></div>
        {byProduct.length === 0 ? <div className="empty"><strong>Nothing outstanding</strong></div> : <div style={{ maxHeight: 420, overflowY: 'auto' }}><RankedTable rows={byProduct} headLabel="—" /></div>}
      </section>
    </div>

    {includeJobDebts && <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Live from Work Orders</p><h3>Open Work Order Balances, by Technician</h3></div></div>
      {jobDebts.length === 0 ? <div className="empty"><Wrench size={18} /><strong>No open balances</strong><span>Every work order is settled.</span></div> : <div className="report-table-wrap"><table className="report-table"><thead><tr>
        <th>Job Number</th><th>Vehicle</th><th>Customer</th><th>Complaint</th><th>Technician</th><th>Balance</th><th />
      </tr></thead><tbody>{jobDebts.map((j) => <tr key={j.id} className={onSelectJob ? 'clickable' : ''} onClick={() => onSelectJob?.(j.id)}>
        <td><strong>{j.job_number}</strong></td><td>{j.registration_number ?? '—'}</td><td>{j.customer_name ?? '—'}</td><td>{j.complaint ?? '—'}</td>
        <td>{j.technician_name ?? <span className="muted">Unassigned</span>}</td>
        <td style={{ fontWeight: 800, color: '#a4493d' }}>{formatKes(j.balance_minor)}</td>
        <td>{onSelectJob && <ChevronRight size={16} className="row-arrow" />}</td>
      </tr>)}</tbody></table></div>}
    </section>}
  </>;
}
