/*
# Oakland Motors M-Pesa transactions table

Stores M-Pesa Daraja STK push transaction records for reconciliation and idempotency.
*/
CREATE TABLE IF NOT EXISTS public.mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_request_id text,
  checkout_request_id text UNIQUE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  result_code integer,
  result_description text,
  amount integer,
  receipt_number text,
  transaction_date timestamptz,
  phone text,
  callback_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mpesa_tx_checkout_idx ON public.mpesa_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS mpesa_tx_receipt_idx ON public.mpesa_transactions(receipt_number);

ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_mpesa_transactions" ON public.mpesa_transactions;
DROP POLICY IF EXISTS "staff_insert_mpesa_transactions" ON public.mpesa_transactions;
DROP POLICY IF EXISTS "staff_update_mpesa_transactions" ON public.mpesa_transactions;
DROP POLICY IF EXISTS "staff_delete_mpesa_transactions" ON public.mpesa_transactions;

CREATE POLICY "staff_select_mpesa_transactions" ON public.mpesa_transactions
  FOR SELECT TO authenticated USING (public.has_permission('payment.view'));
CREATE POLICY "staff_insert_mpesa_transactions" ON public.mpesa_transactions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_mpesa_transactions" ON public.mpesa_transactions
  FOR UPDATE TO authenticated USING (public.has_permission('payment.create')) WITH CHECK (public.has_permission('payment.create'));
CREATE POLICY "staff_delete_mpesa_transactions" ON public.mpesa_transactions
  FOR DELETE TO authenticated USING (public.has_permission('settings.manage'));
