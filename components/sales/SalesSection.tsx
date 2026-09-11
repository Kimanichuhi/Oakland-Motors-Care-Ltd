import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Sale } from '@/lib/types';
import { formatKes, formatDateTime, downloadCSV, localDateStr } from '@/lib/formatting';
import { statusStyles } from '@/lib/constants';
import BulkSalesUploadDialog from '@/components/sales/BulkSalesUpload';
import { Plus, Search, MoreVertical, Eye, Download, Printer, X, Upload } from 'lucide-react';

type SaleItemRow = { part_name: string; part_sku: string; quantity: number; unit_price_minor: number; line_total_minor: number; shelf_count_at_sale: number | null; system_stock_after: number | null };
type SaleRow = Sale & { job_cards: { job_number: string } | null; sale_items: SaleItemRow[] };

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  WALK_IN: 'Walk In',
  JOB_CARD: 'Job Card',
  GARAGE_WORKSHOP: 'Garage Workshop',
  VEHICLE_OWNER: 'Vehicle Owner',
  BUSINESS: 'Business',
  OTHER: 'Other',
};

function productSummary(items: SaleItemRow[]): string {
  if (items.length === 0) return '—';
  if (items.length === 1) return items[0].part_name;
  return `${items[0].part_name} +${items.length - 1} more`;
}

function totalQuantity(items: SaleItemRow[]): number {
  return items.reduce((sum, it) => sum + it.quantity, 0);
}

function paymentSummary(s: Sale): string {
  const amount = formatKes(s.amount_paid_minor);
  if (s.payment_method === 'MPESA') return `M-Pesa ${s.payment_reference ?? ''} · ${amount}`.trim();
  if (s.payment_method === 'BANK') return `Banked${s.payment_reference ? ' ' + s.payment_reference : ''} · ${amount}`;
  if (s.payment_method === 'CASH') return `Cash · ${amount}`;
  return `${s.payment_method.replaceAll('_', ' ')} · ${amount}`;
}

function joinField(items: SaleItemRow[], pick: (i: SaleItemRow) => string | number | null): string {
  return items.map((i) => { const v = pick(i); return v === null || v === '' ? '—' : String(v); }).join('; ');
}

/** Groups rows by local sale day and returns each row tagged with its day's grand
 * total, populated only on the last row of each day — matching how the paper book
 * carries a single "Day Total" written once at the end of each day's entries. */
