/*
# Job card debt pipeline — deposits and running balance without a manual "create invoice" step

1. Problem
- Work carried out on credit (customer takes the car before paying in full, or pays a
  deposit partway through) had nowhere reliable to live. A payment could only ever be
  recorded against a job card AFTER staff manually clicked "Create invoice" — so a
  deposit taken while a job was still IN_PROGRESS had no home. Debt was also invisible
  on the Work Orders list; you had to open a job card to see its balance.

2. Fix
- ensure_job_card_invoice(job_card_id): opens (or refreshes) a running "tab" for a job
  card — the same invoices/invoice_items rows the app already used, just created lazily
  and kept in sync with the job's current labour/parts/other-charges total every time
  it's called, instead of being a one-shot snapshot taken at completion. Gated on
  payment.create or invoice.create (the same people who could already record a payment
  or issue an invoice), so it grants no new capability — it just removes the ordering
  requirement that an invoice exist first.
- Recomputing on every call means a payment or reprint always sees the current total,
  even if more labour/parts were added after the tab was first opened. If the recomputed
  total would ever drop below what's already been paid (e.g. a part removed after a
  deposit), the total is floored at amount_paid_minor so the existing
  amount_paid_minor <= total_minor check constraint can never be violated.
- Row-locks the job_cards row for the duration so two concurrent calls for the same job
  can't both decide no invoice exists yet and insert two.
*/

create or replace function public.ensure_job_card_invoice(p_job_card_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_job public.job_cards%rowtype;
  v_invoice public.invoices%rowtype;
  v_tax_rate numeric;
  v_labour_total integer := 0;
  v_parts_total integer := 0;
  v_subtotal integer;
  v_seq integer;
  v_invoice_number text;
  v_item record;
begin
  if not (public.has_permission('payment.create') or public.has_permission('invoice.create')) then
    raise exception 'Not authorized to open a running tab for this job card';
  end if;

  select * into v_job from public.job_cards where id = p_job_card_id for update;
  if not found then raise exception 'Work order not found'; end if;

  select coalesce(tax_rate, 16) into v_tax_rate from public.business_settings limit 1;

  select coalesce(sum(round(l.quantity * l.unit_price_minor) + round(round(l.quantity * l.unit_price_minor) * (l.tax_rate / 100.0))), 0)
    into v_labour_total from public.job_card_labour l where l.job_card_id = p_job_card_id;

  select coalesce(sum(round(p.quantity * p.unit_price_minor) + round(round(p.quantity * p.unit_price_minor) * (v_tax_rate / 100.0))), 0)
    into v_parts_total from public.job_card_parts p where p.job_card_id = p_job_card_id;

  v_subtotal := v_labour_total + v_parts_total + coalesce(v_job.other_charges_minor, 0);

  select * into v_invoice from public.invoices where job_card_id = p_job_card_id and status <> 'VOID' order by created_at desc limit 1;

  if found then
    v_subtotal := greatest(v_subtotal, v_invoice.amount_paid_minor);
    update public.invoices set
      subtotal_minor = v_subtotal,
      total_minor = v_subtotal,
      status = case when v_invoice.amount_paid_minor >= v_subtotal and v_subtotal > 0 then 'PAID' when v_invoice.amount_paid_minor > 0 then 'PART_PAID' else 'ISSUED' end,
      updated_by = auth.uid()
    where id = v_invoice.id;
    delete from public.invoice_items where invoice_id = v_invoice.id;
  else
    insert into public.document_number_counters(doc_type, next_seq) values ('INV', 1) on conflict (doc_type) do nothing;
    update public.document_number_counters set next_seq = next_seq + 1 where doc_type = 'INV' returning next_seq - 1 into v_seq;
    v_invoice_number := 'INV-' || lpad(v_seq::text, 3, '0');

    insert into public.invoices(invoice_number, customer_id, vehicle_id, job_card_id, subtotal_minor, discount_minor, tax_minor, total_minor, due_date, status)
    values (v_invoice_number, v_job.customer_id, v_job.vehicle_id, p_job_card_id, v_subtotal, 0, 0, v_subtotal, (current_date + interval '14 days')::date, 'ISSUED')
    returning * into v_invoice;
  end if;

  for v_item in select description, quantity, unit_price_minor, tax_rate from public.job_card_labour where job_card_id = p_job_card_id loop
    insert into public.invoice_items(invoice_id, item_type, description, quantity, unit_price_minor, tax_rate, line_total_minor)
    values (v_invoice.id, 'LABOUR', v_item.description, v_item.quantity, v_item.unit_price_minor, v_item.tax_rate,
      round(v_item.quantity * v_item.unit_price_minor) + round(round(v_item.quantity * v_item.unit_price_minor) * (v_item.tax_rate / 100.0)));
  end loop;

  for v_item in select jcp.quantity, jcp.unit_price_minor, coalesce(pt.name, 'Part') as name from public.job_card_parts jcp left join public.parts pt on pt.id = jcp.part_id where jcp.job_card_id = p_job_card_id loop
    insert into public.invoice_items(invoice_id, item_type, description, quantity, unit_price_minor, tax_rate, line_total_minor)
    values (v_invoice.id, 'PART', v_item.name, v_item.quantity, v_item.unit_price_minor, v_tax_rate,
      round(v_item.quantity * v_item.unit_price_minor) + round(round(v_item.quantity * v_item.unit_price_minor) * (v_tax_rate / 100.0)));
  end loop;

  if coalesce(v_job.other_charges_minor, 0) > 0 then
    insert into public.invoice_items(invoice_id, item_type, description, quantity, unit_price_minor, tax_rate, line_total_minor)
    values (v_invoice.id, 'OTHER', 'Other charges', 1, v_job.other_charges_minor, 0, v_job.other_charges_minor);
  end if;

  perform public.log_audit('OPEN_JOB_CARD_TAB', 'invoices', v_invoice.id, null, jsonb_build_object('job_card_id', p_job_card_id, 'subtotal_minor', v_subtotal));
  return v_invoice.id;
end; $$;
revoke all on function public.ensure_job_card_invoice(uuid) from public, anon;
grant execute on function public.ensure_job_card_invoice(uuid) to authenticated;
