import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapCurrentStockRow } from '@/lib/types';
import { byScrapTypeOrder } from '@/lib/constants';
import ScrapStockTab from './ScrapStockTab';
import { ScrapClearanceForm, ScrapNewCycleForm } from './ScrapStockActions';

export default function ScrapStockPage({ can, onNotice }: { can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [stock, setStock] = useState<ScrapCurrentStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showClearanceForm, setShowClearanceForm] = useState(false);
  const [showNewCycleForm, setShowNewCycleForm] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let mounted = true;
    supabase.from('scrap_current_stock').select('*').order('name').then(({ data }) => {
      if (!mounted) return;
      setStock(((data ?? []) as ScrapCurrentStockRow[]).sort(byScrapTypeOrder));
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [refreshKey]);

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Scrap yard</p><h1>Stock Position</h1><p className="muted">Current stock by scrap type, clearances and stock cycles.</p></div>
      </div>
      {loading ? <div className="empty"><strong>Loading…</strong></div> : (
        <ScrapStockTab stock={stock} can={can} onClear={() => setShowClearanceForm(true)} onNewCycle={() => setShowNewCycleForm(true)} onNotice={onNotice} onRefresh={refresh} />
      )}
      {showClearanceForm && <ScrapClearanceForm items={stock} onClose={() => setShowClearanceForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {showNewCycleForm && <ScrapNewCycleForm items={stock} onClose={() => setShowNewCycleForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
    </div>
  );
}
