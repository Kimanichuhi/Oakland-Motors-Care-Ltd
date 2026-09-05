import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCashSummary } from '@/lib/types';
import { formatKes, formatKg, formatDate } from '@/lib/formatting';
import { Search, ChevronRight, Calendar } from 'lucide-react';
import ScrapDailyDetail from './ScrapDailyDetail';

export default function ScrapRecordsHistory({ can, onNotice, onRefresh, refreshKey }: {
  can: (p: string) => boolean; onNotice: (m: string) => void; onRefresh: () => void; refreshKey: number;
}) {
  const [days, setDays] = useState<ScrapCashSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
      </div>

      <div className="topbar-search" style={{ marginBottom: 14, maxWidth: 320 }}>
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by date..." />
      </div>
      <div className="form-row modal-form" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <label>From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label>To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        <label>Sort<select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
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
    </div>
  );
}
