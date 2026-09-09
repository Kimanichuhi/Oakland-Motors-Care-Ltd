import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Part, Sale, Employee, Vehicle, JobCard } from '@/lib/types';
import { formatKes, displayToMinor } from '@/lib/formatting';
import { SALES_PAYMENT_METHODS, SALES_PAYMENT_STATUSES, CUSTOMER_SALE_TYPES } from '@/lib/constants';
import { Search, Plus, X, AlertTriangle, ShoppingCart } from 'lucide-react';

type LineItem = { partId: string; sku: string; name: string; category: string | null; quantityOnHand: number; quantity: number; unitPriceMinor: number; shelfCount: string };

function nowForInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function SaleForm({ onClose, onSaved, can }: { onClose: () => void; onSaved?: (m: string) => void; can: (p: string) => boolean }) {
  const canOverridePrice = can('sales.price.override');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerType, setCustomerType] = useState<(typeof CUSTOMER_SALE_TYPES)[number]>('WALK_IN');
  const [technicianId, setTechnicianId] = useState('');
  const [technicians, setTechnicians] = useState<Employee[]>([]);
  const isGarageWorkshop = customerType === 'GARAGE_WORKSHOP';
  const [saleDate, setSaleDate] = useState(nowForInput());
  const [changeInDays, setChangeInDays] = useState('0');
  const [vehicleReg, setVehicleReg] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [jobCardId, setJobCardId] = useState('');
  const [jobCards, setJobCards] = useState<(JobCard & { customers: { full_name: string } | null; vehicles: { registration_number: string } | null })[]>([]);
  const [labourDisplay, setLabourDisplay] = useState('0');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<(typeof SALES_PAYMENT_METHODS)[number]>('CASH');
  const [paymentStatus, setPaymentStatus] = useState<(typeof SALES_PAYMENT_STATUSES)[number]>('PAID');
  const [partialPaidDisplay, setPartialPaidDisplay] = useState('0');
  const [mpesaCode, setMpesaCode] = useState('');
  const [mpesaSentAt, setMpesaSentAt] = useState(nowForInput());

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

  useEffect(() => {
    supabase.from('employees').select('*').eq('active', true).eq('role', 'TECHNICIAN').order('full_name').then(({ data }) => setTechnicians((data ?? []) as Employee[]));
  }, []);

  useEffect(() => {
    supabase.from('vehicles').select('*').is('deleted_at', null).order('registration_number').limit(500).then(({ data }) => setVehicles((data ?? []) as Vehicle[]));
  }, []);

  useEffect(() => {
    supabase.from('job_cards').select('*, customers(full_name), vehicles(registration_number)').is('deleted_at', null).neq('status', 'CANCELLED').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setJobCards((data ?? []) as (JobCard & { customers: { full_name: string } | null; vehicles: { registration_number: string } | null })[]));
  }, []);

  function pickVehicleReg(reg: string) {
    setVehicleReg(reg);
    const match = vehicles.find((v) => v.registration_number.toLowerCase() === reg.trim().toLowerCase());
    if (match) setVehicleModel([match.make, match.model].filter(Boolean).join(' '));
  }

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return parts.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8);
  }, [q, parts]);

  const spareTotalMinor = items.reduce((sum, i) => sum + i.quantity * i.unitPriceMinor, 0);
  const labourMinor = Math.max(0, displayToMinor(parseFloat(labourDisplay) || 0));
  const totalMinor = spareTotalMinor + labourMinor;
  const isMpesa = paymentMethod === 'MPESA';
  const amountPaidMinor = paymentStatus === 'PAID' ? totalMinor : paymentStatus === 'PENDING' ? 0 : Math.min(totalMinor, Math.max(0, displayToMinor(parseFloat(partialPaidDisplay) || 0)));
  const hasZeroPricedItem = items.some((i) => i.unitPriceMinor === 0);
  const hasOverStockItem = items.some((i) => i.quantity > i.quantityOnHand);

  function addPart(part: Part) {
    if (part.quantity_on_hand <= 0) return;
    setItems((prev) => {
      const existing = prev.find((i) => i.partId === part.id);
      if (existing) {
        return prev.map((i) => i.partId === part.id ? { ...i, quantity: Math.min(i.quantity + 1, part.quantity_on_hand) } : i);
      }
      return [...prev, { partId: part.id, sku: part.sku, name: part.name, category: part.category, quantityOnHand: part.quantity_on_hand, quantity: 1, unitPriceMinor: part.selling_price_minor, shelfCount: '' }];
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

  function updateShelfCount(partId: string, display: string) {
    setItems((prev) => prev.map((i) => i.partId === partId ? { ...i, shelfCount: display } : i));
  }

  function removeItem(partId: string) {
    setItems((prev) => prev.filter((i) => i.partId !== partId));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!can('sales.create')) { setFormError('You are not authorized to create sales.'); return; }
    if (!customerName.trim()) { setFormError('Customer name is required.'); return; }
    if (items.length === 0) { setFormError('Add at least one item to the sale.'); return; }
    if (hasOverStockItem) { setFormError('One or more items exceed available stock.'); return; }
    if (hasZeroPricedItem && !canOverridePrice) { setFormError('One or more items have no selling price set. Set a price on the part first, or ask for price-override access.'); return; }
    if (paymentStatus === 'PARTIAL' && amountPaidMinor <= 0) { setFormError('Enter an amount paid for a partial payment.'); return; }
    if (isMpesa && !mpesaCode.trim()) { setFormError('Enter the M-Pesa transaction code.'); return; }
    if (isMpesa && !mpesaSentAt) { setFormError('Enter the time the M-Pesa payment was sent.'); return; }
    if (isGarageWorkshop && !technicianId) { setFormError('Select the technician who is making this purchase.'); return; }

    setBusy(true);
    try {
      const payload = {
        p_customer_name: customerName.trim(),
        p_customer_phone: customerPhone.trim() || null,
        p_customer_type: customerType,
        p_payment_method: paymentMethod,
        p_payment_status: paymentStatus,
        p_sale_date: new Date(saleDate).toISOString(),
        p_discount_minor: 0,
        p_amount_paid_minor: amountPaidMinor,
        p_items: items.map((i) => ({ part_id: i.partId, quantity: i.quantity, unit_price_minor: i.unitPriceMinor, shelf_count: i.shelfCount.trim() === '' ? null : parseInt(i.shelfCount, 10) })),
        p_payment_reference: isMpesa ? mpesaCode.trim() : null,
        p_payment_reference_at: isMpesa ? new Date(mpesaSentAt).toISOString() : null,
        p_technician_id: technicianId || null,
        p_vehicle_reg: vehicleReg.trim() || null,
        p_vehicle_model: vehicleModel.trim() || null,
        p_change_in_days: parseInt(changeInDays, 10) || 0,
        p_labour_minor: labourMinor,
        p_notes: notes.trim() || null,
        p_job_card_id: jobCardId || null,
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
      <div className="modal" style={{ width: 'min(760px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Sales</p><h2>New sale</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit} className="modal-form">
          <div className="form-row">
            <label>Customer name<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required placeholder="e.g. James Mwangi" /></label>
            <label>Customer phone <span className="optional">Optional</span><input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0712 345 678" /></label>
          </div>
          <div className="form-row">
            <label>Customer type<select value={customerType} onChange={(e) => setCustomerType(e.target.value as typeof customerType)}>{CUSTOMER_SALE_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Sale date<input type="datetime-local" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required /></label>
          </div>
          <div className="form-row">
            <label>Vehicle <span className="optional">Optional</span>
              <input list="sale-vehicle-regs" value={vehicleReg} onChange={(e) => pickVehicleReg(e.target.value)} placeholder="e.g. KDG 221C" />
              <datalist id="sale-vehicle-regs">{vehicles.map((v) => <option key={v.id} value={v.registration_number} />)}</datalist>
            </label>
            <label>Vehicle model <span className="optional">Optional</span><input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="e.g. Toyota Corolla" /></label>
          </div>
          <div className="form-row">
            <label>Change in days <span className="optional">Backdating, like the scrap book</span><input type="number" min={0} value={changeInDays} onChange={(e) => setChangeInDays(e.target.value)} /></label>
            <label>Job card No. <span className="optional">Optional</span>
              <select value={jobCardId} onChange={(e) => setJobCardId(e.target.value)}>
                <option value="">Not linked</option>
                {jobCards.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicles?.registration_number ?? 'Vehicle'} · {j.customers?.full_name ?? 'Customer'}</option>)}
              </select>
            </label>
          </div>

          {isGarageWorkshop && <label>Technician who is buying
            <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} required>
              <option value="">Select technician...</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </label>}

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
              {items.map((i) => <div key={i.partId} style={{ padding: '10px 0', borderTop: '1px solid #eef1f3' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="job-icon"><ShoppingCart size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}><strong>{i.name}</strong><span style={{ display: 'block', fontSize: 11, color: '#82909c' }}>{i.sku}{i.unitPriceMinor === 0 && <span style={{ color: '#a4493d' }}> · no price set</span>}</span></div>
                  <input type="number" min={1} max={i.quantityOnHand} value={i.quantity} onChange={(e) => updateQuantity(i.partId, parseInt(e.target.value) || 1)} title="Quantity" style={{ width: 55, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                  {canOverridePrice ? (
                    <input type="number" min={0} step="0.01" value={(i.unitPriceMinor / 100).toString()} onChange={(e) => updateUnitPrice(i.partId, e.target.value)} title="Unit price" style={{ width: 85, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                  ) : <span className="table-muted" style={{ flex: 'none', width: 85 }}>{formatKes(i.unitPriceMinor)}</span>}
                  <span className="table-muted" style={{ width: 80, textAlign: 'right' }}>{formatKes(i.quantity * i.unitPriceMinor)}</span>
                  <button type="button" className="close-button" style={{ width: 28, height: 28, flexShrink: 0 }} onClick={() => removeItem(i.partId)}><X size={14} /></button>
                </div>
                <div style={{ marginLeft: 44, marginTop: 6 }}>
                  <input type="number" min={0} value={i.shelfCount} onChange={(e) => updateShelfCount(i.partId, e.target.value)} placeholder="Remaining stock at shelves (optional)" style={{ width: 260, border: '1px solid #dfe5ea', borderRadius: 6, padding: '5px 8px', fontSize: 11 }} />
                </div>
              </div>)}
            </div>
          )}
          {hasOverStockItem && <div className="form-error"><AlertTriangle size={14} /> One or more quantities exceed available stock.</div>}
          {hasZeroPricedItem && <div className="form-error"><AlertTriangle size={14} /> Some items have no selling price set{canOverridePrice ? ' — edit the price above or set it on the part first.' : '; set a price on the part before selling it.'}</div>}

          <label>Labour / Service <span className="optional">Optional</span><input type="number" min={0} step="0.01" value={labourDisplay} onChange={(e) => setLabourDisplay(e.target.value)} /></label>

          <div className="form-row">
            <label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>{SALES_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Payment status<select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>{SALES_PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          </div>
          {isMpesa && <div className="form-row">
            <label>M-Pesa transaction code<input value={mpesaCode} onChange={(e) => setMpesaCode(e.target.value.toUpperCase())} placeholder="e.g. QGH7XXXXXX" required /></label>
            <label>Time money was sent<input type="datetime-local" value={mpesaSentAt} max={nowForInput()} onChange={(e) => setMpesaSentAt(e.target.value)} required /></label>
          </div>}
          {paymentStatus === 'PARTIAL' && <label>Amount paid (KES)<input type="number" min={0} step="0.01" value={partialPaidDisplay} onChange={(e) => setPartialPaidDisplay(e.target.value)} /></label>}

          <label>Remarks <span className="optional">Optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 46 }} /></label>

          <div className="detail-info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="info-card"><div><span>Spares total</span><strong>{formatKes(spareTotalMinor)}</strong></div></div>
            <div className="info-card"><div><span>Labour/Service</span><strong>{formatKes(labourMinor)}</strong></div></div>
            <div className="info-card"><div><span>Total due</span><strong>{formatKes(totalMinor)}</strong></div></div>
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
