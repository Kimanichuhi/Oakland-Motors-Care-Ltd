import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Sale, SaleItem } from '@/lib/types';
import { formatKes, formatDate, formatDateTime, displayToMinor } from '@/lib/formatting';
import { statusStyles, SALES_PAYMENT_METHODS, SALES_PAYMENT_STATUSES, CUSTOMER_SALE_TYPES } from '@/lib/constants';
import { purgeRecord } from '@/lib/purge';
import { ShoppingCart, ChevronRight, User, CarFront, CreditCard, CircleDollarSign, Calendar, FileText, Ban, Trash2, Edit, X } from 'lucide-react';

type SaleWithItems = Sale & { sale_items: SaleItem[]; job_cards: { job_number: string } | null };

export default function SaleDetail({ id, onBack, onNotice, can }: { id: string; onBack: () => void; onNotice?: (m: string) => void; can: (p: string) => boolean }) {
  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState(false);
  const [purging, setPurging] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('sales').select('*, sale_items(*), job_cards(job_number)').eq('id', id).maybeSingle();
    setLoadError(error ? error.message : '');
    setSale(data as SaleWithItems | null);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function voidSale() {
    if (!sale || sale.status === 'VOIDED') return;
    const reason = window.prompt('Reason for voiding this sale?');
    if (reason === null) return;
    setVoiding(true);
    const { error } = await supabase.rpc('void_sale', { p_sale_id: sale.id, p_reason: reason || null });
    setVoiding(false);
    if (error) { onNotice?.(error.message ?? 'Unable to void this sale.'); return; }
    onNotice?.('Sale voided and stock restored.');
    void load();
  }

  async function purge() {
    if (!sale || purging) return;
    setPurging(true);
    const r = await purgeRecord('sales', sale.id, `sale "${sale.sale_number}"`);
    setPurging(false);
    if (r.message) onNotice?.(r.message);
    if (r.ok) onBack();
  }

  if (loading) return <div className="empty"><strong>Loading…</strong></div>;
  if (!sale) return <div className="empty"><strong>{loadError ? `Unable to load sale: ${loadError}` : 'Sale not found'}</strong></div>;

  return (
    <div>
      <div className="back-bar"><button onClick={onBack}><ChevronRight size={16} className="back-icon" /> Sales</button></div>
      <div className="detail-header">
        <div className="detail-avatar"><ShoppingCart size={22} /></div>
        <div className="flex-1"><h2>{sale.sale_number}</h2><p className="muted">{sale.customer_name || sale.customer_type.replaceAll('_', ' ')}{sale.customer_phone ? ` · ${sale.customer_phone}` : ''}{sale.job_cards?.job_number ? ` · Work Order ${sale.job_cards.job_number}` : ''} · {formatDate(sale.sale_date)}</p></div>
        <span className={`status ${statusStyles[sale.status] ?? ''}`}>{sale.status.replaceAll('_', ' ')}</span>
      </div>

      <div className="detail-info-grid">
        <div className="info-card"><User size={16} /> <div><span>Customer type</span><strong>{sale.customer_type.replaceAll('_', ' ')}</strong></div></div>
        <div className="info-card"><CreditCard size={16} /> <div><span>Payment</span><strong>{sale.payment_method.replaceAll('_', ' ')} · {sale.payment_status}</strong>{sale.payment_reference && <span>{sale.payment_reference}{sale.payment_reference_at ? ` · ${formatDateTime(sale.payment_reference_at)}` : ''}</span>}</div></div>
        <div className="info-card"><CircleDollarSign size={16} /> <div><span>Salesperson</span><strong>{sale.salesperson_name ?? '—'}</strong></div></div>
        {sale.technician_name && <div className="info-card"><User size={16} /> <div><span>Technician (buyer)</span><strong>{sale.technician_name}</strong></div></div>}
        {(sale.vehicle_reg || sale.vehicle_model) && <div className="info-card"><CarFront size={16} /> <div><span>Vehicle</span><strong>{[sale.vehicle_reg, sale.vehicle_model].filter(Boolean).join(' · ')}</strong></div></div>}
        {sale.change_in_days > 0 && <div className="info-card"><Calendar size={16} /> <div><span>Change in days</span><strong>{sale.change_in_days}</strong></div></div>}
        <div className="info-card"><CircleDollarSign size={16} /> <div><span>Balance due</span><strong>{formatKes(sale.balance_minor)}</strong></div></div>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow">Items</p><h3>Sale items</h3></div></div>
        {sale.sale_items.length === 0 ? <div className="empty"><strong>No items</strong></div> : <div className="data-table">
          {sale.sale_items.map((it) => <div key={it.id} className="table-row">
            <div className="job-icon"><ShoppingCart size={16} /></div>
            <div><strong>{it.part_name}</strong><span>{it.part_sku}{it.returned_quantity > 0 ? ` · ${it.returned_quantity} returned` : ''}{it.shelf_count_at_sale !== null ? ` · Shelf count: ${it.shelf_count_at_sale}` : ''}{it.system_stock_after !== null ? ` · System stock after: ${it.system_stock_after}` : ''}</span></div>
            <span className="table-muted">{it.quantity} × {formatKes(it.unit_price_minor)}</span>
            <span className="table-muted">{formatKes(it.line_total_minor)}</span>
          </div>)}
        </div>}
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow">Summary</p><h3>Totals</h3></div></div>
        <div className="status-row"><strong>Spares subtotal</strong><span>{formatKes(sale.subtotal_minor)}</span></div>
        <div className="status-row"><strong>Labour/Service</strong><span>{formatKes(sale.labour_minor)}</span></div>
        <div className="status-row"><strong>Discount</strong><span>-{formatKes(sale.discount_minor)}</span></div>
        <div className="status-row"><strong>Total</strong><span>{formatKes(sale.total_minor)}</span></div>
        <div className="status-row"><strong>Amount paid</strong><span>{formatKes(sale.amount_paid_minor)}</span></div>
        <div className="status-row"><strong>Balance</strong><span>{formatKes(sale.balance_minor)}</span></div>
        {sale.status === 'VOIDED' && <div className="status-row"><strong>Void reason</strong><span>{sale.void_reason ?? '—'}</span></div>}
      </section>

      {sale.notes && <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow"><FileText size={12} style={{ verticalAlign: -1 }} /> Notes</p><h3>Remarks</h3></div></div>
        <p className="muted" style={{ margin: 0 }}>{sale.notes}</p>
      </section>}

      <div className="action-buttons" style={{ marginTop: 16 }}>
        <button className="button secondary" onClick={onBack}>Back</button>
        {can('settings.manage') && sale.status !== 'VOIDED' && <button className="button secondary" onClick={() => setShowEdit(true)}><Edit size={15} /> Edit sale</button>}
        {can('sales.void') && sale.status === 'COMPLETED' && !sale.job_card_id && <button className="button secondary" disabled={voiding} onClick={() => void voidSale()}><Ban size={15} /> {voiding ? 'Voiding…' : 'Void sale'}</button>}
        {sale.job_card_id && sale.status === 'COMPLETED' && <p className="muted">Generated from a job card — reverse it from the work order instead of voiding here.</p>}
        {can('settings.manage') && <button className="button danger" disabled={purging} onClick={() => void purge()}><Trash2 size={15} /> {purging ? 'Deleting…' : 'Delete permanently'}</button>}
      </div>

      {showEdit && <SaleEditForm sale={sale} onClose={() => setShowEdit(false)} onSaved={(m) => { setShowEdit(false); onNotice?.(m); void load(); }} />}
    </div>
  );
}

