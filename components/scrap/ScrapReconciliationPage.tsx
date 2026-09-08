import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCurrentStockRow, ScrapStockAdjustment } from '@/lib/types';
import { formatKes, formatKg, formatDate, localDateStr, downloadCSV } from '@/lib/formatting';
import { byScrapTypeOrder, SCRAP_RECONCILIATION_REASONS } from '@/lib/constants';
import { Scale, AlertTriangle, TrendingDown, TrendingUp, Download, CircleDollarSign } from 'lucide-react';

type ReconciliationAdjustment = ScrapStockAdjustment & { scrap_items: { name: string; current_rate_minor: number | null } | null };

export default function ScrapReconciliationPage({ can, onNotice }: { can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [stock, setStock] = useState<ScrapCurrentStockRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [scrapItemId, setScrapItemId] = useState('');
  const [counted, setCounted] = useState('');
  const [date, setDate] = useState(localDateStr());
  const [reasonCategory, setReasonCategory] = useState<string>(SCRAP_RECONCILIATION_REASONS[0]);
  const [reasonCustom, setReasonCustom] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [history, setHistory] = useState<ReconciliationAdjustment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    supabase.from('scrap_current_stock').select('*').order('name').then(({ data }) => {
      setStock(((data ?? []) as ScrapCurrentStockRow[]).sort(byScrapTypeOrder));
    });
  }, [refreshKey]);

  useEffect(() => {
    setHistoryLoading(true);
    let q = supabase.from('scrap_stock_adjustments').select('*, scrap_items(name, current_rate_minor)').in('adjustment_type', ['CORRECTION_INCREASE', 'CORRECTION_DECREASE']).order('date', { ascending: false });
    if (fromDate) q = q.gte('date', fromDate);
    if (toDate) q = q.lte('date', toDate);
    q.then(({ data }) => { setHistory((data ?? []) as ReconciliationAdjustment[]); setHistoryLoading(false); });
  }, [refreshKey, fromDate, toDate]);

  const selected = stock.find((s) => s.scrap_item_id === scrapItemId) ?? null;
  const countedNum = parseFloat(counted);
  const variance = selected && counted.trim() !== '' && !isNaN(countedNum) ? countedNum - selected.current_quantity : null;
  const resolvedReason = reasonCategory === 'Other' && reasonCustom.trim() ? reasonCustom.trim() : reasonCategory;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!selected) { setError('Select a scrap type.'); return; }
    if (counted.trim() === '' || isNaN(countedNum) || countedNum < 0) { setError('Enter the counted quantity.'); return; }
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('scrap_record_stock_count', {
      p_scrap_item_id: scrapItemId, p_counted_quantity: countedNum, p_reason: resolvedReason, p_notes: notes || null, p_date: date,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Unable to record the stock count.'); return; }
    const adj = data as ScrapStockAdjustment;
    onNotice(`${adj.adjustment_type === 'CORRECTION_DECREASE' ? 'Shortage' : 'Overage'} of ${formatKg(adj.quantity)} recorded for ${selected.name}.`);
    setScrapItemId(''); setCounted(''); setReasonCategory(SCRAP_RECONCILIATION_REASONS[0]); setReasonCustom(''); setNotes('');
    setRefreshKey((k) => k + 1);
  }

  const totalShortage = history.filter((h) => h.adjustment_type === 'CORRECTION_DECREASE').reduce((s, h) => s + h.quantity, 0);
  const totalOverage = history.filter((h) => h.adjustment_type === 'CORRECTION_INCREASE').reduce((s, h) => s + h.quantity, 0);
  const shortageValue = history.filter((h) => h.adjustment_type === 'CORRECTION_DECREASE').reduce((s, h) => s + h.quantity * (h.scrap_items?.current_rate_minor ?? 0), 0);

  function exportCSV() {
    downloadCSV(`Oakland_Scrap_Reconciliation_${new Date().toISOString().slice(0, 10)}.csv`, history.map((h) => ({
      'Date': h.date, 'Scrap Type': h.scrap_items?.name ?? '', 'Expected (KG)': h.previous_stock, 'Counted (KG)': h.resulting_stock,
      'Variance (KG)': h.adjustment_type === 'CORRECTION_DECREASE' ? -h.quantity : h.quantity, 'Type': h.adjustment_type.replaceAll('_', ' '),
      'Reason': h.reason, 'Authorized By': h.authorized_by, 'Notes': h.notes ?? '',
    })));
  }

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Scrap yard</p><h1>Reconciliation</h1><p className="muted">Compare what was cleared against what the books expected, and track the difference for transparency.</p></div>
        {can('scrap.manage') && <div className="heading-actions"><button className="button secondary" onClick={exportCSV} disabled={history.length === 0}><Download size={16} /> Export CSV</button></div>}
      </div>

      {can('scrap.manage') && (
        <section className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-heading"><div><p className="eyebrow">Physical count</p><h3>Record a stock count</h3></div></div>
          <form onSubmit={submit} className="modal-form">
            <label>Scrap type<select value={scrapItemId} onChange={(e) => { setScrapItemId(e.target.value); setCounted(''); }} required>
              <option value="">Select scrap type...</option>
              {stock.map((s) => <option key={s.scrap_item_id} value={s.scrap_item_id}>{s.name}</option>)}
            </select></label>

            {selected && <div className="detail-info-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
              <div className="info-card"><Scale size={16} /><div><span>Expected (system)</span><strong>{formatKg(selected.current_quantity)}</strong></div></div>
              <div className="info-card">{variance !== null && variance < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}<div><span>Variance</span><strong style={{ color: variance === null ? undefined : variance < 0 ? '#a4493d' : variance > 0 ? '#2a805d' : undefined }}>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${formatKg(variance)}`}</strong></div></div>
            </div>}

            <div className="form-row">
              <label>Counted quantity (KG)<input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} required disabled={!selected} /></label>
              <label>Date<input type="date" value={date} max={localDateStr()} onChange={(e) => setDate(e.target.value)} required /></label>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: reasonCategory === 'Other' ? '1fr 1fr' : '1fr' }}>
              <label>Reason<select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>{SCRAP_RECONCILIATION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              {reasonCategory === 'Other' && <label>Specify<input value={reasonCustom} onChange={(e) => setReasonCustom(e.target.value)} required /></label>}
            </div>
            <label>Notes <span className="optional">Optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
            <button className="button primary wide" disabled={busy || !selected || variance === 0 || (reasonCategory === 'Other' && !reasonCustom.trim())}>{busy ? 'Recording...' : 'Record reconciliation'}</button>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Transparency report</p><h3>Missing / excess stock</h3></div></div>
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="From" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} title="To" />
        </div>

        {!historyLoading && history.length > 0 && <div className="kpi-row" style={{ marginBottom: 18 }}>
          <div className="metric-card"><div className="metric-icon red"><TrendingDown size={17} /></div><div className="metric-copy"><span>Total missing</span><strong>{formatKg(totalShortage)}</strong></div></div>
          <div className="metric-card"><div className="metric-icon green"><TrendingUp size={17} /></div><div className="metric-copy"><span>Total excess</span><strong>{formatKg(totalOverage)}</strong></div></div>
          <div className="metric-card"><div className="metric-icon gold"><CircleDollarSign size={17} /></div><div className="metric-copy"><span>Est. value of missing stock</span><strong>{formatKes(shortageValue)}</strong></div></div>
          <div className="metric-card"><div className="metric-icon navy"><Scale size={17} /></div><div className="metric-copy"><span>Reconciliation events</span><strong>{history.length}</strong></div></div>
        </div>}

        {historyLoading ? <div className="empty"><strong>Loading…</strong></div> : history.length === 0 ? (
          <div className="empty"><Scale size={18} /><strong>No reconciliations recorded</strong><span>Record a stock count above when a physical count differs from the books.</span></div>
        ) : (
          <div className="report-table-wrap"><table className="report-table">
            <thead><tr><th>Date</th><th>Scrap Type</th><th className="numeric">Expected</th><th className="numeric">Counted</th><th className="numeric">Variance</th><th>Reason</th><th>Authorized By</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.date)}</td>
                <td>{h.scrap_items?.name ?? '—'}</td>
                <td className="numeric">{formatKg(h.previous_stock)}</td>
                <td className="numeric">{formatKg(h.resulting_stock)}</td>
                <td className="numeric"><span className={`status ${h.adjustment_type === 'CORRECTION_DECREASE' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{h.adjustment_type === 'CORRECTION_DECREASE' ? '-' : '+'}{formatKg(h.quantity)}</span></td>
                <td>{h.reason}</td>
                <td>{h.authorized_by}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
