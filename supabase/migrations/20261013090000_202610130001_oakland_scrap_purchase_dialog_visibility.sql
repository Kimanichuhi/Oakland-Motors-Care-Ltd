/*
# Let a scrap type be hidden from the quick "Add Purchase" dialog by default

The purchase entry dialog lists every active scrap type as a row to fill in
KG for. That was fine with a dozen types; it's unwieldy now that the
historical import brought the catalogue to 20+. This adds a
show_in_purchase_form flag (default true, so existing behaviour is
unchanged until someone opts a type out) and a dedicated RPC to flip it --
kept separate from scrap_update_item rather than added as a new parameter
there, so the existing rename/activate flow is untouched.

A type hidden this way is still active everywhere else: bulk upload,
reconciliation, reports, Scrap Types & Rates itself. It's purely a
"don't clutter the quick-entry dialog with this one" switch.
*/

alter table public.scrap_items add column if not exists show_in_purchase_form boolean not null default true;

create or replace function public.scrap_set_item_purchase_visibility(p_id uuid, p_visible boolean)
returns public.scrap_items
language plpgsql security definer set search_path = public as $$
declare v_before public.scrap_items%rowtype; v_after public.scrap_items%rowtype;
begin
  if not public.has_permission('scrap.manage') then raise exception 'Not authorized to manage scrap types'; end if;
  if p_visible is null then raise exception 'Visibility flag is required'; end if;
  select * into v_before from public.scrap_items where id = p_id for update;
  if not found then raise exception 'Scrap type not found'; end if;

  update public.scrap_items set show_in_purchase_form = p_visible where id = p_id returning * into v_after;
  perform public.log_audit('SET_SCRAP_ITEM_PURCHASE_VISIBILITY', 'scrap_items', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end; $$;

revoke all on function public.scrap_set_item_purchase_visibility(uuid, boolean) from public, anon;
grant execute on function public.scrap_set_item_purchase_visibility(uuid, boolean) to authenticated;