function SaleEditForm({ sale, onClose, onSaved }: { sale: SaleWithItems; onClose: () => void; onSaved: (m: string) => void }) {
  const [customerName, setCustomerName] = useState(sale.customer_name ?? '');
  const [customerPhone, setCustomerPhone] = useState(sale.customer_phone ?? '');
  const [customerType, setCustomerType] = useState<(typeof CUSTOMER_SALE_TYPES)[number]>(sale.customer_type as (typeof CUSTOMER_SALE_TYPES)[number]);
  const [vehicleReg, setVehicleReg] = useState(sale.vehicle_reg ?? '');
  const [vehicleModel, setVehicleModel] = useState(sale.vehicle_model ?? '');
  const [saleDate, setSaleDate] = useState(() => { const d = new Date(sale.sale_date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [changeInDays, setChangeInDays] = useState(String(sale.change_in_days));
  const [paymentMethod, setPaymentMethod] = useState<(typeof SALES_PAYMENT_METHODS)[number]>(sale.payment_method as (typeof SALES_PAYMENT_METHODS)[number]);
  const [paymentStatus, setPaymentStatus] = useState<(typeof SALES_PAYMENT_STATUSES)[number]>(sale.payment_status as (typeof SALES_PAYMENT_STATUSES)[number]);
  const [amountPaidDisplay, setAmountPaidDisplay] = useState((sale.amount_paid_minor / 100).toString());
  const [mpesaCode, setMpesaCode] = useState(sale.payment_reference ?? '');
  const [mpesaSentAt, setMpesaSentAt] = useState(() => { if (!sale.payment_reference_at) return ''; const d = new Date(sale.payment_reference_at); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [notes, setNotes] = useState(sale.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isMpesa = paymentMethod === 'MPESA';
  const amountPaidMinor = Math.max(0, Math.min(sale.total_minor, displayToMinor(parseFloat(amountPaidDisplay) || 0)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!customerName.trim()) { setError('Customer name is required.'); return; }
    if (isMpesa && !mpesaCode.trim()) { setError('Enter the M-Pesa transaction code.'); return; }

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('edit_sale', {
      p_sale_id: sale.id,
      p_customer_name: customerName.trim(),
      p_customer_phone: customerPhone.trim() || null,
      p_customer_type: customerType,
      p_vehicle_reg: vehicleReg.trim() || null,
      p_vehicle_model: vehicleModel.trim() || null,
      p_payment_method: paymentMethod,
      p_payment_status: paymentStatus,
      p_amount_paid_minor: amountPaidMinor,
      p_payment_reference: isMpesa ? mpesaCode.trim() : null,
      p_payment_reference_at: isMpesa && mpesaSentAt ? new Date(mpesaSentAt).toISOString() : null,
      p_change_in_days: parseInt(changeInDays, 10) || 0,
      p_sale_date: new Date(saleDate).toISOString(),
      p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Unable to save these changes.'); return; }
    onSaved(`Sale ${sale.sale_number} updated.`);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(640px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Sales</p><h2>Edit {sale.sale_number}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit} className="modal-form">
          <p className="muted" style={{ margin: 0 }}>Only record-keeping fields can be edited here — items, quantities, and prices are fixed once a sale is completed. Void and recreate the sale if those need to change.</p>
          <div className="form-row">
            <label>Customer name<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required /></label>
            <label>Customer phone <span className="optional">Optional</span><input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></label>
          </div>
          <div className="form-row">
            <label>Customer type<select value={customerType} onChange={(e) => setCustomerType(e.target.value as typeof customerType)}>{CUSTOMER_SALE_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Sale date<input type="datetime-local" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required /></label>
          </div>
          <div className="form-row">
            <label>Vehicle <span className="optional">Optional</span><input value={vehicleReg} onChange={(e) => setVehicleReg(e.target.value)} /></label>
            <label>Vehicle model <span className="optional">Optional</span><input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} /></label>
          </div>
          <div className="form-row">
            <label>Change in days<input type="number" min={0} value={changeInDays} onChange={(e) => setChangeInDays(e.target.value)} /></label>
            <label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>{SALES_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}</select></label>
          </div>
          <div className="form-row">
            <label>Payment status<select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>{SALES_PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Amount paid (KES) <span className="optional">Of {formatKes(sale.total_minor)} total</span><input type="number" min={0} max={sale.total_minor / 100} step="0.01" value={amountPaidDisplay} onChange={(e) => setAmountPaidDisplay(e.target.value)} /></label>
          </div>
          {isMpesa && <div className="form-row">
            <label>M-Pesa transaction code<input value={mpesaCode} onChange={(e) => setMpesaCode(e.target.value.toUpperCase())} required /></label>
            <label>Time money was sent<input type="datetime-local" value={mpesaSentAt} onChange={(e) => setMpesaSentAt(e.target.value)} /></label>
          </div>}
          <label>Remarks <span className="optional">Optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 46 }} /></label>
          <p className="muted" style={{ margin: 0 }}>New balance will be {formatKes(sale.total_minor - amountPaidMinor)}.</p>
          {error && <div className="form-error">{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary wide" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
