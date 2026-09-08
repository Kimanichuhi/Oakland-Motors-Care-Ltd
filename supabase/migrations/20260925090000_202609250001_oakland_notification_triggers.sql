/*
# Wire real events into notifications

1. Problem
- notifications had a table, RLS, and a full UI, but almost nothing in the
  app ever created one. create_notification() was defined but never called;
  notify_admins() was called from exactly one place (a manual Parts > Adjust
  Stock action), and only ever notified the ADMIN role. Every other event
  (low stock, quotations/POs needing approval, job assignment, payments) was
  silent.

2. Fix
- notify_by_permission(permission, title, message, type, exclude_user_id):
  a general version of notify_admins — notifies every user who actually
  holds the given permission (ADMIN always included, mirroring
  has_permission()'s own bypass), not just the ADMIN role specifically.
- Triggers (not manual calls scattered through every write path, so nothing
  can bypass them):
  - parts: fires when quantity_on_hand crosses at/below reorder_level,
    notifying everyone with inventory.view.
  - quotations: fires on insert with status = PENDING_APPROVAL, notifying
    everyone with quotation.approve.
  - purchase_orders: fires on insert, notifying everyone with
    purchase_order.approve (every PO currently starts as DRAFT and needs
    review before ordering — there's no separate "submitted" step to key off
    of).
  - job_card_signoffs: fires on a TECHNICIAN signoff insert; if that
    employee has a linked login (employees.user_id), notifies them directly.
- record_payment now calls notify_by_permission('payment.view', ...) after
  recording a payment (dropped and recreated since only the function body
  changes, not its signature).

Invoice-overdue is deliberately NOT a trigger here — it's a date crossing a
threshold with no write to hang a trigger off, and this project has never
used pg_cron. It's handled client-side instead (Notifications page computes
it live from invoices on load) rather than risk enabling a scheduler.
*/

create or replace function public.notify_by_permission(p_permission text, p_title text, p_message text, p_type text default 'INFO', p_exclude_user_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, title, message, type)
  select distinct ur.user_id, p_title, p_message, p_type
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = r.id
  left join public.permissions perm on perm.id = rp.permission_id
  where (r.name = 'ADMIN' or perm.key = p_permission)
    and (p_exclude_user_id is null or ur.user_id <> p_exclude_user_id);
end; $$;
revoke all on function public.notify_by_permission(text, text, text, text, uuid) from public, anon;
grant execute on function public.notify_by_permission(text, text, text, text, uuid) to authenticated;

-- ── Low stock ────────────────────────────────────────────────────────────
create or replace function public.notify_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and new.quantity_on_hand <= new.reorder_level and (old.quantity_on_hand > old.reorder_level or old.reorder_level <> new.reorder_level) then
    perform public.notify_by_permission(
      'inventory.view',
      'Low stock: ' || new.name,
      new.name || ' (' || new.sku || ') is at ' || new.quantity_on_hand || ' unit(s), at or below its reorder level of ' || new.reorder_level || '.',
      'WARNING'
    );
  end if;
  return new;
end; $$;

drop trigger if exists parts_low_stock_notify on public.parts;
create trigger parts_low_stock_notify after update of quantity_on_hand, reorder_level on public.parts for each row execute function public.notify_low_stock();

-- ── Quotation awaiting approval ─────────────────────────────────────────
create or replace function public.notify_quotation_pending() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_customer_name text;
begin
  if new.status = 'PENDING_APPROVAL' then
    select full_name into v_customer_name from public.customers where id = new.customer_id;
    perform public.notify_by_permission(
      'quotation.approve',
      'Quotation awaiting approval: ' || new.quote_number,
      'Quotation ' || new.quote_number || ' for ' || coalesce(v_customer_name, 'a customer') || ' (KES ' || to_char(new.total_minor / 100.0, 'FM999,999,999.00') || ') needs approval.',
      'INFO'
    );
  end if;
  return new;
end; $$;

drop trigger if exists quotations_pending_notify on public.quotations;
create trigger quotations_pending_notify after insert on public.quotations for each row execute function public.notify_quotation_pending();

