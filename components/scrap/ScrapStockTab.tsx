import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCurrentStockRow, ScrapPurchase, ScrapStockAdjustment, StockCycle, ScrapClearanceSale } from '@/lib/types';
import { formatKes, formatKg, formatDate, formatDateTime } from '@/lib/formatting';
import { statusStyles, byScrapTypeOrder, SCRAP_TYPE_ORDER, scrapGroupLabel } from '@/lib/constants';
import { ArrowUpDown, ChevronRight, ChevronDown, Boxes, PackageMinus, RotateCcw, CircleDollarSign, Printer, X } from 'lucide-react';
import { ScrapClearanceSaleForm } from './ScrapStockActions';

type SortKey = 'name' | 'quantity' | 'rate' | 'value';

type StockGroup = { label: string; members: ScrapCurrentStockRow[]; quantity: number; value: number; blendedRate: number | null };

function groupOrderIndex(members: ScrapCurrentStockRow[]): number {
  const indices = members.map((m) => SCRAP_TYPE_ORDER.findIndex((n) => n.toLowerCase() === m.name.trim().toLowerCase()));
  const valid = indices.filter((i) => i !== -1);
  return valid.length > 0 ? Math.min(...valid) : Infinity;
}

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function toggleExpanded(label: string) {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(label)) next.delete(label); else next.add(label); return next; });
  }

  // Heavy 1/2, Light 1/2 and ND 1/2 are the same scrap type at different supplier
  // rates — combined into one line here; every other type (including Battery 1/2,
  // which are genuinely different grades) stays as its own single-member group.
  const groups = useMemo(() => {
    const map = new Map<string, ScrapCurrentStockRow[]>();
    for (const item of stock) {
      const label = scrapGroupLabel(item.name);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(item);
    }
    return Array.from(map.entries()).map(([label, members]): StockGroup => {
      const sortedMembers = [...members].sort(byScrapTypeOrder);
      const quantity = members.reduce((s, m) => s + m.current_quantity, 0);
      const value = members.reduce((s, m) => s + m.current_quantity * (m.current_rate_minor ?? 0), 0);
      return { label, members: sortedMembers, quantity, value, blendedRate: quantity > 0 ? Math.round(value / quantity) : null };
    });
  }, [stock]);

  const sortedGroups = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...groups].sort((a, b) => {
      if (sortKey === 'name') {
        const ai = groupOrderIndex(a.members); const bi = groupOrderIndex(b.members);
        if (ai !== bi) return (ai - bi) * dir;
        return a.label.localeCompare(b.label) * dir;
      }
      if (sortKey === 'quantity') return (a.quantity - b.quantity) * dir;
      if (sortKey === 'rate') return ((a.blendedRate ?? -1) - (b.blendedRate ?? -1)) * dir;
      return (a.value - b.value) * dir;
    });
  }, [groups, sortKey, sortDir]);

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
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th><button className="sortable-th" onClick={() => toggleSort('name')}>Scrap Type <ArrowUpDown size={11} /></button></th>
              <th className="numeric"><button className="sortable-th" onClick={() => toggleSort('quantity')}>Current Stock <ArrowUpDown size={11} /></button></th>
              <th className="numeric"><button className="sortable-th" onClick={() => toggleSort('rate')}>Rate / Kg <ArrowUpDown size={11} /></button></th>
              <th className="numeric"><button className="sortable-th" onClick={() => toggleSort('value')}>Est. Value <ArrowUpDown size={11} /></button></th>
            </tr></thead>
            <tbody>
              {sortedGroups.map((group) => {
                const isMerged = group.members.length > 1;
                const isOpen = expanded.has(group.label);
                if (!isMerged) {
                  const item = group.members[0];
                  return <tr key={group.label} className="clickable" onClick={() => setSelectedItemId(item.scrap_item_id)}>
                    <td><strong>{item.name}</strong>{item.current_quantity === 0 && <span className="table-subtext">Zero stock</span>}</td>
                    <td className="numeric">{formatKg(item.current_quantity)}</td>
                    <td className="numeric">{item.current_rate_minor === null ? 'Not set' : formatKes(item.current_rate_minor)}</td>
                    <td className="numeric">{formatKes(item.current_quantity * (item.current_rate_minor ?? 0))}</td>
                  </tr>;
                }
                return <React.Fragment key={group.label}>
                  <tr className="clickable" onClick={() => toggleExpanded(group.label)}>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<strong>{group.label}</strong></span>{group.quantity === 0 && <span className="table-subtext">Zero stock</span>}</td>
                    <td className="numeric">{formatKg(group.quantity)}</td>
                    <td className="numeric">{group.blendedRate === null ? 'Not set' : `~${formatKes(group.blendedRate)}`}</td>
                    <td className="numeric">{formatKes(group.value)}</td>
                  </tr>
                  {isOpen && group.members.map((item) => (
                    <tr key={item.scrap_item_id} className="clickable" onClick={() => setSelectedItemId(item.scrap_item_id)} style={{ background: '#fafcff' }}>
                      <td style={{ paddingLeft: 34 }}>{item.name}{item.current_quantity === 0 && <span className="table-subtext">Zero stock</span>}</td>
                      <td className="numeric">{formatKg(item.current_quantity)}</td>
                      <td className="numeric">{item.current_rate_minor === null ? 'Not set' : formatKes(item.current_rate_minor)}</td>
                      <td className="numeric">{formatKes(item.current_quantity * (item.current_rate_minor ?? 0))}</td>
                    </tr>
                  ))}
                </React.Fragment>;
              })}
            </tbody>
          </table>
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
  const [receiptRow, setReceiptRow] = useState<TimelineRow | null>(null);

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
              const isClearance = r.type === 'CLEARANCE';
              return (
                <div className={`table-row ${isClearance ? 'clickable' : ''}`} key={r.key} onClick={isClearance ? () => setReceiptRow(r) : undefined}>
                  <div><strong>{formatDate(r.date)} · Cycle {r.cycleNumber}</strong><span>{r.detail}</span></div>
                  <span className={`status ${statusStyles[r.type] ?? ''}`}>{r.type.replaceAll('_', ' ')}</span>
                  <span className="table-muted">{formatKg(r.before)} → {formatKg(r.after)}</span>
                  {isClearance && can('scrap.manage') && (
                    sale
                      ? <span className="table-muted">Sold {formatKes(sale.amount_minor)}</span>
                      : <button className="button secondary small" onClick={(e) => { e.stopPropagation(); setSaleTarget(r.adjustment!); }}>Record proceeds</button>
                  )}
                  {isClearance && <ChevronRight size={16} className="row-arrow" />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {saleTarget && <ScrapClearanceSaleForm adjustment={saleTarget} onClose={() => setSaleTarget(null)} onSaved={(m) => { onNotice(m); onRefresh(); setSaleTarget(null); }} />}
      {receiptRow?.adjustment && <ReconciliationReceiptView itemName={item.name} cycleNumber={receiptRow.cycleNumber} adjustment={receiptRow.adjustment} sale={saleByAdjustment.get(receiptRow.adjustment.id) ?? null} onClose={() => setReceiptRow(null)} />}
    </div>
  );
}

