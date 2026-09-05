import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapItem, ScrapCurrentStockRow, ScrapCashSummary, ScrapSettings } from '@/lib/types';
import { formatKes, formatKg, localDateStr, addDaysLocal } from '@/lib/formatting';
import {
  LayoutDashboard, Boxes, ClipboardList, Gauge, Plus, Settings, Banknote,
  Wallet, Package, AlertTriangle, ArrowRight, Download,
} from 'lucide-react';
import ScrapRecordsHistory from './ScrapRecordsHistory';
import ScrapStockTab from './ScrapStockTab';
import ScrapReports from './ScrapReports';
import ScrapItemsManager from './ScrapItemsManager';
import ScrapExportDialog from './ScrapExportDialog';
import { ScrapClearanceForm, ScrapNewCycleForm, ScrapOpeningCashForm } from './ScrapStockActions';
import { ScrapPurchaseForm, ScrapExpenseForm, ScrapCashForm } from './ScrapEntryForms';

type TabId = 'dashboard' | 'records' | 'stock' | 'reports';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
  { id: 'records', label: 'Daily Records', icon: <ClipboardList size={15} /> },
  { id: 'stock', label: 'Stock', icon: <Boxes size={15} /> },
  { id: 'reports', label: 'Reports', icon: <Gauge size={15} /> },
];

export default function ScrapSection({ can, onNotice }: { can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [tab, setTab] = useState<TabId>('dashboard');
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
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showCashForm, setShowCashForm] = useState(false);
  const [showClearanceForm, setShowClearanceForm] = useState(false);
  const [showNewCycleForm, setShowNewCycleForm] = useState(false);
  const [showOpeningCashForm, setShowOpeningCashForm] = useState(false);
  const [showItemsManager, setShowItemsManager] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

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
      setItems((itemRows ?? []) as ScrapItem[]);
      setStock((stockRows ?? []) as ScrapCurrentStockRow[]);
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
        <div><p className="eyebrow">Scrap yard</p><h1>Joseph&apos;s Scrap Management</h1><p className="muted">Daily scrap purchases, cash control, stock cycles and reporting.</p></div>
        <div className="heading-actions">
          {can('scrap.manage') && <button className="button secondary" onClick={() => setShowExportDialog(true)}><Download size={16} /> Export CSV</button>}
          {can('scrap.manage') && <button className="button secondary" onClick={() => setShowItemsManager(true)}><Settings size={16} /> Scrap types</button>}
        </div>
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
          <div className="panel-heading"><div><p className="eyebrow">Data entry</p><h3>Working date</h3></div></div>
          <div className="scrap-workdate-row">
            <label>Working date<input type="date" value={workingDate} max={localDateStr()} onChange={(e) => { setWorkingDate(e.target.value); setChangeInDays(0); }} /></label>
            <label>Change in days<input type="number" min={0} value={changeInDays} onChange={(e) => setChangeInDays(Math.max(0, parseInt(e.target.value) || 0))} /></label>
            <div className="scrap-resolved-date"><ArrowRight size={16} /><div><span>Entries will use</span><strong>{resolvedDate}</strong></div></div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>Leave Change in Days at 0 to keep entering on the same date. Set it to advance the working date once Joseph moves to a new day.</p>
          <div className="action-buttons" style={{ marginTop: 16 }}>
            {can('scrap.record') && <button className="button primary" onClick={() => setShowPurchaseForm(true)}><Plus size={15} /> Add Purchase</button>}
            {can('scrap.record') && <button className="button secondary" onClick={() => setShowExpenseForm(true)}><Plus size={15} /> Add Expense</button>}
            {can('scrap.record') && <button className="button secondary" onClick={() => setShowCashForm(true)}><Banknote size={15} /> Add Cash</button>}
          </div>
        </section>
      )}

      <div className="subtab-bar">
        {TABS.map((t) => <button key={t.id} className={`subtab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}
      </div>

      {tab === 'dashboard' && (
        <>
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
          <p className="eyebrow" style={{ marginBottom: 10 }}>Current stock by scrap type</p>
          <ScrapStockTab stock={stock} can={can} onClear={() => setShowClearanceForm(true)} onNewCycle={() => setShowNewCycleForm(true)} onNotice={onNotice} onRefresh={refresh} />
        </>
      )}

      {tab === 'records' && <ScrapRecordsHistory can={can} onNotice={onNotice} onRefresh={refresh} refreshKey={refreshKey} />}
      {tab === 'stock' && <ScrapStockTab stock={stock} can={can} onClear={() => setShowClearanceForm(true)} onNewCycle={() => setShowNewCycleForm(true)} onNotice={onNotice} onRefresh={refresh} />}
      {tab === 'reports' && <ScrapReports />}

      {showPurchaseForm && <ScrapPurchaseForm resolvedDate={resolvedDate} changeInDays={changeInDays} can={can} onClose={() => setShowPurchaseForm(false)} onSaved={handleEntrySaved} />}
      {showExpenseForm && <ScrapExpenseForm resolvedDate={resolvedDate} changeInDays={changeInDays} can={can} onClose={() => setShowExpenseForm(false)} onSaved={handleEntrySaved} />}
      {showCashForm && <ScrapCashForm resolvedDate={resolvedDate} changeInDays={changeInDays} onClose={() => setShowCashForm(false)} onSaved={handleEntrySaved} />}
      {showClearanceForm && <ScrapClearanceForm items={stock} onClose={() => setShowClearanceForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {showNewCycleForm && <ScrapNewCycleForm items={stock} onClose={() => setShowNewCycleForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {showOpeningCashForm && <ScrapOpeningCashForm onClose={() => setShowOpeningCashForm(false)} onSaved={(m) => { onNotice(m); refresh(); }} />}
      {showItemsManager && <ScrapItemsManager items={items} can={can} onClose={() => setShowItemsManager(false)} onChanged={refresh} onNotice={onNotice} />}
      {showExportDialog && <ScrapExportDialog onClose={() => setShowExportDialog(false)} />}
    </div>
  );
}
