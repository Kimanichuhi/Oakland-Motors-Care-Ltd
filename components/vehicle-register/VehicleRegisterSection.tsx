import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VehicleRegisterEntry } from '@/lib/types';
import { formatDate, formatTime, localDateStr, downloadCSV } from '@/lib/formatting';
import {
  Plus, Search, ArrowUpDown, ChevronRight, ChevronLeft, LogOut, Pencil,
  CarFront, DoorOpen, LogIn, Download, Printer, ClipboardList,
} from 'lucide-react';
import VehicleRegisterForm from './VehicleRegisterForm';
import { VehicleTimeOutConfirm, VehicleHistoryModal } from './VehicleRegisterExtras';

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type StatusFilter = 'all' | 'inside' | 'departed';
type SortColumn = 'date' | 'time_in' | 'time_out' | 'registration_number' | 'make_model';
const PAGE_SIZE = 25;

function vehicleDuration(timeIn: string, timeOut: string | null): string | null {
  if (!timeOut) return null;
  const [h1, m1] = timeIn.split(':').map(Number);
  const [h2, m2] = timeOut.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function dateRangeFor(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (preset === 'today') { const s = localDateStr(now); return { from: s, to: s }; }
  if (preset === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); const s = localDateStr(d); return { from: s, to: s }; }
  if (preset === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now); monday.setDate(now.getDate() - diff);
    return { from: localDateStr(monday), to: localDateStr(now) };
  }
  if (preset === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: localDateStr(first), to: localDateStr(now) };
  }
  return { from: customFrom, to: customTo };
}

