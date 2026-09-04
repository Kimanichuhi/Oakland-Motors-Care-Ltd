import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VehicleRegisterEntry } from '@/lib/types';
import { formatDate, formatTime, localTimeStr } from '@/lib/formatting';
import { X, LogOut, AlertTriangle, History } from 'lucide-react';

export function VehicleTimeOutConfirm({ entry, onClose, onSaved }: { entry: VehicleRegisterEntry; onClose: () => void; onSaved: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.from('vehicle_register').update({ time_out: localTimeStr() }).eq('id', entry.id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    onSaved(`Time Out recorded for ${entry.registration_number}.`);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(420px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Vehicle register</p><h2>Record Time Out</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <p className="muted">Record Time Out for <strong>{entry.registration_number}</strong>?</p>
        {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary wide" disabled={busy} onClick={() => void confirm()}><LogOut size={15} /> {busy ? 'Recording…' : 'Confirm Time Out'}</button>
        </div>
      </div>
    </div>
  );
}

export function VehicleHistoryModal({ registrationNumber, onClose }: { registrationNumber: string; onClose: () => void }) {
  const [visits, setVisits] = useState<VehicleRegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.from('vehicle_register').select('*').ilike('registration_number', registrationNumber).eq('status', 'ACTIVE').order('date', { ascending: false }).limit(50).then(({ data }) => {
      if (!mounted) return;
      setVisits((data ?? []) as VehicleRegisterEntry[]);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [registrationNumber]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Visit history</p><h2>{registrationNumber}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        {loading ? <div className="empty"><strong>Loading…</strong></div> : visits.length === 0 ? (
          <div className="empty"><History size={18} /><strong>No previous visits</strong></div>
        ) : (
          <div className="data-table">
            {visits.map((v) => (
              <div className="table-row" key={v.id}>
                <div><strong>{formatDate(v.date)}</strong><span>{v.make_model}</span></div>
                <span className="table-muted">In {formatTime(v.time_in)}</span>
                <span className="table-muted">Out {formatTime(v.time_out)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
