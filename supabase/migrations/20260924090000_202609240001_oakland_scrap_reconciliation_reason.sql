/*
# Scrap reconciliation — drop manual "authorized by", categorize reason

1. Fix
- scrap_record_stock_count no longer takes p_authorized_by — the field asked
  the person recording the count to type their own name, which the system
  already knows (auth.uid()). authorized_by is now auto-filled the same way
  created_by_name is elsewhere (profile full_name, falling back to email).
- p_reason is now expected to be one of the app's fixed categories ("To
  Starting Stock", "Error Margin", or a free-text "Other: ..." from the UI)
  instead of open free text, but the column itself stays a plain text field —
  no schema/constraint change needed, just a different RPC signature.
*/

drop function if exists public.scrap_record_stock_count(uuid, numeric, text, text, text, date);

create or replace function public.scrap_record_stock_count(
  p_scrap_item_id uuid, p_counted_quantity numeric, p_reason text, p_notes text default null, p_date date default current_date
) returns public.scrap_stock_adjustments
language plpgsql security definer set search_path = public as $$
declare v_cycle public.stock_cycles%rowtype; v_variance numeric(12,2); v_type text; v_adjustment public.scrap_stock_adjustments%rowtype; v_authorized_by text;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to reconcile scrap stock'; end if;
  if p_counted_quantity is null or p_counted_quantity < 0 then raise exception 'Counted quantity cannot be negative'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required for a stock reconciliation'; end if;

  select * into v_cycle from public.stock_cycles where scrap_item_id = p_scrap_item_id and status = 'OPEN' for update;
  if not found then raise exception 'This scrap type has no open stock cycle'; end if;

  v_variance := p_counted_quantity - v_cycle.current_quantity;
  if v_variance = 0 then raise exception 'No difference found — the counted quantity already matches the expected stock'; end if;
  v_type := case when v_variance > 0 then 'CORRECTION_INCREASE' else 'CORRECTION_DECREASE' end;

  select coalesce(pr.full_name, au.email, 'Staff') into v_authorized_by from auth.users au left join public.profiles pr on pr.id = au.id where au.id = auth.uid();

  insert into public.scrap_stock_adjustments(scrap_item_id, stock_cycle_id, date, adjustment_type, quantity, previous_stock, resulting_stock, reason, authorized_by, notes)
  values (p_scrap_item_id, v_cycle.id, coalesce(p_date, current_date), v_type, abs(v_variance), v_cycle.current_quantity, p_counted_quantity, p_reason, v_authorized_by, p_notes)
  returning * into v_adjustment;

  update public.stock_cycles set current_quantity = p_counted_quantity where id = v_cycle.id;

  perform public.log_audit('RECONCILE_SCRAP_STOCK', 'scrap_stock_adjustments', v_adjustment.id, jsonb_build_object('expected', v_cycle.current_quantity), jsonb_build_object('counted', p_counted_quantity, 'variance', v_variance), jsonb_build_object('scrap_item_id', p_scrap_item_id, 'reason', p_reason));
  return v_adjustment;
end; $$;

revoke all on function public.scrap_record_stock_count(uuid, numeric, text, text, date) from public, anon;
grant execute on function public.scrap_record_stock_count(uuid, numeric, text, text, date) to authenticated;
