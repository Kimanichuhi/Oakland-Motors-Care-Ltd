import { supabase } from '@/lib/supabase';

export type PurgeEntity = 'customers' | 'vehicles' | 'job_cards' | 'quotations' | 'invoices' | 'sales' | 'purchase_orders' | 'suppliers' | 'parts';

function confirmDelete(prompt: string): { confirmed: boolean; message: string } {
  let typed: string | null;
  try {
    typed = window.prompt(prompt);
  } catch {
    return { confirmed: false, message: 'Your browser blocked the confirmation dialog for this deletion, so nothing was deleted. Please try again in a normal browser tab (not an embedded preview).' };
  }
  if (typed === null) return { confirmed: false, message: '' };
  if (typed.trim().toUpperCase() !== 'DELETE') return { confirmed: false, message: 'Deletion cancelled — confirmation text did not match.' };
  return { confirmed: true, message: '' };
}

export async function purgeRecord(entity: PurgeEntity, id: string, label: string): Promise<{ ok: boolean; message: string }> {
  try {
    const confirm = confirmDelete(`This permanently deletes ${label}. This cannot be undone — it does not go to a bin, it is gone.\n\nType DELETE to confirm.`);
    if (!confirm.confirmed) return { ok: false, message: confirm.message };
    const { error } = await supabase.rpc('admin_purge_record', { p_entity: entity, p_id: id });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `${label} was permanently deleted.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong while deleting this record. Please try again.' };
  }
}

export async function purgeVehicleAndHistory(id: string, label: string, historyNote: string): Promise<{ ok: boolean; message: string }> {
  try {
    const confirm = confirmDelete(`This permanently deletes ${label} AND ${historyNote}. This cannot be undone — none of it goes to a bin, it is all gone.\n\nType DELETE to confirm.`);
    if (!confirm.confirmed) return { ok: false, message: confirm.message };
    const { error } = await supabase.rpc('admin_purge_vehicle_and_history', { p_vehicle_id: id });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `${label} and its full history were permanently deleted.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong while deleting this record. Please try again.' };
  }
}
