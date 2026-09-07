import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapItem, ScrapCurrentStockRow, ScrapCashSummary, ScrapSettings } from '@/lib/types';
import { formatKes, formatKg, localDateStr, addDaysLocal } from '@/lib/formatting';
import { byScrapTypeOrder } from '@/lib/constants';
import { Boxes, Plus, Banknote, Wallet, Package, AlertTriangle, ArrowRight } from 'lucide-react';
import { ScrapOpeningCashForm } from './ScrapStockActions';
import { ScrapPurchaseForm } from './ScrapEntryForms';

export default function ScrapDashboardPage({ can, onNotice, onNavigateToStock }: { can: (p: string) => boolean; onNotice: (m: string) => void; onNavigateToStock: () => void }) {
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [stock, setStock] = useState<ScrapCurrentStockRow[]>([]);
  const [settings, setSettings] = useState<ScrapSettings | null>(null);
  const [todaySummary, setTodaySummary] = useState<ScrapCashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [workingDate, setWorkingDate] = useState(localDateStr());
  const [changeInDays, setChangeInDays] = useState(0);
  const resolvedDate = addDaysLocal(workingDate, changeInDays);

  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [showOpeningCashForm, setShowOpeningCashForm] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  function handleEntrySaved(message: string, savedDate: string) {
    onNotice(message);
    setWorkingDate(savedDate);
    setChangeInDays(0);
    refresh();
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const todayStr = localDateStr();
      const [{ data: itemRows }, { data: stockRows }, { data: settingsRow }, { data: today }] = await Promise.all([
        supabase.from('scrap_items').select('*').order('name'),
        supabase.from('scrap_current_stock').select('*').order('name'),
        supabase.from('scrap_settings').select('*').limit(1).maybeSingle(),
        supabase.from('scrap_cash_summary').select('*').eq('date', todayStr).maybeSingle(),
      ]);
      if (!mounted) return;
      setItems(((itemRows ?? []) as ScrapItem[]).sort(byScrapTypeOrder));
      setStock(((stockRows ?? []) as ScrapCurrentStockRow[]).sort(byScrapTypeOrder));
      setSettings(settingsRow as ScrapSettings | null);
      setTodaySummary(today as ScrapCashSummary | null);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [refreshKey]);

  const totalStockKg = stock.reduce((sum, s) => sum + s.current_quantity, 0);
  const needsOpeningBalance = !loading && settings?.opening_cash_minor == null;
  const missingRateCount = items.filter((i) => i.active && i.current_rate_minor === null).length;
  const canEnter = can('scrap.record') || can('scrap.manage');

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Scrap yard</p><h1>Overview</h1><p className="muted">Today&apos;s activity, cash position and quick entry.</p></div>
      </div>

      {needsOpeningBalance && can('scrap.manage') && (
        <div className="form-error" style={{ marginBottom: 18 }}>
          <AlertTriangle size={14} /> No opening cash balance has been set for the scrap yard yet.
          <button className="button secondary small" style={{ marginLeft: 10 }} onClick={() => setShowOpeningCashForm(true)}>Set opening balance</button>
        </div>
      )}
      {needsOpeningBalance && !can('scrap.manage') && (
        <div className="form-error" style={{ marginBottom: 18 }}><AlertTriangle size={14} /> Ask an administrator or manager to set the scrap yard&apos;s opening cash balance before the first entry can be recorded.</div>
      )}
      {missingRateCount > 0 && (
        <div className="form-error" style={{ marginBottom: 18 }}><AlertTriangle size={14} /> {missingRateCount} active scrap type{missingRateCount > 1 ? 's have' : ' has'} no rate set — purchases can&apos;t be recorded for {missingRateCount > 1 ? 'them' : 'it'} until a rate is added.</div>
      )}

      {canEnter && !needsOpeningBalance && (
        <section className="panel scrap-workdate-panel" style={{ marginBottom: 20 }}>
          <div className="panel-heading">
            <div><p className="eyebrow">Data entry</p><h3>Working date</h3><p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Leave Change in Days at 0 for the same day, or advance it once Joseph moves to a new day.</p></div>
            <div className="action-buttons">
              {can('scrap.record') && <button className="button primary small" onClick={() => setShowPurchaseForm(true)}><Plus size={14} /> Purchase</button>}
            </div>
          </div>
          <div className="scrap-workdate-row">
            <label>Working date<input type="date" value={workingDate} max={localDateStr()} onChange={(e) => { setWorkingDate(e.target.value); setChangeInDays(0); }} /></label>
            <label>Change in days<input type="number" min={0} value={changeInDays} onChange={(e) => setChangeInDays(Math.max(0, parseInt(e.target.value) || 0))} /></label>
            <div className="scrap-resolved-date"><ArrowRight size={16} /><div><span>Entries will use</span><strong>{resolvedDate}</strong></div></div>
          </div>
        </section>
      )}

      <p className="eyebrow" style={{ marginBottom: 10 }}>Today</p>
      <div className="kpi-row">
        <div className="metric-card"><div className="metric-icon navy"><Wallet size={17} /></div><div className="metric-copy"><span>Opening cash</span><strong>{todaySummary ? formatKes(todaySummary.opening_cash_minor) : '—'}</strong></div></div>
        <div className="metric-card"><div className="metric-icon gold"><Banknote size={17} /></div><div className="metric-copy"><span>Cash added</span><strong>{formatKes(todaySummary?.cash_added_minor ?? 0)}</strong></div></div>
        <div className="metric-card"><div className="metric-icon blue"><Package size={17} /></div><div className="metric-copy"><span>Scrap purchases</span><strong>{formatKes(todaySummary?.purchases_minor ?? 0)}</strong></div></div>
        <div className="metric-card"><div className="metric-icon green"><Banknote size={17} /></div><div className="metric-copy"><span>Expenses</span><strong>{formatKes(todaySummary?.expenses_minor ?? 0)}</strong></div></div>
        <div className="metric-card"><div className="metric-icon navy"><Wallet size={17} /></div><div className="metric-copy"><span>Closing cash</span><strong>{todaySummary ? formatKes(todaySummary.closing_cash_minor) : '—'}</strong></div></div>
        <div className="metric-card"><div className="metric-icon gold"><Package size={17} /></div><div className="metric-copy"><span>KG purchased today</span><strong>{formatKg(todaySummary?.total_kg_purchased ?? 0)}</strong></div></div>
      </div>
      {todaySummary?.has_discrepancy && <div className="form-error" style={{ marginBottom: 18 }}><AlertTriangle size={14} /> Today&apos;s closing cash is negative — flagged as a discrepancy for review.</div>}
      {!todaySummary && <p className="muted" style={{ marginBottom: 18 }}>No activity recorded for today yet.</p>}

      <div className="panel-heading" style={{ marginBottom: 10 }}>
        <p className="eyebrow" style={{ margin: 0 }}>Stock</p>
        <button className="button secondary small" onClick={onNavigateToStock}>View stock position <ArrowRight size={14} /></button>
      </div>
      <div className="detail-info-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <div className="info-card"><Boxes size={16} /><div><span>Total current stock</span><strong>{formatKg(totalStockKg)}</strong></div></div>
        <div className="info-card"><Package size={16} /><div><span>Estimated stock value</span><strong>{formatKes(stock.reduce((sum, s) => sum + s.current_quantity * (s.current_rate_minor ?? 0), 0))}</strong></div></div>
      </div>

      {showPurchaseForm && <ScrapPurchaseForm resolvedDate={resolvedDate} changeInDays={changeInDays} can={can} stock={stock} onClose={() => setShowPurchaseForm(false)} onSaved={handleEntrySaved} />}
      {showOpeningCashForm && <ScrapOpeningCashForm onClose={() => setShowOpeningCashForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
    </div>
  );
}
