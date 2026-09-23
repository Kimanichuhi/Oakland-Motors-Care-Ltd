/*
# Let a scrap.manage user edit a day's purchase/expense/cash entries in place

Previously the only correction path for a recorded entry was void-and-redo:
scrap_edit_purchase/scrap_edit_expense only touched supplier/description/
notes, never the financial fields, and there was no edit RPC for a cash
transaction at all. Fixing a typo'd weight or a mispriced historical
purchase (see the DAWA/SOFT/RADIATOR rate-variance rows from the bulk
import) meant voiding the entry and re-entering it from scratch.

This extends scrap_edit_purchase and scrap_edit_expense to also take the
financial fields, and adds scrap_edit_cash_transaction. Weight, rate and
amount are independently editable on a purchase -- the amount is NOT
recalculated from weight x rate -- so a purchase can be corrected to its
true historical price even when that differs from the scrap type's current
rate. Each RPC adjusts the stock cycle (for a purchase's weight change) or
recomputes the cash cascade forward from that date (for anything that
changes cash_added/purchases/expenses), the same way create/void already
do. Unlike create, an edit that leaves a day's cash negative is not
blocked -- it's a correction made by someone who already has scrap.manage,
so it just flags the discrepancy for review rather than refusing outright.
*/

drop function if exists public.scrap_edit_purchase(uuid, text, text);

create or replace function public.scrap_edit_purchase(
  p_id uuid, p_weight_kg numeric, p_rate_used_minor integer, p_purchase_amount_minor integer,
  p_supplier text default null, p_notes text default null
)
returns public.scrap_purchases
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_purchases%rowtype; v_after public.scrap_purchases%rowtype; v_delta numeric;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to edit scrap purchases'; end if;
  select * into v_before from public.scrap_purchases where id = p_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_before.status = 'VOID' then raise exception 'Cannot edit a voided purchase'; end if;
  if p_weight_kg is null or p_weight_kg <= 0 then raise exception 'Weight (KG) must be greater than zero'; end if;
  if p_rate_used_minor is null or p_rate_used_minor < 0 then raise exception 'Rate cannot be negative'; end if;
  if p_purchase_amount_minor is null or p_purchase_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  v_delta := p_weight_kg - v_before.quantity_purchased;
  update public.stock_cycles set current_quantity = current_quantity + v_delta where id = v_before.stock_cycle_id;

  update public.scrap_purchases set
    quantity_purchased = p_weight_kg, rate_used_minor = p_rate_used_minor, purchase_amount_minor = p_purchase_amount_minor,
    closing_stock = opening_stock + p_weight_kg,
    supplier = nullif(trim(coalesce(p_supplier, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_after;

  if p_purchase_amount_minor <> v_before.purchase_amount_minor then
    perform public.scrap_recompute_cash_from(v_before.date);
  end if;

  perform public.log_audit('EDIT_SCRAP_PURCHASE', 'scrap_purchases', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

drop function if exists public.scrap_edit_expense(uuid, text, text);

create or replace function public.scrap_edit_expense(
  p_id uuid, p_category text, p_amount_minor integer, p_description text default null, p_notes text default null
)
returns public.scrap_expenses
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_expenses%rowtype; v_after public.scrap_expenses%rowtype; v_category text := nullif(trim(coalesce(p_category, '')), '');
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to edit scrap expenses'; end if;
  select * into v_before from public.scrap_expenses where id = p_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if v_before.status = 'VOID' then raise exception 'Cannot edit a voided expense'; end if;
  if v_category is null then raise exception 'Expense type is required'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'Amount must be greater than zero'; end if;

  update public.scrap_expenses set
    category = v_category, amount_minor = p_amount_minor,
    description = nullif(trim(coalesce(p_description, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_after;

  if p_amount_minor <> v_before.amount_minor then
    perform public.scrap_recompute_cash_from(v_before.date);
  end if;

  perform public.log_audit('EDIT_SCRAP_EXPENSE', 'scrap_expenses', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

create or replace function public.scrap_edit_cash_transaction(
  p_id uuid, p_amount_minor integer, p_reason text default null, p_reference text default null, p_notes text default null
)
returns public.cash_transactions
language plpgsql security definer set search_path = public as $$
declare v_before public.cash_transactions%rowtype; v_after public.cash_transactions%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to edit a cash transaction'; end if;
  select * into v_before from public.cash_transactions where id = p_id for update;
  if not found then raise exception 'Cash transaction not found'; end if;
  if v_before.status = 'VOID' then raise exception 'Cannot edit a voided cash transaction'; end if;
  if v_before.transaction_type = 'CASH_ADDED' and (p_amount_minor is null or p_amount_minor <= 0) then raise exception 'Amount must be greater than zero'; end if;
  if v_before.transaction_type = 'ADJUSTMENT' and (p_amount_minor is null or p_amount_minor = 0) then raise exception 'Adjustment amount cannot be zero'; end if;

  update public.cash_transactions set
    amount_minor = p_amount_minor,
    reason = nullif(trim(coalesce(p_reason, '')), ''), reference = nullif(trim(coalesce(p_reference, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_after;

  if p_amount_minor <> v_before.amount_minor then
    perform public.scrap_recompute_cash_from(v_before.date);
  end if;

  perform public.log_audit('EDIT_SCRAP_CASH', 'cash_transactions', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

revoke all on function public.scrap_edit_purchase(uuid, numeric, integer, integer, text, text) from public, anon;
revoke all on function public.scrap_edit_expense(uuid, text, integer, text, text) from public, anon;
revoke all on function public.scrap_edit_cash_transaction(uuid, integer, text, text, text) from public, anon;

grant execute on function public.scrap_edit_purchase(uuid, numeric, integer, integer, text, text) to authenticated;
grant execute on function public.scrap_edit_expense(uuid, text, integer, text, text) to authenticated;
grant execute on function public.scrap_edit_cash_transaction(uuid, integer, text, text, text) to authenticated;
