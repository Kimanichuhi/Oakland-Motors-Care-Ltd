import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapPurchase, ScrapExpense, ScrapCashSummary, ScrapCurrentStockRow, StockCycle, ScrapStockAdjustment } from '@/lib/types';
import { downloadCSV, localDateStr, formatDate } from '@/lib/formatting';
import { X, Download } from 'lucide-react';

type ExportKind = 'purchases' | 'expenses' | 'cash_ledger' | 'stock_position' | 'stock_clearances' | 'stock_cycles' | 'monthly' | 'daily';

const EXPORT_OPTIONS: { id: ExportKind; label: string }[] = [
  { id: 'purchases', label: 'Scrap Purchases' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'cash_ledger', label: 'Cash Ledger' },
  { id: 'stock_position', label: 'Stock Position' },
  { id: 'stock_clearances', label: 'Stock Clearances' },
  { id: 'stock_cycles', label: 'Stock Cycle History' },
  { id: 'monthly', label: 'Monthly Report' },
  { id: 'daily', label: 'Individual Daily Scrap' },
];

function monthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function cycleAggregates() {
  const [{ data: purchases }, { data: adjustments }] = await Promise.all([
    supabase.from('scrap_purchases').select('stock_cycle_id, quantity_purchased').eq('status', 'ACTIVE'),
    supabase.from('scrap_stock_adjustments').select('stock_cycle_id, adjustment_type, quantity'),
  ]);
  const purchasedByCycle = new Map<string, number>();
  for (const p of (purchases ?? []) as { stock_cycle_id: string; quantity_purchased: number }[]) {
    purchasedByCycle.set(p.stock_cycle_id, (purchasedByCycle.get(p.stock_cycle_id) ?? 0) + p.quantity_purchased);
  }
  const clearedByCycle = new Map<string, number>();
  const adjustedByCycle = new Map<string, number>();
  for (const a of (adjustments ?? []) as { stock_cycle_id: string; adjustment_type: string; quantity: number }[]) {
    if (a.adjustment_type === 'CLEARANCE') clearedByCycle.set(a.stock_cycle_id, (clearedByCycle.get(a.stock_cycle_id) ?? 0) + a.quantity);
    else {
      const signed = a.adjustment_type === 'CORRECTION_DECREASE' ? -a.quantity : a.quantity;
      adjustedByCycle.set(a.stock_cycle_id, (adjustedByCycle.get(a.stock_cycle_id) ?? 0) + signed);
    }
  }
  return { purchasedByCycle, clearedByCycle, adjustedByCycle };
}

