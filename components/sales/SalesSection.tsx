import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Sale } from '@/lib/types';
import { formatKes, formatDateTime, downloadCSV } from '@/lib/formatting';
import { statusStyles } from '@/lib/constants';
import { Plus, Search, MoreVertical, Eye, Download, Printer, X } from 'lucide-react';

type SaleRow = Sale & { job_cards: { job_number: string } | null; sale_items: { part_name: string; quantity: number }[] };

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  WALK_IN: 'Walk In',
  JOB_CARD: 'Job Card',
  GARAGE_WORKSHOP: 'Garage Workshop',
  VEHICLE_OWNER: 'Vehicle Owner',
  BUSINESS: 'Business',
  OTHER: 'Other',
};

function productSummary(items: { part_name: string; quantity: number }[]): string {
  if (items.length === 0) return '—';
  if (items.length === 1) return items[0].part_name;
  return `${items[0].part_name} +${items.length - 1} more`;
}

function totalQuantity(items: { part_name: string; quantity: number }[]): number {
  return items.reduce((sum, it) => sum + it.quantity, 0);
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

export default function SalesSection({ query, onNew, onSelect, can }: { query: string; onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      let q = supabase.from('sales').select('*, job_cards(job_number), sale_items(part_name, quantity)').order('sale_date', { ascending: false }).limit(200);
      if (query) q = q.or(`sale_number.ilike.%${query}%,customer_name.ilike.%${query}%,customer_phone.ilike.%${query}%`);
      const { data, error } = await q;
      if (!mounted) return;
      setLoadError(error ? error.message : '');
      setSales((data ?? []) as SaleRow[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [query]);

  const filteredSales = useMemo(() => {
    const term = productFilter.trim().toLowerCase();
    return sales.filter((s) => {
      const saleDay = s.sale_date.slice(0, 10);
      if (fromDate && saleDay < fromDate) return false;
      if (toDate && saleDay > toDate) return false;
      if (term && !s.sale_items.some((it) => it.part_name.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [sales, fromDate, toDate, productFilter]);

  const filterLabel = [
    fromDate || toDate ? `${fromDate || 'earliest'} to ${toDate || 'latest'}` : 'All dates',
    productFilter.trim() ? `Product: "${productFilter.trim()}"` : null,
  ].filter(Boolean).join(' · ');

  function exportCSV() {
    downloadCSV(`Oakland_Sales_${new Date().toISOString().slice(0, 10)}.csv`, filteredSales.map((s) => ({
      Date: formatDateTime(s.sale_date),
      'Receipt / Work Order': s.job_cards?.job_number ?? s.sale_number,
      Customer: CUSTOMER_TYPE_LABELS[s.customer_type] ?? s.customer_type,
      Product: s.sale_items.map((it) => it.part_name).join('; '),
      Quantity: totalQuantity(s.sale_items),
      'Total (KES)': (s.total_minor / 100).toFixed(2),
      'M-Pesa Code': s.payment_reference ?? '',
      Status: s.status,
    })));
  }

  return (
    <div>
      <div className="panel-heading">
        <div><p className="eyebrow">Spare parts sales</p><h3>Sales</h3></div>
        <div>{can('sales.create') && <button className="button primary" onClick={onNew}><Plus size={15} /> New sale</button>}</div>
      </div>

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
                  <th>Receipt / Work Order No.</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th className="numeric">Quantity</th>
                  <th className="numeric">Total</th>
                  <th>M-Pesa Code</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => onSelect(s.id)}>
                    <td>{formatDateTime(s.sale_date)}</td>
                    <td>{s.job_cards?.job_number ?? s.sale_number}</td>
                    <td>{CUSTOMER_TYPE_LABELS[s.customer_type] ?? s.customer_type.replaceAll('_', ' ')}</td>
                    <td>{productSummary(s.sale_items)}</td>
                    <td className="numeric">{totalQuantity(s.sale_items)}</td>
                    <td className="numeric">{formatKes(s.total_minor)}</td>
                    <td>{s.payment_reference ?? '—'}</td>
                    <td><span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status.replaceAll('_', ' ')}</span></td>
                    <td><SaleRowMenu onView={() => onSelect(s.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPrint && <SalesPrintView sales={filteredSales} filterLabel={filterLabel} onClose={() => setShowPrint(false)} />}
    </div>
  );
}

function SalesPrintView({ sales, filterLabel, onClose }: { sales: SaleRow[]; filterLabel: string; onClose: () => void }) {
  const grandTotal = sales.reduce((sum, s) => sum + s.total_minor, 0);
  const grandQuantity = sales.reduce((sum, s) => sum + totalQuantity(s.sale_items), 0);
  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <strong>Sales Report — {filterLabel}</strong>
        <div className="action-buttons">
          <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
          <button className="close-button" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div id="print-area" className="print-sheet">
        <div className="print-header">
          <div><h1>Oakland Motor Care Ltd.</h1><p className="muted">Sales Report</p><p className="muted">{filterLabel}</p></div>
        </div>
        <table className="print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt / Work Order</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Total</th>
              <th>M-Pesa Code</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>{formatDateTime(s.sale_date)}</td>
                <td>{s.job_cards?.job_number ?? s.sale_number}</td>
                <td>{CUSTOMER_TYPE_LABELS[s.customer_type] ?? s.customer_type.replaceAll('_', ' ')}</td>
                <td>{s.sale_items.map((it) => it.part_name).join(', ') || '—'}</td>
                <td>{totalQuantity(s.sale_items)}</td>
                <td>{formatKes(s.total_minor)}</td>
                <td>{s.payment_reference ?? '—'}</td>
                <td>{s.status.replaceAll('_', ' ')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}><strong>Total ({sales.length} sale{sales.length === 1 ? '' : 's'})</strong></td>
              <td><strong>{grandQuantity}</strong></td>
              <td><strong>{formatKes(grandTotal)}</strong></td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
