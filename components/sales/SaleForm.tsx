import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Part, Sale } from '@/lib/types';
import { formatKes, displayToMinor } from '@/lib/formatting';
import { SALES_PAYMENT_METHODS, SALES_PAYMENT_STATUSES, CUSTOMER_SALE_TYPES } from '@/lib/constants';
import { Search, Plus, X, AlertTriangle, ShoppingCart } from 'lucide-react';

type LineItem = { partId: string; sku: string; name: string; category: string | null; quantityOnHand: number; quantity: number; unitPriceMinor: number };

function nowForInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function SaleForm({ onClose, onSaved, can }: { onClose: () => void; onSaved?: (m: string) => void; can: (p: string) => boolean }) {
  const canOverridePrice = can('sales.price.override');

  const [customerType, setCustomerType] = useState<(typeof CUSTOMER_SALE_TYPES)[number]>('WALK_IN');
  const [saleDate, setSaleDate] = useState(nowForInput());
  const [paymentMethod, setPaymentMethod] = useState<(typeof SALES_PAYMENT_METHODS)[number]>('CASH');
  const [paymentStatus, setPaymentStatus] = useState<(typeof SALES_PAYMENT_STATUSES)[number]>('PAID');
  const [discountDisplay, setDiscountDisplay] = useState('0');
  const [partialPaidDisplay, setPartialPaidDisplay] = useState('0');

  const [parts, setParts] = useState<Part[]>([]);
  const [partsLoading, setPartsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [items, setItems] = useState<LineItem[]>([]);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    supabase.from('parts').select('*').eq('active', true).order('name').limit(500).then(({ data }) => {
      setParts((data ?? []) as Part[]);
      setPartsLoading(false);
    });
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return parts.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8);
  }, [q, parts]);

  const subtotalMinor = items.reduce((sum, i) => sum + i.quantity * i.unitPriceMinor, 0);
  const discountMinor = Math.max(0, displayToMinor(parseFloat(discountDisplay) || 0));
  const totalMinor = Math.max(0, subtotalMinor - discountMinor);
  const amountPaidMinor = paymentStatus === 'PAID' ? totalMinor : paymentStatus === 'PENDING' ? 0 : Math.min(totalMinor, Math.max(0, displayToMinor(parseFloat(partialPaidDisplay) || 0)));
  const balanceMinor = Math.max(0, totalMinor - amountPaidMinor);
  const hasZeroPricedItem = items.some((i) => i.unitPriceMinor === 0);
  const hasOverStockItem = items.some((i) => i.quantity > i.quantityOnHand);

  function addPart(part: Part) {
    if (part.quantity_on_hand <= 0) return;
    setItems((prev) => {
      const existing = prev.find((i) => i.partId === part.id);
      if (existing) {
        return prev.map((i) => i.partId === part.id ? { ...i, quantity: Math.min(i.quantity + 1, part.quantity_on_hand) } : i);
      }
      return [...prev, { partId: part.id, sku: part.sku, name: part.name, category: part.category, quantityOnHand: part.quantity_on_hand, quantity: 1, unitPriceMinor: part.selling_price_minor }];
    });
    setQuery(''); setDropdownOpen(false);
  }

  function updateQuantity(partId: string, quantity: number) {
    setItems((prev) => prev.map((i) => i.partId === partId ? { ...i, quantity: Math.max(1, Math.min(quantity, i.quantityOnHand)) } : i));
  }

  function updateUnitPrice(partId: string, display: string) {
    const minor = Math.max(0, displayToMinor(parseFloat(display) || 0));
    setItems((prev) => prev.map((i) => i.partId === partId ? { ...i, unitPriceMinor: minor } : i));
  }

  function removeItem(partId: string) {
    setItems((prev) => prev.filter((i) => i.partId !== partId));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!can('sales.create')) { setFormError('You are not authorized to create sales.'); return; }
    if (items.length === 0) { setFormError('Add at least one item to the sale.'); return; }
    if (hasOverStockItem) { setFormError('One or more items exceed available stock.'); return; }
    if (paymentStatus === 'PARTIAL' && amountPaidMinor <= 0) { setFormError('Enter an amount paid for a partial payment.'); return; }

    setBusy(true);
    try {
      const payload = {
        p_customer_name: null,
        p_customer_phone: null,
        p_customer_type: customerType,
        p_payment_method: paymentMethod,
        p_payment_status: paymentStatus,
        p_sale_date: new Date(saleDate).toISOString(),
        p_discount_minor: discountMinor,
        p_amount_paid_minor: amountPaidMinor,
        p_items: items.map((i) => ({ part_id: i.partId, quantity: i.quantity, unit_price_minor: i.unitPriceMinor })),
      };
      const { data, error } = await supabase.rpc('complete_sale', payload);
      if (error) throw error;
      const sale = data as Sale;
      onSaved?.(`Sale ${sale.sale_number} completed — ${formatKes(sale.total_minor)}`);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to complete the sale. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(720px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Sales</p><h2>New sale</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit} className="modal-form">
          <div className="form-row">
            <label>Customer type<select value={customerType} onChange={(e) => setCustomerType(e.target.value as typeof customerType)}>{CUSTOMER_SALE_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Sale date<input type="datetime-local" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required /></label>
          </div>

          <label>Add item<div className="combobox">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder={partsLoading ? 'Loading parts…' : 'Search by part name or SKU...'}
            />
            {dropdownOpen && q.length > 0 && <div className="combobox-dropdown">
              {matches.length === 0 && <p className="combobox-empty">No matching parts.</p>}
              {matches.map((p) => <button type="button" key={p.id} className="combobox-option" disabled={p.quantity_on_hand <= 0} onMouseDown={() => addPart(p)} style={p.quantity_on_hand <= 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                <strong>{p.name}</strong> <span style={{ color: '#8997a5' }}>{p.sku}</span>
                <span style={{ float: 'right', color: p.quantity_on_hand <= 0 ? '#a4493d' : '#8997a5' }}>{p.quantity_on_hand <= 0 ? 'Out of stock' : `${p.quantity_on_hand} in stock`} · {formatKes(p.selling_price_minor)}</span>
              </button>)}
            </div>}
          </div></label>

          {items.length === 0 ? <div className="empty" style={{ padding: '24px 12px' }}><Search size={18} /><strong>No items yet</strong><span>Search for a part above to add it to the sale.</span></div> : (
            <div className="data-table">
              {items.map((i) => <div className="table-row" key={i.partId}>
                <div className="job-icon"><ShoppingCart size={16} /></div>
                <div><strong>{i.name}</strong><span>{i.sku}{i.unitPriceMinor === 0 && <span style={{ color: '#a4493d' }}> · no price set</span>}</span></div>
                <input type="number" min={1} max={i.quantityOnHand} value={i.quantity} onChange={(e) => updateQuantity(i.partId, parseInt(e.target.value) || 1)} style={{ width: 60, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                {canOverridePrice ? (
                  <input type="number" min={0} step="0.01" value={(i.unitPriceMinor / 100).toString()} onChange={(e) => updateUnitPrice(i.partId, e.target.value)} style={{ width: 90, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                ) : <span className="table-muted" style={{ flex: 'none', width: 90 }}>{formatKes(i.unitPriceMinor)}</span>}
                <span className="table-muted">{formatKes(i.quantity * i.unitPriceMinor)}</span>
                <button type="button" className="close-button" style={{ width: 28, height: 28 }} onClick={() => removeItem(i.partId)}><X size={14} /></button>
              </div>)}
            </div>
          )}
          {hasOverStockItem && <div className="form-error"><AlertTriangle size={14} /> One or more quantities exceed available stock.</div>}
          {hasZeroPricedItem && <div className="form-error"><AlertTriangle size={14} /> Some items have no selling price set{canOverridePrice ? ' — edit the price above or set it on the part first.' : '; set a price on the part before selling it.'}</div>}

          <div className="form-row">
            <label>Discount (KES)<input type="number" min={0} step="0.01" value={discountDisplay} onChange={(e) => setDiscountDisplay(e.target.value)} /></label>
            <label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>{SALES_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}</select></label>
          </div>
          <div className="form-row">
            <label>Payment status<select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>{SALES_PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            {paymentStatus === 'PARTIAL' && <label>Amount paid (KES)<input type="number" min={0} step="0.01" value={partialPaidDisplay} onChange={(e) => setPartialPaidDisplay(e.target.value)} /></label>}
          </div>

          <div className="detail-info-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <div className="info-card"><div><span>Subtotal</span><strong>{formatKes(subtotalMinor)}</strong></div></div>
            <div className="info-card"><div><span>Total due</span><strong>{formatKes(totalMinor)}</strong></div></div>
            <div className="info-card"><div><span>Balance</span><strong>{formatKes(balanceMinor)}</strong></div></div>
          </div>

          {formError && <div className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy || items.length === 0} type="submit"><Plus size={15} /> {busy ? 'Saving…' : 'Complete sale'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