export default function ScrapExportDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ExportKind>('purchases');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [month, setMonth] = useState(monthInput());
  const [specificDate, setSpecificDate] = useState(localDateStr());
  const [scrapItemFilter, setScrapItemFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function runExport() {
    setError(''); setBusy(true);
    try {
      const today = localDateStr();
      if (kind === 'purchases') {
        let q = supabase.from('scrap_purchases').select('*, scrap_items(name)').eq('status', 'ACTIVE').order('date');
        if (fromDate) q = q.gte('date', fromDate);
        if (toDate) q = q.lte('date', toDate);
        const { data } = await q;
        const rows = (data ?? []) as (ScrapPurchase & { scrap_items: { name: string } | null })[];
        downloadCSV(`Oakland_Joseph_Scrap_Purchases_${today}.csv`, rows.map((r) => ({
          Date: r.date, 'Change in Days': r.change_in_days, 'Scrap Type': r.scrap_items?.name ?? '',
          'Weight KG': r.quantity_purchased, 'Rate Per KG': (r.rate_used_minor / 100).toFixed(2),
          'Purchase Amount': (r.purchase_amount_minor / 100).toFixed(2), Supplier: r.supplier ?? '',
          Notes: r.notes ?? '', 'Recorded By': r.created_by_name ?? '', 'Created At': r.created_at,
        })));
      } else if (kind === 'expenses') {
        let q = supabase.from('scrap_expenses').select('*').eq('status', 'ACTIVE').order('date');
        if (fromDate) q = q.gte('date', fromDate);
        if (toDate) q = q.lte('date', toDate);
        const { data } = await q;
        const rows = (data ?? []) as ScrapExpense[];
        downloadCSV(`Oakland_Joseph_Expenses_${today}.csv`, rows.map((r) => ({
          Date: r.date, 'Expense Type': r.category, Description: r.description ?? '',
          Amount: (r.amount_minor / 100).toFixed(2), 'Recorded By': r.created_by_name ?? '',
          Notes: r.notes ?? '', 'Created At': r.created_at,
        })));
      } else if (kind === 'cash_ledger') {
        const start = `${month}-01`;
        const [y, m] = month.split('-').map(Number);
        const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        const { data } = await supabase.from('scrap_cash_summary').select('*').gte('date', start).lte('date', end).order('date');
        const rows = (data ?? []) as ScrapCashSummary[];
        downloadCSV(`Oakland_Joseph_Cash_Ledger_${month}.csv`, rows.map((r) => ({
          Date: r.date, 'Opening Cash': (r.opening_cash_minor / 100).toFixed(2), 'Cash Added': (r.cash_added_minor / 100).toFixed(2),
          'Scrap Purchases': (r.purchases_minor / 100).toFixed(2), Expenses: (r.expenses_minor / 100).toFixed(2),
          'Cash Adjustments': (r.adjustments_minor / 100).toFixed(2), 'Closing Cash': (r.closing_cash_minor / 100).toFixed(2),
        })));
      } else if (kind === 'stock_position') {
        const { data: stock } = await supabase.from('scrap_current_stock').select('*').order('name');
        const rows = (stock ?? []) as ScrapCurrentStockRow[];
        const { purchasedByCycle, clearedByCycle, adjustedByCycle } = await cycleAggregates();
        downloadCSV(`Oakland_Joseph_Stock_Position_${today}.csv`, rows.map((r) => ({
          'Scrap Type': r.name, 'Opening Stock KG': r.opening_quantity ?? 0,
          'Purchased KG': r.stock_cycle_id ? (purchasedByCycle.get(r.stock_cycle_id) ?? 0) : 0,
          'Cleared KG': r.stock_cycle_id ? (clearedByCycle.get(r.stock_cycle_id) ?? 0) : 0,
          'Adjusted KG': r.stock_cycle_id ? (adjustedByCycle.get(r.stock_cycle_id) ?? 0) : 0,
          'Current Stock KG': r.current_quantity,
        })));
      } else if (kind === 'stock_clearances') {
        let q = supabase.from('scrap_stock_adjustments').select('*, scrap_items(name), stock_cycles(cycle_number)').eq('adjustment_type', 'CLEARANCE').order('date');
        if (fromDate) q = q.gte('date', fromDate);
        if (toDate) q = q.lte('date', toDate);
        const { data } = await q;
        const rows = (data ?? []) as (ScrapStockAdjustment & { scrap_items: { name: string } | null; stock_cycles: { cycle_number: number } | null })[];
        downloadCSV(`Oakland_Joseph_Stock_Clearances_${today}.csv`, rows.map((r) => ({
          Date: r.date, 'Stock Cycle': r.stock_cycles?.cycle_number ?? '', 'Scrap Type': r.scrap_items?.name ?? '',
          'Quantity Cleared KG': r.quantity, Reason: r.reason, 'Authorized By': r.authorized_by,
          Reference: '', Notes: r.notes ?? '', 'Created At': r.created_at,
        })));
      } else if (kind === 'stock_cycles') {
        const { data: cycles } = await supabase.from('stock_cycles').select('*, scrap_items(name)').order('opening_date');
        const rows = (cycles ?? []) as (StockCycle & { scrap_items: { name: string } | null })[];
        const { purchasedByCycle, clearedByCycle, adjustedByCycle } = await cycleAggregates();
        downloadCSV(`Oakland_Joseph_Stock_Cycles_${today}.csv`, rows.map((r) => ({
          'Cycle ID': r.id, 'Scrap Type': r.scrap_items?.name ?? '', 'Start Date': r.opening_date, 'End Date': r.closing_date ?? '',
          'Opening KG': r.opening_quantity, 'Purchased KG': purchasedByCycle.get(r.id) ?? 0, 'Cleared KG': clearedByCycle.get(r.id) ?? 0,
          'Adjusted KG': adjustedByCycle.get(r.id) ?? 0, 'Closing KG': r.status === 'OPEN' ? r.current_quantity : (r.closing_quantity ?? 0),
          Status: r.status,
        })));
      } else if (kind === 'monthly') {
        const start = `${month}-01`;
        const [y, m] = month.split('-').map(Number);
        const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        const { data } = await supabase.from('scrap_cash_summary').select('*').gte('date', start).lte('date', end).order('date');
        const rows = (data ?? []) as ScrapCashSummary[];
        downloadCSV(`Oakland_Joseph_Monthly_Report_${month}.csv`, rows.map((r) => ({
          Date: r.date, 'KG Purchased': r.total_kg_purchased, 'Scrap Purchase Cost': (r.purchases_minor / 100).toFixed(2),
          'Cash Added': (r.cash_added_minor / 100).toFixed(2), Expenses: (r.expenses_minor / 100).toFixed(2),
          'Closing Cash': (r.closing_cash_minor / 100).toFixed(2),
        })));
      } else if (kind === 'daily') {
        let q = supabase.from('scrap_purchases').select('*, scrap_items(name)').eq('status', 'ACTIVE').eq('date', specificDate);
        if (scrapItemFilter) q = q.eq('scrap_item_id', scrapItemFilter);
        const { data } = await q;
        const rows = (data ?? []) as (ScrapPurchase & { scrap_items: { name: string } | null })[];
        downloadCSV(`Oakland_Joseph_Daily_Scrap_${specificDate}.csv`, rows.map((r) => ({
          Date: r.date, 'Change in Days': r.change_in_days, 'Scrap Type': r.scrap_items?.name ?? '',
          'Weight KG': r.quantity_purchased, 'Rate Per KG': (r.rate_used_minor / 100).toFixed(2),
          Amount: (r.purchase_amount_minor / 100).toFixed(2), Supplier: r.supplier ?? '', Notes: r.notes ?? '',
        })));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate this export.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(520px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Export CSV</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <p className="muted">What would you like to export?</p>
        <div className="modal-form">
          <label>Dataset<select value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
            {EXPORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></label>

          {(kind === 'purchases' || kind === 'expenses' || kind === 'stock_clearances') && (
            <div className="form-row">
              <label>Date From <span className="optional">Optional</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
              <label>Date To <span className="optional">Optional</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
            </div>
          )}
          {(kind === 'cash_ledger' || kind === 'monthly') && (
            <label>Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required /></label>
          )}
          {kind === 'daily' && (
            <>
              <label>Specific Date<input type="date" value={specificDate} max={localDateStr()} onChange={(e) => setSpecificDate(e.target.value)} required /></label>
              <p className="muted">Exports only {formatDate(specificDate)}&apos;s scrap entries.</p>
            </>
          )}
          {kind === 'stock_position' && <p className="muted">Exports the current stock snapshot for every scrap type.</p>}
          {kind === 'stock_cycles' && <p className="muted">Exports the full stock cycle history, open and closed.</p>}

          {error && <div className="form-error">{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} onClick={() => void runExport()}><Download size={15} /> {busy ? 'Exporting…' : 'Export CSV'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
