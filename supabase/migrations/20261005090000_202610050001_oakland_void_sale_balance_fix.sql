/*
# Oakland Motor Care Ltd — a voided credit sale no longer shows a phantom balance

1. Problem
- `void_sale` set `balance_minor = total_minor` on void (oakland_sales_module.sql,
  carried through unchanged by oakland_job_card_sales_integration.sql). For a sale
  that still had an open balance at the moment it was voided (a partial/credit
  sale), that left `balance_minor` sitting at the sale's *full original amount*
  forever — status='VOIDED', but still reading as fully unpaid.
- Nothing downstream treats VOIDED specially before reading balance_minor:
  SalesSection's per-row Debt column and its CSV export both show it as owed,
  and a plain sum of that column overstates outstanding debt by the voided
  total. (The Debt module's own live query excludes VOIDED sales outright, so
  it was never wrong — this only ever corrupted the Sales tab's own figures.)
- A voided sale has nothing outstanding — there's no sale left to collect on —
  so the correct value is 0, not the pre-void balance.

2. Fix
- Same function, same signature, same permission/authorization checks, same
  stock-reversal and job-card guard behavior — only one value written on void
  changes: `balance_minor = 0` (was `total_minor`). `amount_paid_minor` is left
  exactly as before (untouched by the original function too) — it's the
  historical record of what was actually collected before the void, which
  stays true regardless of the void.
- Existing voided sales with a stale nonzero balance are corrected in place by
  the same update, scoped to already-VOIDED rows.
*/

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_part public.parts%rowtype;
  v_previous integer;
  v_new integer;
begin
  if not public.has_permission('sales.void') then raise exception 'Not authorized to void sales'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'VOIDED' then return v_sale; end if;
  if v_sale.status <> 'COMPLETED' then raise exception 'Only completed sales can be voided in this release'; end if;
  if v_sale.job_card_id is not null then raise exception 'This sale was generated from a job card and cannot be voided here — reverse it from the work order instead'; end if;

  for v_item in select * from public.sale_items where sale_id = p_sale_id loop
    select * into v_part from public.parts where id = v_item.part_id for update;
    v_previous := v_part.quantity_on_hand;
    v_new := v_previous + v_item.quantity;
    update public.parts set quantity_on_hand = v_new where id = v_part.id;
    update public.sale_items set returned_quantity = quantity where id = v_item.id;
    insert into public.stock_movements(part_id, movement_type, quantity, previous_balance, new_balance, unit_cost_minor, reason, reference, reference_id)
    values (v_part.id, 'SALE_REVERSAL', v_item.quantity, v_previous, v_new, v_item.unit_price_minor, coalesce(p_reason, 'Sale voided'), v_sale.sale_number, v_sale.id);
  end loop;

  update public.sales set status = 'VOIDED', void_reason = p_reason, voided_by = auth.uid(), voided_at = now(), payment_status = 'PENDING', balance_minor = 0
  where id = p_sale_id returning * into v_sale;
  perform public.log_audit('VOID_SALE', 'sales', v_sale.id, null, to_jsonb(v_sale), jsonb_build_object('reason', p_reason));
  return v_sale;
end; $$;

-- Backfill: correct any sale that was voided before this fix and is still
-- carrying its pre-void balance.
update public.sales set balance_minor = 0
where status = 'VOIDED' and balance_minor <> 0;
