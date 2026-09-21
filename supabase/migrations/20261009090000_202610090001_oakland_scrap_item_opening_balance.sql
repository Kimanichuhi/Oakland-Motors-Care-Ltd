/*
# Let a new scrap type carry its opening stock balance

scrap_add_item always opened a new stock cycle at 0 KG with no way to record
existing physical stock for a type at the moment it's added — you'd have to
add the type, then separately visit Stock Position -> Start new stock cycle
to set its opening quantity. That extra step was routinely getting missed,
so the opening balance never "registered" for a newly added type.

This extends scrap_add_item to accept an opening quantity + reason/source
(same validation scrap_start_new_cycle already applies: a reason is required
whenever the opening quantity is greater than zero), and logs the same
OPENING stock adjustment scrap_start_new_cycle records, so the audit trail
and Stock Position screen behave identically either way.
*/

drop function if exists public.scrap_add_item(text, integer);

create or replace function public.scrap_add_item(
  p_name text, p_rate_minor integer default null,
  p_opening_quantity numeric default 0, p_reason text default null
)
returns public.scrap_items
language plpgsql security definer set search_path = public as $$
declare
  v_item public.scrap_items%rowtype;
  v_cycle public.stock_cycles%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_opening numeric(12,2) := coalesce(p_opening_quantity, 0);
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to manage scrap types'; end if;
  if v_name is null then raise exception 'Scrap type name is required'; end if;
  if p_rate_minor is not null and p_rate_minor < 0 then raise exception 'Rate cannot be negative'; end if;
  if v_opening < 0 then raise exception 'Opening stock cannot be negative'; end if;
  if v_opening > 0 and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason/source is required when adding a scrap type with existing opening stock';
  end if;
  if exists (select 1 from public.scrap_items where lower(name) = lower(v_name)) then raise exception 'A scrap type named "%" already exists', v_name; end if;

  insert into public.scrap_items(name, current_rate_minor) values (v_name, p_rate_minor) returning * into v_item;
  insert into public.stock_cycles(scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status, notes)
  values (v_item.id, 1, v_opening, current_date, v_opening, 'OPEN', p_reason)
  returning * into v_cycle;

  if v_opening > 0 then
    insert into public.scrap_stock_adjustments(scrap_item_id, stock_cycle_id, date, adjustment_type, quantity, previous_stock, resulting_stock, reason, authorized_by, notes)
    values (v_item.id, v_cycle.id, current_date, 'OPENING', v_opening, 0, v_opening, p_reason, 'System', 'Opening balance set when scrap type was added');
  end if;

  perform public.log_audit('ADD_SCRAP_ITEM', 'scrap_items', v_item.id, null, to_jsonb(v_item));
  return v_item;
end; $$;

revoke all on function public.scrap_add_item(text, integer, numeric, text) from public, anon;
grant execute on function public.scrap_add_item(text, integer, numeric, text) to authenticated;
