import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DebtRecord } from '@/lib/types';
import { formatKes, formatDate, downloadCSV } from '@/lib/formatting';
import { Download, Wrench } from 'lucide-react';
import { fetchJobCardDebts, type JobCardDebtRow } from './jobCardDebt';

type Row = { key: string; label: string; sub: string; amount_minor: number; count: number };

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

export default function DebtReportsPage() {
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [jobDebts, setJobDebts] = useState<JobCardDebtRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  const openDebts = debts.filter((d) => d.status !== 'WRITTEN_OFF');

  const byPerson = aggregate([
    ...openDebts.map((d) => ({ key: `M:${d.responsible_name}`, label: d.responsible_name, sub: 'Debt Register', amount_minor: d.amount_minor - d.amount_recovered_minor })),
    ...jobDebts.map((j) => ({ key: `W:${j.technician_name ?? 'Unassigned'}`, label: j.technician_name ?? 'Unassigned', sub: 'Work Orders', amount_minor: j.balance_minor })),
  ]);

  const byProduct = aggregate([
    ...openDebts.map((d) => ({ key: `P:${d.item_description}`, label: d.item_description, sub: 'Debt Register', amount_minor: d.amount_minor - d.amount_recovered_minor })),
    ...jobDebts.map((j) => ({ key: `P:${j.complaint ?? 'Work order'}`, label: j.complaint ?? 'Work order', sub: 'Work Orders', amount_minor: j.balance_minor })),
  ]);

  function exportByPerson() {
    downloadCSV(`Oakland_Debt_By_Person_${new Date().toISOString().slice(0, 10)}.csv`, byPerson.map((r) => ({
      'Responsible Person': r.label, 'Entries': r.count, 'Outstanding (KES)': (r.amount_minor / 100).toFixed(2),
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
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Ranked</p><h3>Debt by Responsible Person</h3></div><button className="text-button" onClick={exportByPerson}><Download size={13} /> CSV</button></div>
        {byPerson.length === 0 ? <div className="empty"><strong>Nothing outstanding</strong></div> : <table className="report-table"><thead><tr><th>Person</th><th>Source</th><th>Entries</th><th>Outstanding</th></tr></thead><tbody>
          {byPerson.map((r) => <tr key={r.key}><td><strong>{r.label}</strong></td><td><span className="status bg-slate-100 text-slate-600">{r.sub}</span></td><td>{r.count}</td><td style={{ fontWeight: 800, color: '#a4493d' }}>{formatKes(r.amount_minor)}</td></tr>)}
        </tbody></table>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Ranked</p><h3>Debt by Product / Service</h3></div></div>
        {byProduct.length === 0 ? <div className="empty"><strong>Nothing outstanding</strong></div> : <table className="report-table"><thead><tr><th>Product / Service</th><th>Source</th><th>Outstanding</th></tr></thead><tbody>
          {byProduct.slice(0, 12).map((r) => <tr key={r.key}><td>{r.label}</td><td><span className="status bg-slate-100 text-slate-600">{r.sub}</span></td><td style={{ fontWeight: 800, color: '#a4493d' }}>{formatKes(r.amount_minor)}</td></tr>)}
        </tbody></table>}
      </section>
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Live from Work Orders</p><h3>Open Work Order Balances, by Technician</h3></div></div>
      {jobDebts.length === 0 ? <div className="empty"><Wrench size={18} /><strong>No open balances</strong><span>Every work order is settled.</span></div> : <table className="report-table"><thead><tr>
        <th>Job Number</th><th>Vehicle</th><th>Customer</th><th>Complaint</th><th>Technician</th><th>Balance</th>
      </tr></thead><tbody>{jobDebts.map((j) => <tr key={j.id}>
        <td><strong>{j.job_number}</strong></td><td>{j.registration_number ?? '—'}</td><td>{j.customer_name ?? '—'}</td><td>{j.complaint ?? '—'}</td>
        <td>{j.technician_name ?? <span className="muted">Unassigned</span>}</td>
        <td style={{ fontWeight: 800, color: '#a4493d' }}>{formatKes(j.balance_minor)}</td>
      </tr>)}</tbody></table>}
    </section>
  </>;
}
