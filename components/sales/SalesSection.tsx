import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Sale } from '@/lib/types';
import { formatKes, formatDateTime } from '@/lib/formatting';
import { statusStyles } from '@/lib/constants';
import { ShoppingCart, ChevronRight, Plus, Search } from 'lucide-react';

export default function SalesSection({ query, onNew, onSelect, can }: { query: string; onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      let q = supabase.from('sales').select('*').order('sale_date', { ascending: false }).limit(200);
      if (query) q = q.or(`sale_number.ilike.%${query}%,customer_name.ilike.%${query}%,customer_phone.ilike.%${query}%`);
      const { data } = await q;
      if (!mounted) return;
      setSales((data ?? []) as Sale[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [query]);

  return (
    <div>
      <div className="panel-heading">
        <div><p className="eyebrow">Spare parts sales</p><h3>Sales</h3></div>
        <div>{can('sales.create') && <button className="button primary" onClick={onNew}><Plus size={15} /> New sale</button>}</div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : sales.length === 0 ? <div className="empty"><Search size={18} /><strong>No sales yet</strong><span>Completed sales will appear here.</span></div> : <div className="panel"><div className="data-table">
        {sales.map((s) => <div key={s.id} className="table-row clickable" onClick={() => onSelect(s.id)}>
          <div className="job-icon"><ShoppingCart size={17} /></div>
          <div><strong>{s.sale_number}</strong><span>{s.customer_name || s.customer_type.replaceAll('_', ' ')}{s.customer_phone ? ` · ${s.customer_phone}` : ''} · {formatDateTime(s.sale_date)}</span></div>
          <span className="table-muted">{formatKes(s.total_minor)}</span>
          <span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status.replaceAll('_', ' ')}</span>
          <ChevronRight size={17} className="row-arrow" />
        </div>)}
      </div></div>}
    </div>
  );
}