export function ReconciliationReceiptView({ itemName, cycleNumber, adjustment, sale, onClose }: { itemName: string; cycleNumber: number; adjustment: ScrapStockAdjustment; sale: ScrapClearanceSale | null; onClose: () => void }) {
  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Reconciliation receipt — {itemName} · {formatDate(adjustment.date)}</strong>
        <div className="action-buttons">
          <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="close-button" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div id="print-area" className="print-sheet">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd. — Scrap Yard</h1><p className="muted">Stock reconciliation receipt</p></div>
          <div style={{ textAlign: 'right' }}>
            <p className="print-field"><span>Date</span><strong style={{ fontSize: 18 }}>{formatDate(adjustment.date)}</strong></p>
            <p className="print-field"><span>Cycle</span><strong>{cycleNumber}</strong></p>
          </div>
        </div>
        <div className="print-section">
          <h4>Scrap type</h4>
          <p className="print-field"><strong style={{ fontSize: 16 }}>{itemName}</strong></p>
        </div>
        <div className="print-section">
          <h4>Reconciliation</h4>
          <table className="print-table"><tbody>
            <tr><td>Stock before clearance (loaded &amp; measured)</td><td>{formatKg(adjustment.previous_stock)}</td></tr>
            <tr><td>Quantity cleared</td><td>-{formatKg(adjustment.quantity)}</td></tr>
            <tr><td><strong>Stock remaining — carries forward as opening stock</strong></td><td><strong>{formatKg(adjustment.resulting_stock)}</strong></td></tr>
          </tbody></table>
        </div>
        <div className="print-section">
          <h4>Confirmation</h4>
          <p className="print-field"><span>Reason</span><strong>{adjustment.reason}</strong></p>
          <p className="print-field"><span>Authorized by</span><strong>{adjustment.authorized_by}</strong></p>
          {adjustment.notes && <p className="print-field"><span>Notes</span><strong>{adjustment.notes}</strong></p>}
        </div>
        {sale && <div className="print-section">
          <h4>Proceeds</h4>
          <p className="print-field"><span>Amount received</span><strong>{formatKes(sale.amount_minor)}</strong></p>
          {sale.buyer && <p className="print-field"><span>Buyer</span><strong>{sale.buyer}</strong></p>}
          {sale.reference && <p className="print-field"><span>Reference</span><strong>{sale.reference}</strong></p>}
        </div>}
        <div className="signature-grid">
          <div className="signature-box">Measured by<span>Signature</span></div>
          <div className="signature-box">Cleared by<span>Signature</span></div>
          <div className="signature-box">Authorized by<span>Signature</span></div>
        </div>
      </div>
    </div>
  );
}
