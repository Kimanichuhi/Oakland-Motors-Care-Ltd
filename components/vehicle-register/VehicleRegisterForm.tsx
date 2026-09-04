import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VehicleRegisterEntry } from '@/lib/types';
import { localDateStr, localTimeStr } from '@/lib/formatting';
import { X, Plus, Save, AlertTriangle, Ban } from 'lucide-react';

function normalizeReg(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export default function VehicleRegisterForm({ entry, onClose, onSaved, can }: {
  entry?: VehicleRegisterEntry;
  onClose: () => void;
  onSaved: (m: string) => void;
  can: (p: string) => boolean;
}) {
  const isEdit = !!entry;
  const [date, setDate] = useState(entry?.date ?? localDateStr());
  const [regNo, setRegNo] = useState(entry?.registration_number ?? '');
  const [makeModel, setMakeModel] = useState(entry?.make_model ?? '');
  const [timeIn, setTimeIn] = useState(entry?.time_in?.slice(0, 5) ?? localTimeStr());
  const [timeOut, setTimeOut] = useState(entry?.time_out?.slice(0, 5) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);

  useEffect(() => { setConfirmedDuplicate(false); setDuplicateWarning(null); }, [regNo, date]);

  async function checkDuplicate(normalizedReg: string): Promise<boolean> {
    if (isEdit) return false;
    const { data } = await supabase
      .from('vehicle_register')
      .select('created_at')
      .eq('status', 'ACTIVE')
      .eq('date', date)
      .ilike('registration_number', normalizedReg)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return false;
    const minutesAgo = (Date.now() - new Date(data.created_at as string).getTime()) / 60000;
    return minutesAgo < 120;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const normalizedReg = normalizeReg(regNo);
    const trimmedMakeModel = makeModel.trim();
    if (!normalizedReg) { setError('Registration number is required.'); return; }
    if (!trimmedMakeModel) { setError('Make / Model is required.'); return; }
    if (!date) { setError('Date is required.'); return; }
    if (!timeIn) { setError('Time In is required.'); return; }
    if (timeOut && timeOut <= timeIn) { setError('Time Out must be later than Time In.'); return; }

    if (!isEdit && !confirmedDuplicate) {
      const isDuplicate = await checkDuplicate(normalizedReg);
      if (isDuplicate) {
        setDuplicateWarning(`${normalizedReg} already has a recent register entry today. Are you sure you want to continue?`);
        return;
      }
    }

    setBusy(true);
    try {
      if (isEdit) {
        const { error: updateError } = await supabase.from('vehicle_register').update({
          date, registration_number: normalizedReg, make_model: trimmedMakeModel,
          time_in: timeIn, time_out: timeOut || null,
        }).eq('id', entry!.id);
        if (updateError) throw updateError;
        onSaved('Vehicle register updated successfully.');
      } else {
        const { error: insertError } = await supabase.from('vehicle_register').insert({
          date, registration_number: normalizedReg, make_model: trimmedMakeModel,
          time_in: timeIn, time_out: timeOut || null,
        });
        if (insertError) throw insertError;
        onSaved(`Vehicle ${normalizedReg} registered successfully.`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this vehicle register entry.');
    } finally { setBusy(false); }
  }

  async function voidEntry() {
    if (!entry) return;
    const reason = window.prompt(`Reason for voiding this register entry for ${entry.registration_number}?`);
    if (!reason) return;
    setBusy(true);
    const { error: voidError } = await supabase.from('vehicle_register').update({ status: 'VOID', void_reason: reason }).eq('id', entry.id);
    setBusy(false);
    if (voidError) { setError(voidError.message); return; }
    onSaved('Vehicle register entry voided.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">Vehicle register</p><h2>{isEdit ? 'Edit register entry' : 'Register Vehicle'}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit} className="modal-form">
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>Reg. No.<input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. KDA 123A" required /></label>
          <label>Make / Model<input value={makeModel} onChange={(e) => setMakeModel(e.target.value)} placeholder="e.g. Toyota Fielder" required /></label>
          <div className="form-row">
            <label>Time In<input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} required /></label>
            <label>Time Out <span className="optional">Optional</span><input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} /></label>
          </div>

          {duplicateWarning && (
            <div className="form-error">
              <AlertTriangle size={14} /> {duplicateWarning}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="button secondary small" onClick={() => { setConfirmedDuplicate(true); setDuplicateWarning(null); }}>Continue anyway</button>
              </div>
            </div>
          )}
          {error && <div className="form-error"><AlertTriangle size={14} /> {error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary wide" disabled={busy} type="submit">
              {isEdit ? <Save size={15} /> : <Plus size={15} />} {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Save Vehicle'}
            </button>
          </div>
          {isEdit && entry!.status === 'ACTIVE' && can('vehicle_register.manage') && (
            <button type="button" className="switch-auth" onClick={() => void voidEntry()}><Ban size={13} style={{ marginRight: 4 }} /> Void this entry</button>
          )}
        </form>
      </div>
    </div>
  );
}
