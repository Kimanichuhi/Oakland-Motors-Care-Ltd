import { supabase } from '@/lib/supabase';

export type SalesDebtRow = {
  id: string;
  sale_number: string;
  sale_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  salesperson_name: string | null;
  payment_method: string;
  balance_minor: number;
};

type SalesDebtQueryRow = {
  id: string;
  sale_number: string;
  sale_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  salesperson_name: string | null;
  payment_method: string;
  balance_minor: number;
};

/** Credit/partially-paid sales, read live from `sales` — same source SalesSection's
 * own "Debt" column uses — so it can never drift out of sync with payments recorded there.
 * Sales the app generates from a job card's parts (customer_type JOB_CARD) are excluded:
 * their value is already counted in fetchJobCardDebts() via job_card_parts, so including
 * them here would double it. Counter or day-book sales that merely reference a work order
 * are not in job_card_parts, so their unpaid balance is listed here. */
export async function fetchSalesDebts(): Promise<SalesDebtRow[]> {
  const { data } = await supabase
    .from('sales')
    .select('id,sale_number,sale_date,customer_name,customer_phone,salesperson_name,payment_method,balance_minor')
    .neq('customer_type', 'JOB_CARD')
    .neq('status', 'VOIDED')
    .gt('balance_minor', 0)
    .order('sale_date', { ascending: false })
    .limit(500);

  return ((data ?? []) as SalesDebtQueryRow[]).map((s) => ({
    id: s.id,
    sale_number: s.sale_number,
    sale_date: s.sale_date,
    customer_name: s.customer_name,
    customer_phone: s.customer_phone,
    salesperson_name: s.salesperson_name,
    payment_method: s.payment_method,
    balance_minor: s.balance_minor,
  }));
}
