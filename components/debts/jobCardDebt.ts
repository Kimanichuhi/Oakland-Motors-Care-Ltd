import { supabase } from '@/lib/supabase';
import { computeLineTotal } from '@/lib/formatting';
import { getTaxRate } from '@/lib/settings';

export type JobCardDebtRow = {
  id: string;
  job_number: string;
  complaint: string | null;
  created_at: string;
  customer_name: string | null;
  registration_number: string | null;
  technician_name: string | null;
  balance_minor: number;
};

type JobCardDebtQueryRow = {
  id: string;
  job_number: string;
  complaint: string | null;
  created_at: string;
  other_charges_minor: number;
  customers: { full_name: string } | null;
  vehicles: { registration_number: string } | null;
  job_card_labour: { quantity: number; unit_price_minor: number; tax_rate: number }[];
  job_card_parts: { quantity: number; unit_price_minor: number }[];
  job_card_signoffs: { role: string; name: string }[];
  invoices: { status: string; total_minor: number; amount_paid_minor: number }[];
};

/** Job-card debt is never duplicated into debt_records — it's read live here (same
 * calculation JobDetail and the Work Orders list use) so it can never drift out of
 * sync with the invoices/payments it's actually derived from. */
export async function fetchJobCardDebts(): Promise<JobCardDebtRow[]> {
  const taxRate = await getTaxRate();
  const { data } = await supabase
    .from('job_cards')
    .select('id,job_number,complaint,created_at,other_charges_minor,customers(full_name),vehicles(registration_number),job_card_labour(quantity,unit_price_minor,tax_rate),job_card_parts(quantity,unit_price_minor),job_card_signoffs(role,name),invoices(status,total_minor,amount_paid_minor)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(300);

  const rows = (data ?? []) as unknown as JobCardDebtQueryRow[];
  return rows
    .map((j) => {
      const labourTotal = (j.job_card_labour ?? []).reduce((s, l) => s + computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate), 0);
      const partsTotal = (j.job_card_parts ?? []).reduce((s, p) => s + computeLineTotal(p.quantity, p.unit_price_minor, taxRate), 0);
      const total = labourTotal + partsTotal + (j.other_charges_minor ?? 0);
      const invoice = (j.invoices ?? []).find((inv) => inv.status !== 'VOID');
      const amountPaid = invoice?.amount_paid_minor ?? 0;
      const technician = (j.job_card_signoffs ?? []).find((s) => s.role === 'TECHNICIAN');
      return {
        id: j.id,
        job_number: j.job_number,
        complaint: j.complaint,
        created_at: j.created_at,
        customer_name: j.customers?.full_name ?? null,
        registration_number: j.vehicles?.registration_number ?? null,
        technician_name: technician?.name ?? null,
        balance_minor: Math.max(0, total - amountPaid),
      };
    })
    .filter((r) => r.balance_minor > 0);
}
