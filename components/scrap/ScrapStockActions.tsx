import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCurrentStockRow, ScrapStockAdjustment } from '@/lib/types';
import { formatKg, displayToMinor } from '@/lib/formatting';
import { X, AlertTriangle, PackageMinus, RotateCcw, CircleDollarSign } from 'lucide-react';

function today(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function ScrapClearanceForm({ items, onClose, onSaved }: { items: ScrapCurrentStockRow[]; onClose: () => void; onSaved: (m: string) => void }) {
  const withStock = items.filter((i) => i.current_quantity > 0);
  const [itemId, setItemId] = useState(withStock[0]?.scrap_item_id ?? '');
  const [mode, setMode] = useState<'PARTIAL' | 'FULL'>('PARTIAL');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [authorizedBy, setAuthorizedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = withStock.find((i) => i.scrap_item_id === itemId) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!selected) { setError('Select a scrap type with stock to clear.'); return; }
    if (mode === 'PARTIAL' && (!quantity || parseFloat(quantity) <= 0)) { setError('Enter a clearance quantity.'); return; }
    if (mode === 'PARTIAL' && parseFloat(quantity) > selected.current_quantity) { setError(`Clearance cannot exceed current stock (${formatKg(selected.current_quantity)}).`); return; }

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('scrap_clear_stock', {
        p_scrap_item_id: itemId,
        p_quantity: mode === 'FULL' ? null : parseFloat(quantity),
        p_full: mode === 'FULL',
        p_reason: reason,
        p_authorized_by: authorizedBy,
        p_notes: notes || null,
        p_date: date,
      });
      if (rpcError) throw rpcError;
      const adjustment = data as ScrapStockAdjustment;
      onSaved(`Cleared ${formatKg(adjustment.quantity)} of ${selected.name}. Remaining ${formatKg(adjustment.resulting_stock)}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record the stock clearance.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Stock clearance</p><h2>Clear / adjust stock</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        {withStock.length === 0 ? <div className="empty"><PackageMinus size={18} /><strong>No stock to clear</strong><span>Every scrap type is currently at zero.</span></div> : (
          <form onSubmit={submit} className="modal-form">
            <label>Scrap type<select value={itemId} onChange={(e) => { setItemId(e.target.value); setQuantity(''); }}>
              {withStock.map((i) => <option key={i.scrap_item_id} value={i.scrap_item_id}>{i.name} — {formatKg(i.current_quantity)} available</option>)}
            </select></label>
            <div className="form-row">
              <label>Date<input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></label>
              <label>Clearance type<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="PARTIAL">Partial clearance</option>
                <option value="FULL">Full clearance (all)</option>
              </select></label>
            </div>
            {mode === 'PARTIAL' && <label>Quantity to clear (KG)<input type="number" min={0} max={selected?.current_quantity} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></label>}
            {mode === 'FULL' && selected && <div className="info-card"><div><span>Will clear all</span><strong>{formatKg(selected.current_quantity)}</strong></div></div>}
            <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sold to recycler" required /></label>
            <label>Authorized by<input value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} placeholder="Name of the person authorizing this" required /></label>
            <label>Notes <span className="optional">Optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
              <button className="button primary wide" disabled={busy} type="submit"><PackageMinus size={15} /> {busy ? 'Saving…' : 'Record clearance'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function ScrapNewCycleForm({ items, onClose, onSaved }: { items: ScrapCurrentStockRow[]; onClose: () => void; onSaved: (m: string) => void }) {
  const eligible = items.filter((i) => i.current_quantity === 0);
  const [itemId, setItemId] = useState(eligible[0]?.scrap_item_id ?? '');
  const [openingQuantity, setOpeningQuantity] = useState('0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!itemId) { setError('Select a scrap type.'); return; }
    const qty = parseFloat(openingQuantity) || 0;
    if (qty > 0 && !reason.trim()) { setError('Enter a reason/source for the opening stock.'); return; }

    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('scrap_start_new_cycle', { p_scrap_item_id: itemId, p_opening_quantity: qty, p_reason: reason || null });
      if (rpcError) throw rpcError;
      const item = eligible.find((i) => i.scrap_item_id === itemId);
      onSaved(`New stock cycle started for ${item?.name ?? 'scrap type'}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start a new stock cycle.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(500px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Stock cycles</p><h2>Start new stock cycle</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        {eligible.length === 0 ? <div className="empty"><RotateCcw size={18} /><strong>Nothing to start</strong><span>Every scrap type still has an open cycle with stock remaining.</span></div> : (
          <form onSubmit={submit} className="modal-form">
            <label>Scrap type<select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {eligible.map((i) => <option key={i.scrap_item_id} value={i.scrap_item_id}>{i.name}</option>)}
            </select></label>
            <label>Opening quantity (KG)<input type="number" min={0} step="0.01" value={openingQuantity} onChange={(e) => setOpeningQuantity(e.target.value)} /></label>
            {parseFloat(openingQuantity) > 0 && <label>Reason / source of opening stock<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Physical stock count found on site" required /></label>}
            {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
              <button className="button primary wide" disabled={busy} type="submit"><RotateCcw size={15} /> {busy ? 'Starting…' : 'Start new cycle'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function ScrapOpeningCashForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('scrap_set_opening_cash', { p_date: date, p_amount_minor: displayToMinor(parseFloat(amount) || 0), p_notes: notes || null });
      if (rpcError) throw rpcError;
      onSaved('Opening cash balance established.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set the opening cash balance.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(460px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap cash</p><h2>Set opening cash balance</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <p className="muted">This establishes the starting point for the scrap yard&apos;s cash history. It can only be set once, before the first daily record is created.</p>
        <form onSubmit={submit} className="modal-form">
          <label>Opening cash (KES)<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>As of date<input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} type="submit">{busy ? 'Saving…' : 'Set opening balance'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ScrapClearanceSaleForm({ adjustment, onClose, onSaved }: { adjustment: ScrapStockAdjustment; onClose: () => void; onSaved: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [buyer, setBuyer] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('scrap_record_clearance_sale', {
        p_stock_adjustment_id: adjustment.id,
        p_amount_minor: displayToMinor(parseFloat(amount) || 0),
        p_buyer: buyer || null,
        p_reference: reference || null,
        p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      onSaved('Clearance proceeds recorded.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record clearance proceeds.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(460px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Optional financial event</p><h2>Record clearance proceeds</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <p className="muted">This records money received for the cleared stock. It is a separate transaction and does not affect Joseph&apos;s daily cash record.</p>
        <form onSubmit={submit} className="modal-form">
          <label>Amount received (KES)<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Buyer <span className="optional">Optional</span><input value={buyer} onChange={(e) => setBuyer(e.target.value)} /></label>
          <label>Reference <span className="optional">Optional</span><input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} type="submit"><CircleDollarSign size={15} /> {busy ? 'Saving…' : 'Record proceeds'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
