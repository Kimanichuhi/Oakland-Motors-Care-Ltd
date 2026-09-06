import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Sale, SaleItem } from '@/lib/types';
import { formatKes, formatDateTime } from '@/lib/formatting';
import { statusStyles } from '@/lib/constants';
import { ShoppingCart, ChevronRight, User, Phone, CreditCard, CircleDollarSign, Ban } from 'lucide-react';

type SaleWithItems = Sale & { sale_items: SaleItem[]; job_cards: { job_number: string } | null };

export default function SaleDetail({ id, onBack, onNotice, can }: { id: string; onBack: () => void; onNotice?: (m: string) => void; can: (p: string) => boolean }) {
  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState(false);
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

  if (loading) return <div className="empty"><strong>Loading…</strong></div>;
  if (!sale) return <div className="empty"><strong>{loadError ? `Unable to load sale: ${loadError}` : 'Sale not found'}</strong></div>;

  return (
    <div>
      <div className="back-bar"><button onClick={onBack}><ChevronRight size={16} className="back-icon" /> Sales</button></div>
      <div className="detail-header">
        <div className="detail-avatar"><ShoppingCart size={22} /></div>
        <div className="flex-1"><h2>{sale.sale_number}</h2><p className="muted">{sale.customer_name || sale.customer_type.replaceAll('_', ' ')}{sale.customer_phone ? ` · ${sale.customer_phone}` : ''}{sale.job_cards?.job_number ? ` · Work Order ${sale.job_cards.job_number}` : ''} · {formatDateTime(sale.sale_date)}</p></div>
        <span className={`status ${statusStyles[sale.status] ?? ''}`}>{sale.status.replaceAll('_', ' ')}</span>
      </div>

      <div className="detail-info-grid">
        <div className="info-card"><User size={16} /> <div><span>Customer type</span><strong>{sale.customer_type.replaceAll('_', ' ')}</strong></div></div>
        <div className="info-card"><CreditCard size={16} /> <div><span>Payment</span><strong>{sale.payment_method.replaceAll('_', ' ')} · {sale.payment_status}</strong>{sale.payment_reference && <span>{sale.payment_reference}{sale.payment_reference_at ? ` · ${formatDateTime(sale.payment_reference_at)}` : ''}</span>}</div></div>
        <div className="info-card"><CircleDollarSign size={16} /> <div><span>Salesperson</span><strong>{sale.salesperson_name ?? '—'}</strong></div></div>
        <div className="info-card"><CircleDollarSign size={16} /> <div><span>Balance due</span><strong>{formatKes(sale.balance_minor)}</strong></div></div>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow">Items</p><h3>Sale items</h3></div></div>
        {sale.sale_items.length === 0 ? <div className="empty"><strong>No items</strong></div> : <div className="data-table">
          {sale.sale_items.map((it) => <div key={it.id} className="table-row">
            <div className="job-icon"><ShoppingCart size={16} /></div>
            <div><strong>{it.part_name}</strong><span>{it.part_sku}{it.returned_quantity > 0 ? ` · ${it.returned_quantity} returned` : ''}</span></div>
            <span className="table-muted">{it.quantity} × {formatKes(it.unit_price_minor)}</span>
            <span className="table-muted">{formatKes(it.line_total_minor)}</span>
          </div>)}
        </div>}
      </section>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-heading"><div><p className="eyebrow">Summary</p><h3>Totals</h3></div></div>
        <div className="status-row"><strong>Subtotal</strong><span>{formatKes(sale.subtotal_minor)}</span></div>
        <div className="status-row"><strong>Discount</strong><span>-{formatKes(sale.discount_minor)}</span></div>
        <div className="status-row"><strong>Total</strong><span>{formatKes(sale.total_minor)}</span></div>
        <div className="status-row"><strong>Amount paid</strong><span>{formatKes(sale.amount_paid_minor)}</span></div>
        <div className="status-row"><strong>Balance</strong><span>{formatKes(sale.balance_minor)}</span></div>
        {sale.status === 'VOIDED' && <div className="status-row"><strong>Void reason</strong><span>{sale.void_reason ?? '—'}</span></div>}
      </section>

      <div className="action-buttons" style={{ marginTop: 16 }}>
        <button className="button secondary" onClick={onBack}>Back</button>
        {can('sales.void') && sale.status === 'COMPLETED' && !sale.job_card_id && <button className="button secondary" disabled={voiding} onClick={() => void voidSale()}><Ban size={15} /> {voiding ? 'Voiding…' : 'Void sale'}</button>}
        {sale.job_card_id && sale.status === 'COMPLETED' && <p className="muted">Generated from a job card — reverse it from the work order instead of voiding here.</p>}
      </div>
    </div>
  );
}
