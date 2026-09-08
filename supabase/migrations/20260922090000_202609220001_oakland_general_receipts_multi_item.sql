/*
# General receipts — support multiple service/item lines

1. Problem
- general_receipts (previous migration) held exactly one description + amount
  per receipt. Real jobs often have more than one billable line (e.g. "welding
  a door" + "materials"), and the printed receipt needs a proper multi-row
  itemized table rather than a single line.

2. Fix
- Adds general_receipt_items (description, quantity, unit_price_minor,
  line_total_minor) — same header+items shape as purchase_orders/quotations.
- Adds general_receipts.total_minor (sum of its items' line totals) and
  backfills it, and every existing receipt's single description/amount, into
  general_receipt_items so no already-recorded receipt loses data.
- Drops the now-redundant description/amount_minor columns from
  general_receipts and replaces create_general_receipt with a version that
  takes a jsonb array of items (mirroring create_purchase_order) instead of a
  single description/amount pair.
*/

create table public.general_receipt_items (
  id uuid primary key default gen_random_uuid(),
  general_receipt_id uuid not null references public.general_receipts(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_minor integer not null default 0 check (unit_price_minor >= 0),
  line_total_minor integer not null default 0 check (line_total_minor >= 0),
  created_at timestamptz not null default now()
);

create index general_receipt_items_receipt_idx on public.general_receipt_items(general_receipt_id);

alter table public.general_receipt_items enable row level security;
create policy "staff_select_general_receipt_items" on public.general_receipt_items for select to authenticated using (public.has_permission('payment.view'));
create policy "staff_insert_general_receipt_items" on public.general_receipt_items for insert to authenticated with check (false);
create policy "staff_delete_general_receipt_items" on public.general_receipt_items for delete to authenticated using (public.has_permission('settings.manage'));

-- Backfill: every existing receipt becomes a single-line item under itself.
insert into public.general_receipt_items(general_receipt_id, description, quantity, unit_price_minor, line_total_minor)
select id, description, 1, amount_minor, amount_minor from public.general_receipts;

alter table public.general_receipts add column if not exists total_minor integer;
update public.general_receipts set total_minor = amount_minor where total_minor is null;
alter table public.general_receipts alter column total_minor set not null;
alter table public.general_receipts alter column total_minor set default 0;
alter table public.general_receipts add constraint general_receipts_total_minor_check check (total_minor >= 0);

alter table public.general_receipts drop column description;
alter table public.general_receipts drop column amount_minor;

drop function if exists public.create_general_receipt(date, text, text, text, integer, text, text);

create or replace function public.create_general_receipt(
  p_date date, p_client_name text, p_client_phone text, p_payment_method text, p_notes text, p_items jsonb
) returns public.general_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_receipt public.general_receipts%rowtype; v_number text; v_created_by_name text;
  v_item jsonb; v_total integer := 0; v_qty numeric(10,2); v_price integer; v_line_total integer; v_description text;
begin
  if not public.has_permission('payment.create') then raise exception 'Not authorized to create receipts'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if nullif(trim(coalesce(p_client_name, '')), '') is null then raise exception 'Client name is required'; end if;
  if p_payment_method is null or p_payment_method not in ('CASH','MPESA','BANK','CARD','OTHER') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one service or item'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_price := nullif(v_item->>'unit_price_minor', '')::integer;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    if v_description is null then raise exception 'Each line needs a description'; end if;
    if v_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_price is null or v_price < 0 then raise exception 'Unit price cannot be negative'; end if;
    v_total := v_total + round(v_qty * v_price);
  end loop;
  if v_total <= 0 then raise exception 'Total amount must be greater than zero'; end if;

  select coalesce(pr.full_name, au.email, 'Staff') into v_created_by_name from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();
  v_number := public.generate_document_number('GENRCP', 'RCP', 'payment.create');

  insert into public.general_receipts(receipt_number, receipt_date, client_name, client_phone, payment_method, total_minor, notes, created_by, created_by_name)
  values (v_number, p_date, trim(p_client_name), nullif(trim(coalesce(p_client_phone, '')), ''), p_payment_method, v_total, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), v_created_by_name)
  returning * into v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_price := (v_item->>'unit_price_minor')::integer;
    v_line_total := round(v_qty * v_price);
    insert into public.general_receipt_items(general_receipt_id, description, quantity, unit_price_minor, line_total_minor)
    values (v_receipt.id, trim(v_item->>'description'), v_qty, v_price, v_line_total);
  end loop;

  perform public.log_audit('CREATE_GENERAL_RECEIPT', 'general_receipts', v_receipt.id, null, to_jsonb(v_receipt) || jsonb_build_object('item_count', jsonb_array_length(p_items)));
  return v_receipt;
end; $$;

revoke all on function public.create_general_receipt(date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_general_receipt(date, text, text, text, text, jsonb) to authenticated;