function withDayTotals(rows: SaleRow[]): { sale: SaleRow; dayTotalMinor: number | null }[] {
  const byDay = new Map<string, SaleRow[]>();
  for (const s of rows) {
    const day = localDateStr(new Date(s.sale_date));
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const out: { sale: SaleRow; dayTotalMinor: number | null }[] = [];
  for (const s of rows) {
    const day = localDateStr(new Date(s.sale_date));
    const dayRows = byDay.get(day) ?? [];
    const isLastOfDay = dayRows[dayRows.length - 1]?.id === s.id;
    out.push({ sale: s, dayTotalMinor: isLastOfDay ? dayRows.reduce((sum, r) => sum + r.total_minor, 0) : null });
  }
  return out;
}

function SaleRowMenu({ onView }: { onView: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row-menu" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="row-menu-trigger" onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
        <MoreVertical size={16} />
      </button>
      {open && <div className="row-menu-dropdown">
        <button type="button" onMouseDown={onView}><Eye size={14} /> View details</button>
      </div>}
    </div>
  );
}

export default function SalesSection({ query, onNew, onSelect, can, onNotice }: { query: string; onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [showPrint, setShowPrint] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      let q = supabase.from('sales').select('*, job_cards(job_number), sale_items(part_name, part_sku, quantity, unit_price_minor, line_total_minor, shelf_count_at_sale, system_stock_after)').order('sale_date', { ascending: false }).limit(200);
      if (query) q = q.or(`sale_number.ilike.%${query}%,customer_name.ilike.%${query}%,customer_phone.ilike.%${query}%`);
      const { data, error } = await q;
      if (!mounted) return;
      setLoadError(error ? error.message : '');
      setSales((data ?? []) as SaleRow[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [query, refreshKey]);

  const filteredSales = useMemo(() => {
    const term = productFilter.trim().toLowerCase();
    return sales.filter((s) => {
      const saleDay = localDateStr(new Date(s.sale_date));
      if (fromDate && saleDay < fromDate) return false;
      if (toDate && saleDay > toDate) return false;
      if (term && !s.sale_items.some((it) => it.part_name.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [sales, fromDate, toDate, productFilter]);

  // Day totals read naturally in chronological order within each day; the list itself stays newest-first.
  const chronological = useMemo(() => [...filteredSales].sort((a, b) => a.sale_date.localeCompare(b.sale_date)), [filteredSales]);
  const dayTotalBySaleId = useMemo(() => {
    const map = new Map<string, number>();
    for (const { sale, dayTotalMinor } of withDayTotals(chronological)) if (dayTotalMinor !== null) map.set(sale.id, dayTotalMinor);
    return map;
  }, [chronological]);

  const filterLabel = [
    fromDate || toDate ? `${fromDate || 'earliest'} to ${toDate || 'latest'}` : 'All dates',
    productFilter.trim() ? `Product: "${productFilter.trim()}"` : null,
  ].filter(Boolean).join(' · ');

  function exportCSV() {
    downloadCSV(`Oakland_Sales_${new Date().toISOString().slice(0, 10)}.csv`, withDayTotals(chronological).map(({ sale: s, dayTotalMinor }) => ({
      'Date': localDateStr(new Date(s.sale_date)),
      'Change in days': s.change_in_days,
      'Customer Name': s.customer_name ?? '',
      'Vehicle': s.vehicle_reg ?? '',
      'Vehicle model': s.vehicle_model ?? '',
      'Part/spare No': joinField(s.sale_items, (i) => i.part_sku),
      'Description-& part make': joinField(s.sale_items, (i) => i.part_name),
      'Quantity sold': totalQuantity(s.sale_items),
      'PRICE': joinField(s.sale_items, (i) => (i.unit_price_minor / 100).toFixed(2)),
      'Spares Total': (s.subtotal_minor / 100).toFixed(2),
      'Labour/Service': (s.labour_minor / 100).toFixed(2),
      'TOTAL': (s.total_minor / 100).toFixed(2),
      'Day Total': dayTotalMinor !== null ? (dayTotalMinor / 100).toFixed(2) : '',
      'CASH/MPESA/BANKED': paymentSummary(s),
      'DEBT': (s.balance_minor / 100).toFixed(2),
      'JOBCARD NO': s.job_cards?.job_number ?? '',
      'REMAINING STOCK AT SHELVES': joinField(s.sale_items, (i) => i.shelf_count_at_sale),
      'SYSTEM REMAINING STOCK': joinField(s.sale_items, (i) => i.system_stock_after),
      'Remarks': s.notes ?? '',
    })));
  }

  return (
    <div>
      <div className="panel-heading">
        <div><p className="eyebrow">Spare parts sales</p><h3>Sales</h3></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('sales.create') && <button className="button secondary" onClick={() => setShowBulkUpload(true)}><Upload size={15} /> Bulk upload</button>}
          {can('sales.create') && <button className="button primary" onClick={onNew}><Plus size={15} /> New sale</button>}
        </div>
      </div>
      {showBulkUpload && <BulkSalesUploadDialog onClose={() => setShowBulkUpload(false)} onSaved={(m) => { setShowBulkUpload(false); onNotice(m); setRefreshKey((k) => k + 1); }} canOverridePrice={can('sales.price.override')} />}

      <div className="form-row modal-form" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', alignItems: 'end', marginBottom: 12 }}>
        <label>From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label>To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        <label>Product<input value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder="Search by product name..." /></label>
      </div>
      <div className="action-buttons" style={{ marginBottom: 16 }}>
        <button type="button" className="button secondary small" onClick={exportCSV} disabled={filteredSales.length === 0}><Download size={15} /> Export CSV</button>
        <button type="button" className="button secondary small" onClick={() => setShowPrint(true)} disabled={filteredSales.length === 0}><Printer size={15} /> Print / Export PDF</button>
        {(fromDate || toDate || productFilter) && <button type="button" className="text-button" onClick={() => { setFromDate(''); setToDate(''); setProductFilter(''); }}>Clear filters</button>}
      </div>

      {loadError && <div className="form-error" style={{ marginBottom: 16 }}>Unable to load sales: {loadError}</div>}
      {loading ? <div className="empty"><strong>Loading…</strong></div> : filteredSales.length === 0 ? (
        <div className="empty"><Search size={18} /><strong>{sales.length === 0 ? 'No sales yet' : 'No sales match these filters'}</strong><span>{sales.length === 0 ? 'Completed sales will appear here.' : 'Try a wider date range or a different product.'}</span></div>
      ) : (
        <div className="panel table-panel">
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sales ID</th>
                  <th>Work Order No.</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Product</th>
                  <th className="numeric">Quantity</th>
                  <th className="numeric">Total</th>
                  <th className="numeric">Debt</th>
                  <th>Cash/M-Pesa/Banked</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => onSelect(s.id)}>
                    <td>{formatDateTime(s.sale_date)}</td>
                    <td>{s.sale_number}</td>
                    <td>{s.job_cards?.job_number ?? '—'}</td>
                    <td>{s.customer_name || CUSTOMER_TYPE_LABELS[s.customer_type] || s.customer_type.replaceAll('_', ' ')}</td>
                    <td>{s.vehicle_reg ?? '—'}</td>
                    <td>{productSummary(s.sale_items)}</td>
                    <td className="numeric">{totalQuantity(s.sale_items)}</td>
                    <td className="numeric">{formatKes(s.total_minor)}</td>
                    <td className="numeric" style={s.balance_minor > 0 ? { color: '#a4493d', fontWeight: 700 } : undefined}>{formatKes(s.balance_minor)}</td>
                    <td>{paymentSummary(s)}</td>
                    <td><span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status.replaceAll('_', ' ')}</span></td>
                    <td><SaleRowMenu onView={() => onSelect(s.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPrint && <SalesPrintView rows={withDayTotals(chronological)} filterLabel={filterLabel} onClose={() => setShowPrint(false)} />}
    </div>
  );
}

function SalesPrintView({ rows, filterLabel, onClose }: { rows: { sale: SaleRow; dayTotalMinor: number | null }[]; filterLabel: string; onClose: () => void }) {
  const grandTotal = rows.reduce((sum, { sale }) => sum + sale.total_minor, 0);
  const grandQuantity = rows.reduce((sum, { sale }) => sum + totalQuantity(sale.sale_items), 0);
  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Sales Report — {filterLabel}</strong>
        <div className="action-buttons">
          <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="close-button" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div id="print-area" className="print-sheet print-sheet-wide">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd.</h1><p className="muted">Spares Sales Day Book</p><p className="muted">{filterLabel}</p></div>
        </div>
        <table className="print-table" style={{ fontSize: 9 }}>
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '3%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '3%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '4%' }} />
            <col style={{ width: '4%' }} />
            <col style={{ width: '4%' }} />
            <col style={{ width: '4%' }} />
            <col style={{ width: '5%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Date</th>
              <th>Chg. days</th>
              <th>Customer Name</th>
              <th>Vehicle</th>
              <th>Vehicle model</th>
              <th>Part/spare No</th>
              <th>Description &amp; part make</th>
              <th>Qty sold</th>
              <th>Price</th>
              <th>Spares Total</th>
              <th>Labour/Service</th>
              <th>TOTAL</th>
              <th>Day Total</th>
              <th>Cash/M-Pesa/Banked</th>
              <th>Debt</th>
              <th>Jobcard No</th>
              <th>Stock at shelves</th>
              <th>System stock</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sale: s, dayTotalMinor }) => (
              <tr key={s.id}>
                <td>{localDateStr(new Date(s.sale_date))}</td>
                <td>{s.change_in_days || ''}</td>
                <td>{s.customer_name ?? '—'}</td>
                <td>{s.vehicle_reg ?? '—'}</td>
                <td>{s.vehicle_model ?? '—'}</td>
                <td>{joinField(s.sale_items, (i) => i.part_sku)}</td>
                <td>{joinField(s.sale_items, (i) => i.part_name)}</td>
                <td>{totalQuantity(s.sale_items)}</td>
                <td>{joinField(s.sale_items, (i) => formatKes(i.unit_price_minor))}</td>
                <td>{formatKes(s.subtotal_minor)}</td>
                <td>{formatKes(s.labour_minor)}</td>
                <td>{formatKes(s.total_minor)}</td>
                <td>{dayTotalMinor !== null ? formatKes(dayTotalMinor) : ''}</td>
                <td>{paymentSummary(s)}</td>
                <td>{formatKes(s.balance_minor)}</td>
                <td>{s.job_cards?.job_number ?? '—'}</td>
                <td>{joinField(s.sale_items, (i) => i.shelf_count_at_sale)}</td>
                <td>{joinField(s.sale_items, (i) => i.system_stock_after)}</td>
                <td>{s.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}><strong>Total ({rows.length} sale{rows.length === 1 ? '' : 's'})</strong></td>
              <td><strong>{grandQuantity}</strong></td>
              <td colSpan={2} />
              <td><strong>{formatKes(grandTotal)}</strong></td>
              <td colSpan={7} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