export default function VehicleRegisterSection({ can, onNotice }: { can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [rows, setRows] = useState<VehicleRegisterEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState(localDateStr());
  const [customTo, setCustomTo] = useState(localDateStr());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const [kpis, setKpis] = useState({ today: 0, inside: 0, departed: 0 });

  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<VehicleRegisterEntry | null>(null);
  const [timeOutEntry, setTimeOutEntry] = useState<VehicleRegisterEntry | null>(null);
  const [historyReg, setHistoryReg] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(0); }, [datePreset, customFrom, customTo, statusFilter, sortColumn, sortDir]);

  const { from: fromDate, to: toDate } = useMemo(() => dateRangeFor(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      let q = supabase.from('vehicle_register').select('*', { count: 'exact' }).eq('status', 'ACTIVE');
      if (fromDate) q = q.gte('date', fromDate);
      if (toDate) q = q.lte('date', toDate);
      if (statusFilter === 'inside') q = q.is('time_out', null);
      if (statusFilter === 'departed') q = q.not('time_out', 'is', null);
      if (search) q = q.or(`registration_number.ilike.%${search}%,make_model.ilike.%${search}%`);
      q = q.order(sortColumn, { ascending: sortDir === 'asc' });
      if (sortColumn === 'date') q = q.order('time_in', { ascending: sortDir === 'asc' });
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, count } = await q;
      if (!mounted) return;
      setRows((data ?? []) as VehicleRegisterEntry[]);
      setTotalCount(count ?? 0);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [fromDate, toDate, statusFilter, search, sortColumn, sortDir, page, refreshKey]);

  useEffect(() => {
    let mounted = true;
    async function loadKpis() {
      const todayStr = localDateStr();
      const [{ count: today }, { count: inside }, { count: departed }] = await Promise.all([
        supabase.from('vehicle_register').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').eq('date', todayStr),
        supabase.from('vehicle_register').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').eq('date', todayStr).is('time_out', null),
        supabase.from('vehicle_register').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').eq('date', todayStr).not('time_out', 'is', null),
      ]);
      if (!mounted) return;
      setKpis({ today: today ?? 0, inside: inside ?? 0, departed: departed ?? 0 });
    }
    void loadKpis();
    return () => { mounted = false; };
  }, [refreshKey]);

  function refresh() { setRefreshKey((k) => k + 1); }
  function toggleSort(col: SortColumn) {
    if (sortColumn === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortColumn(col); setSortDir('desc'); }
  }

  function exportCsv() {
    downloadCSV('oakland-vehicle-register.csv', rows.map((r) => ({
      date: r.date, registration_number: r.registration_number, make_model: r.make_model,
      time_in: formatTime(r.time_in), time_out: formatTime(r.time_out),
    })));
  }

  const periodLabel = fromDate === toDate ? formatDate(fromDate) : `${formatDate(fromDate)} – ${formatDate(toDate)}`;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Front desk</p><h1>Vehicle Register</h1><p className="muted">Record and monitor vehicles entering and leaving Oakland Motor Care Ltd.</p></div>
        <div className="heading-actions">
          {can('vehicle_register.manage') && <button className="button secondary" onClick={exportCsv}><Download size={16} /> Export Excel</button>}
          {can('vehicle_register.manage') && <button className="button secondary" onClick={() => setShowPrint(true)}><Printer size={16} /> Print</button>}
          {(can('vehicle_register.record') || can('vehicle_register.manage')) && <button className="button primary" onClick={() => setShowForm(true)}><Plus size={16} /> Register Vehicle</button>}
        </div>
      </div>

      <div className="kpi-row">
        <div className="metric-card"><div className="metric-icon navy"><CarFront size={17} /></div><div className="metric-copy"><span>Vehicles today</span><strong>{kpis.today}</strong></div></div>
        <div className="metric-card"><div className="metric-icon gold"><DoorOpen size={17} /></div><div className="metric-copy"><span>Currently inside</span><strong>{kpis.inside}</strong></div></div>
        <div className="metric-card"><div className="metric-icon green"><LogIn size={17} /></div><div className="metric-copy"><span>Departed today</span><strong>{kpis.departed}</strong></div></div>
      </div>

      <div className="topbar-search" style={{ marginBottom: 14, maxWidth: 320 }}>
        <Search size={15} />
        <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search vehicles..." />
      </div>

      <div className="form-row" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <label>Date filter<select value={datePreset} onChange={(e) => setDatePreset(e.target.value as DatePreset)}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom range</option>
        </select></label>
        {datePreset === 'custom' && <>
          <label>From<input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
          <label>To<input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
        </>}
        <label>Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">All</option>
          <option value="inside">Currently inside</option>
          <option value="departed">Departed</option>
        </select></label>
      </div>

      {loading ? <div className="empty"><strong>Loading…</strong></div> : rows.length === 0 ? (
        <div className="empty"><ClipboardList size={18} /><strong>No vehicles registered {datePreset === 'today' ? 'today' : 'for this period'}</strong><span>Start by clicking &quot;Register Vehicle&quot;.</span></div>
      ) : (
        <div className="panel table-panel">
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr>
                <th><button className="sortable-th" onClick={() => toggleSort('date')}>Date <ArrowUpDown size={11} /></button></th>
                <th><button className="sortable-th" onClick={() => toggleSort('registration_number')}>Reg. No. <ArrowUpDown size={11} /></button></th>
                <th><button className="sortable-th" onClick={() => toggleSort('make_model')}>Make / Model <ArrowUpDown size={11} /></button></th>
                <th><button className="sortable-th" onClick={() => toggleSort('time_in')}>Time In <ArrowUpDown size={11} /></button></th>
                <th><button className="sortable-th" onClick={() => toggleSort('time_out')}>Time Out <ArrowUpDown size={11} /></button></th>
                <th>Status</th>
                <th>Action</th>
              </tr></thead>
              <tbody>{rows.map((r) => {
                const duration = vehicleDuration(r.time_in, r.time_out);
                return <tr key={r.id}>
                  <td><strong>{formatDate(r.date)}</strong></td>
                  <td><button className="text-button" style={{ padding: 0 }} onClick={() => setHistoryReg(r.registration_number)}>{r.registration_number}</button></td>
                  <td>{r.make_model}</td>
                  <td>{formatTime(r.time_in)}</td>
                  <td>{r.time_out ? formatTime(r.time_out) : '—'}</td>
                  <td>{r.time_out
                    ? <><span className="status bg-slate-100 text-slate-600">Departed</span>{duration && <span className="table-subtext">{duration}</span>}</>
                    : <span className="status bg-emerald-50 text-emerald-700">Inside</span>}</td>
                  <td><div className="action-buttons">
                    {!r.time_out && (can('vehicle_register.record') || can('vehicle_register.manage')) && (
                      <button className="button secondary small" onClick={() => setTimeOutEntry(r)}><LogOut size={13} /> Time Out</button>
                    )}
                    {can('vehicle_register.manage') && (
                      <button className="button secondary small" onClick={() => setEditEntry(r)}><Pencil size={13} /> Edit</button>
                    )}
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="status-row" style={{ marginTop: 4 }}>
            <span className="muted">Showing {rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of {totalCount}</span>
            <div className="action-buttons">
              <button className="button secondary small" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft size={14} /> Prev</button>
              <button className="button secondary small" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}

      {showForm && <VehicleRegisterForm can={can} onClose={() => setShowForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {editEntry && <VehicleRegisterForm can={can} entry={editEntry} onClose={() => setEditEntry(null)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {timeOutEntry && <VehicleTimeOutConfirm entry={timeOutEntry} onClose={() => setTimeOutEntry(null)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {historyReg && <VehicleHistoryModal registrationNumber={historyReg} onClose={() => setHistoryReg(null)} />}
      {showPrint && <VehicleRegisterPrintView rows={rows} periodLabel={periodLabel} onClose={() => setShowPrint(false)} />}
    </div>
  );
}

function VehicleRegisterPrintView({ rows, periodLabel, onClose }: { rows: VehicleRegisterEntry[]; periodLabel: string; onClose: () => void }) {
  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Vehicle Register — {periodLabel}</strong>
        <div className="action-buttons">
          <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>
      <div id="print-area" className="print-sheet">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd.</h1><p className="muted">Vehicle Register</p><p className="muted">Period: {periodLabel}</p></div>
        </div>
        <table className="print-table">
          <thead><tr><th>Date</th><th>Reg. No.</th><th>Make / Model</th><th>Time In</th><th>Time Out</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.registration_number}</td><td>{r.make_model}</td><td>{formatTime(r.time_in)}</td><td>{r.time_out ? formatTime(r.time_out) : '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
