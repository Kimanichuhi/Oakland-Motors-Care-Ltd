import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScrapItem } from '@/lib/types';
import { formatKes } from '@/lib/formatting';
import { X, Plus, Pencil, Check, Ban, AlertTriangle } from 'lucide-react';

export default function ScrapItemsManager({ items, onClose, onChanged, onNotice, can }: {
  items: ScrapItem[];
  onClose: () => void;
  onChanged: () => void;
  onNotice: (m: string) => void;
  can: (p: string) => boolean;
}) {
  const canManage = can('scrap.manage');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRate, setEditRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [adding, setAdding] = useState(false);

  function startEdit(item: ScrapItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditRate(item.current_rate_minor === null ? '' : (item.current_rate_minor / 100).toString());
  }

  async function saveEdit(item: ScrapItem) {
    setError('');
    const name = editName.trim();
    if (!name) { setError('Name is required.'); return; }
    setBusy(true);
    try {
      const { error: renameErr } = await supabase.rpc('scrap_update_item', { p_id: item.id, p_name: name, p_active: item.active });
      if (renameErr) throw renameErr;
      const rateMinor = editRate.trim() === '' ? null : Math.round(parseFloat(editRate) * 100);
      if (rateMinor !== null && rateMinor !== item.current_rate_minor) {
        const { error: rateErr } = await supabase.rpc('scrap_set_item_rate', { p_id: item.id, p_rate_minor: rateMinor });
        if (rateErr) throw rateErr;
      }
      setEditingId(null);
      onChanged();
      onNotice('Scrap type updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update scrap type.');
    } finally { setBusy(false); }
  }

  async function toggleActive(item: ScrapItem) {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('scrap_update_item', { p_id: item.id, p_name: item.name, p_active: !item.active });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onChanged();
    onNotice(item.active ? `${item.name} deactivated.` : `${item.name} activated.`);
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const name = newName.trim();
    if (!name) { setError('Name is required.'); return; }
    setAdding(true);
    try {
      const rateMinor = newRate.trim() === '' ? null : Math.round(parseFloat(newRate) * 100);
      const { error: err } = await supabase.rpc('scrap_add_item', { p_name: name, p_rate_minor: rateMinor });
      if (err) throw err;
      setNewName(''); setNewRate('');
      onChanged();
      onNotice(`${name} added to scrap types.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add scrap type.');
    } finally { setAdding(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(640px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Scrap yard</p><h2>Scrap types &amp; rates</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>

        {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}

        <div className="data-table">
          {items.map((item) => (
            <div className="table-row" key={item.id}>
              {editingId === item.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                  <input type="number" min={0} step="0.01" value={editRate} onChange={(e) => setEditRate(e.target.value)} placeholder="Rate/kg" style={{ width: 100, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
                  <button className="button primary small" disabled={busy} onClick={() => void saveEdit(item)}><Check size={14} /></button>
                  <button className="close-button" style={{ width: 28, height: 28 }} onClick={() => setEditingId(null)}><X size={14} /></button>
                </>
              ) : (
                <>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.current_rate_minor === null ? 'Rate not set' : `${formatKes(item.current_rate_minor)} / kg`}</span>
                  </div>
                  <span className={`status ${item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.active ? 'Active' : 'Inactive'}</span>
                  {canManage && <>
                    <button className="close-button" style={{ width: 28, height: 28 }} title="Edit" onClick={() => startEdit(item)}><Pencil size={14} /></button>
                    <button className="close-button" style={{ width: 28, height: 28 }} title={item.active ? 'Deactivate' : 'Activate'} onClick={() => void toggleActive(item)}><Ban size={14} /></button>
                  </>}
                </>
              )}
            </div>
          ))}
        </div>

        {canManage && (
          <form onSubmit={addItem} className="form-row" style={{ marginTop: 18, gridTemplateColumns: '1fr 120px auto' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New scrap type name" required />
            <input type="number" min={0} step="0.01" value={newRate} onChange={(e) => setNewRate(e.target.value)} placeholder="Rate/kg (optional)" />
            <button className="button primary small" type="submit" disabled={adding}><Plus size={15} /> Add</button>
          </form>
        )}
      </div>
    </div>
  );
}
