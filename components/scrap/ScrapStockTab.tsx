import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCurrentStockRow, ScrapPurchase, ScrapStockAdjustment, StockCycle, ScrapClearanceSale } from '@/lib/types';
import { formatKes, formatKg, formatDate, formatDateTime } from '@/lib/formatting';
import { statusStyles } from '@/lib/constants';
import { ArrowUpDown, ChevronRight, Boxes, PackageMinus, RotateCcw, CircleDollarSign } from 'lucide-react';
import { ScrapClearanceSaleForm } from './ScrapStockActions';

type SortKey = 'name' | 'quantity' | 'rate' | 'value';

export default function ScrapStockTab({ stock, can, onClear, onNewCycle, onNotice, onRefresh }: {
  stock: ScrapCurrentStockRow[];
  can: (p: string) => boolean;
  onClear: () => void;
  onNewCycle: () => void;
  onNotice: (m: string) => void;
  onRefresh: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...stock].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'quantity') return (a.current_quantity - b.current_quantity) * dir;
      if (sortKey === 'rate') return ((a.current_rate_minor ?? -1) - (b.current_rate_minor ?? -1)) * dir;
      const av = a.current_quantity * (a.current_rate_minor ?? 0);
      const bv = b.current_quantity * (b.current_rate_minor ?? 0);
      return (av - bv) * dir;
    });
  }, [stock, sortKey, sortDir]);

  const totalKg = stock.reduce((sum, s) => sum + s.current_quantity, 0);
  const totalValueMinor = stock.reduce((sum, s) => sum + s.current_quantity * (s.current_rate_minor ?? 0), 0);

  const selected = stock.find((s) => s.scrap_item_id === selectedItemId) ?? null;

  if (selected) {
    return <ScrapItemHistory item={selected} can={can} onBack={() => setSelectedItemId(null)} onNotice={onNotice} onRefresh={onRefresh} />;
  }

  return (
    <div>
      <div className="panel-heading">
        <div><p className="eyebrow">Stock position</p><h3>Current stock by scrap type</h3></div>
        {can('scrap.manage') && <div className="action-buttons">
          <button className="button secondary small" onClick={onNewCycle}><RotateCcw size={14} /> Start new cycle</button>
          <button className="button primary small" onClick={onClear}><PackageMinus size={14} /> Clear / adjust stock</button>
        </div>}
      </div>

      <div className="detail-info-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: 18 }}>
        <div className="info-card"><Boxes size={16} /><div><span>Total current stock</span><strong>{formatKg(totalKg)}</strong></div></div>
        <div className="info-card"><CircleDollarSign size={16} /><div><span>Estimated purchase value (informational)</span><strong>{formatKes(totalValueMinor)}</strong></div></div>
      </div>

      <div className="panel">
        <div className="data-table">
          <div className="table-row" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8997a5', fontWeight: 800 }}>
            <button className="sortable-th" onClick={() => toggleSort('name')}>Scrap type <ArrowUpDown size={11} /></button>
            <button className="sortable-th" onClick={() => toggleSort('quantity')}>Current stock <ArrowUpDown size={11} /></button>
            <button className="sortable-th" onClick={() => toggleSort('rate')}>Rate/kg <ArrowUpDown size={11} /></button>
            <button className="sortable-th" onClick={() => toggleSort('value')}>Est. value <ArrowUpDown size={11} /></button>
          </div>
          {sorted.map((item) => (
            <div className="table-row clickable" key={item.scrap_item_id} onClick={() => setSelectedItemId(item.scrap_item_id)}>
              <div><strong>{item.name}</strong>{item.current_quantity === 0 && <span>Zero stock</span>}</div>
              <span className="table-muted">{formatKg(item.current_quantity)}</span>
              <span className="table-muted">{item.current_rate_minor === null ? 'Not set' : formatKes(item.current_rate_minor)}</span>
              <span className="table-muted">{formatKes(item.current_quantity * (item.current_rate_minor ?? 0))}</span>
              <ChevronRight size={16} className="row-arrow" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type TimelineRow = {
  key: string;
  date: string;
  cycleNumber: number;
  type: 'PURCHASE' | 'CLEARANCE' | 'OPENING' | 'CORRECTION_INCREASE' | 'CORRECTION_DECREASE';
  before: number;
  change: number;
  after: number;
  detail: string;
  adjustment?: ScrapStockAdjustment;
};

function ScrapItemHistory({ item, can, onBack, onNotice, onRefresh }: {
  item: ScrapCurrentStockRow; can: (p: string) => boolean; onBack: () => void; onNotice: (m: string) => void; onRefresh: () => void;
}) {
  const [cycles, setCycles] = useState<StockCycle[]>([]);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [clearanceSales, setClearanceSales] = useState<ScrapClearanceSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saleTarget, setSaleTarget] = useState<ScrapStockAdjustment | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const [{ data: cycleRows }, { data: purchases }, { data: adjustments }, { data: sales }] = await Promise.all([
        supabase.from('stock_cycles').select('*').eq('scrap_item_id', item.scrap_item_id).order('cycle_number'),
        supabase.from('scrap_purchases').select('*, scrap_daily_records(date)').eq('scrap_item_id', item.scrap_item_id).order('created_at'),
        supabase.from('scrap_stock_adjustments').select('*').eq('scrap_item_id', item.scrap_item_id).order('created_at'),
        can('scrap.manage') ? supabase.from('scrap_clearance_sales').select('*') : Promise.resolve({ data: [] }),
      ]);
      if (!mounted) return;
      const cycleList = (cycleRows ?? []) as StockCycle[];
      const cycleNumberById = new Map(cycleList.map((c) => [c.id, c.cycle_number]));

      const purchaseRows: TimelineRow[] = ((purchases ?? []) as (ScrapPurchase & { scrap_daily_records: { date: string } | null })[]).map((p) => ({
        key: `p-${p.id}`,
        date: p.date ?? p.scrap_daily_records?.date ?? p.created_at,
        cycleNumber: cycleNumberById.get(p.stock_cycle_id) ?? 0,
        type: 'PURCHASE',
        before: p.opening_stock,
        change: p.quantity_purchased,
        after: p.closing_stock,
        detail: `Purchased at ${formatKes(p.rate_used_minor)}/kg — ${formatKes(p.purchase_amount_minor)}`,
      }));

      const adjustmentRows: TimelineRow[] = ((adjustments ?? []) as ScrapStockAdjustment[]).map((a) => ({
        key: `a-${a.id}`,
        date: a.date,
        cycleNumber: cycleNumberById.get(a.stock_cycle_id) ?? 0,
        type: a.adjustment_type,
        before: a.previous_stock,
        change: a.adjustment_type === 'CLEARANCE' || a.adjustment_type === 'CORRECTION_DECREASE' ? -a.quantity : a.quantity,
        after: a.resulting_stock,
        detail: `${a.reason} — authorized by ${a.authorized_by}${a.notes ? ` · ${a.notes}` : ''}`,
        adjustment: a,
      }));

      const merged = [...purchaseRows, ...adjustmentRows].sort((x, y) => x.date.localeCompare(y.date) || x.key.localeCompare(y.key));
      setCycles(cycleList);
      setRows(merged);
      setClearanceSales((sales ?? []) as ScrapClearanceSale[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [item.scrap_item_id, can]);

  const saleByAdjustment = new Map(clearanceSales.map((s) => [s.stock_adjustment_id, s]));

  return (
    <div>
      <div className="back-bar"><button onClick={onBack}><ChevronRight size={16} className="back-icon" /> Stock position</button></div>
      <div className="detail-header">
        <div className="detail-avatar"><Boxes size={22} /></div>
        <div className="flex-1"><h2>{item.name}</h2><p className="muted">Current stock {formatKg(item.current_quantity)} · Cycle {item.cycle_number ?? '—'} · {item.current_rate_minor === null ? 'Rate not set' : `${formatKes(item.current_rate_minor)}/kg`}</p></div>
      </div>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow">Stock cycles</p><h3>Cycle summary</h3></div></div>
        <div className="data-table">
          {cycles.map((c) => (
            <div className="table-row" key={c.id}>
              <div><strong>Cycle {c.cycle_number}</strong><span>Opened {formatDate(c.opening_date)}{c.closing_date ? ` · Closed ${formatDate(c.closing_date)}` : ''}</span></div>
              <span className="table-muted">Opening {formatKg(c.opening_quantity)}</span>
              <span className="table-muted">{c.status === 'OPEN' ? `Current ${formatKg(c.current_quantity)}` : `Closing ${formatKg(c.closing_quantity ?? 0)}`}</span>
              <span className={`status ${statusStyles[c.status] ?? ''}`}>{c.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h3>Complete stock history</h3></div></div>
        {loading ? <div className="empty"><strong>Loading…</strong></div> : rows.length === 0 ? <div className="empty"><strong>No history yet</strong></div> : (
          <div className="data-table">
            {rows.map((r) => {
              const sale = r.adjustment ? saleByAdjustment.get(r.adjustment.id) : null;
              return (
                <div className="table-row" key={r.key}>
                  <div><strong>{formatDate(r.date)} · Cycle {r.cycleNumber}</strong><span>{r.detail}</span></div>
                  <span className={`status ${statusStyles[r.type] ?? ''}`}>{r.type.replaceAll('_', ' ')}</span>
                  <span className="table-muted">{formatKg(r.before)} → {formatKg(r.after)}</span>
                  {r.type === 'CLEARANCE' && can('scrap.manage') && (
                    sale
                      ? <span className="table-muted">Sold {formatKes(sale.amount_minor)}</span>
                      : <button className="button secondary small" onClick={() => setSaleTarget(r.adjustment!)}>Record proceeds</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {saleTarget && <ScrapClearanceSaleForm adjustment={saleTarget} onClose={() => setSaleTarget(null)} onSaved={(m) => { onNotice(m); onRefresh(); setSaleTarget(null); }} />}
    </div>
  );
}