-- ── Purchase order needs review ──────────────────────────────────────────
create or replace function public.notify_po_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_supplier_name text;
begin
  select name into v_supplier_name from public.suppliers where id = new.supplier_id;
  perform public.notify_by_permission(
    'purchase_order.approve',
    'Purchase order needs review: ' || new.po_number,
    'Purchase order ' || new.po_number || ' to ' || coalesce(v_supplier_name, 'a supplier') || ' (KES ' || to_char(new.total_minor / 100.0, 'FM999,999,999.00') || ') was created and needs review.',
    'INFO',
    new.created_by
  );
  return new;
end; $$;

drop trigger if exists purchase_orders_created_notify on public.purchase_orders;
create trigger purchase_orders_created_notify after insert on public.purchase_orders for each row execute function public.notify_po_created();

-- ── Job assigned to a technician ─────────────────────────────────────────
create or replace function public.notify_job_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid; v_job_number text;
begin
  if new.role = 'TECHNICIAN' then
    select user_id into v_user_id from public.employees where full_name = new.name and user_id is not null limit 1;
    if v_user_id is not null then
      select job_number into v_job_number from public.job_cards where id = new.job_card_id;
      perform public.create_notification(
        v_user_id,
        'New job assigned: ' || coalesce(v_job_number, ''),
        'You have been assigned to work order ' || coalesce(v_job_number, '') || '.',
        'INFO'
      );
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists job_card_signoffs_notify on public.job_card_signoffs;
create trigger job_card_signoffs_notify after insert on public.job_card_signoffs for each row execute function public.notify_job_assignment();

-- ── Payment recorded ──────────────────────────────────────────────────────
create or replace function public.record_payment(p_invoice_id uuid, p_amount_minor integer, p_method text, p_reference text, p_idempotency_key text, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_invoice public.invoices%rowtype; v_payment_id uuid; v_new_paid integer; v_new_status text; v_clean_reference text; v_customer_name text;
begin
  if not public.has_permission('payment.create') then raise exception 'Not authorized to record payments'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_idempotency_key is not null then
    select id into v_payment_id from public.payments where idempotency_key = p_idempotency_key;
    if v_payment_id is not null then return v_payment_id; end if;
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status = 'VOID' then raise exception 'Cannot record payment on void invoice'; end if;
  v_new_paid := v_invoice.amount_paid_minor + p_amount_minor;
  if v_new_paid > v_invoice.total_minor then raise exception 'Payment exceeds outstanding balance'; end if;
  v_new_status := case when v_new_paid = v_invoice.total_minor then 'PAID' when v_new_paid > 0 then 'PART_PAID' else v_invoice.status end;
  v_clean_reference := nullif(trim(coalesce(p_reference, '')), '');

  insert into public.payments(invoice_id, amount_minor, method, reference, notes, idempotency_key)
  values (p_invoice_id, p_amount_minor, p_method, p_reference, p_notes, p_idempotency_key)
  returning id into v_payment_id;
  update public.invoices set amount_paid_minor = v_new_paid, status = v_new_status, updated_by = auth.uid() where id = p_invoice_id;

  if v_invoice.job_card_id is not null then
    update public.sales s set
      payment_reference = coalesce(v_clean_reference, s.payment_reference),
      payment_reference_at = case when v_clean_reference is not null then now() else s.payment_reference_at end,
      amount_paid_minor = least(s.total_minor, round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer),
      balance_minor = greatest(s.total_minor - round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer, 0),
      payment_status = case
        when round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer >= s.total_minor then 'PAID'
        when round(s.total_minor * v_new_paid::numeric / greatest(v_invoice.total_minor, 1))::integer > 0 then 'PARTIAL'
        else 'PENDING' end
    where s.job_card_id = v_invoice.job_card_id;
  end if;

  select full_name into v_customer_name from public.customers where id = v_invoice.customer_id;
  perform public.notify_by_permission(
    'payment.view',
    'Payment recorded: ' || v_invoice.invoice_number,
    'KES ' || to_char(p_amount_minor / 100.0, 'FM999,999,999.00') || ' received against invoice ' || v_invoice.invoice_number || ' for ' || coalesce(v_customer_name, 'a customer') || ' via ' || p_method || '. Now ' || v_new_status || '.',
    'INFO',
    auth.uid()
  );

  perform public.log_audit('RECORD_PAYMENT', 'invoices', p_invoice_id, jsonb_build_object('amount_paid_minor', v_invoice.amount_paid_minor, 'status', v_invoice.status), jsonb_build_object('amount_paid_minor', v_new_paid, 'status', v_new_status), jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount_minor, 'method', p_method));
  return v_payment_id;
end; $$;
