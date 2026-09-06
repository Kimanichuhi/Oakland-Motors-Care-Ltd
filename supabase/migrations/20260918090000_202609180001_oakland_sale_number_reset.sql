/*
# Oakland Motor Care Ltd — sale numbers start from Sale-001

Mirrors the job card numbering reset (JB-001, `{prefix}-{seq:03d}`): sale
numbers were `SALE-00001` (5-digit, all-caps prefix); the Sales screen now
shows a dedicated "Sales ID" column next to "Work Order No.", so the format
should read the same way — `Sale-001`, 3-digit, never-resetting sequence.

- generate_sale_number() now returns `Sale-{seq:03d}` instead of `SALE-{seq:05d}`.
- sale_number_counters is reset to next_seq = 1, so the next sale created is
  Sale-001. Existing sales keep their SALE-##### numbers — already-issued
  receipts/paperwork stay valid; only future sales get the new format (same
  non-destructive approach as the job card number reset).
*/

update public.sale_number_counters set next_seq = 1 where id = true;
insert into public.sale_number_counters(id, next_seq) values (true, 1) on conflict (id) do nothing;

create or replace function public.generate_sale_number() returns text
language plpgsql security definer set search_path = public as $$
declare v_seq integer;
begin
  if not public.has_permission('sales.create') then raise exception 'Not authorized to create sales'; end if;
  insert into public.sale_number_counters(id, next_seq) values (true, 1) on conflict (id) do nothing;
  update public.sale_number_counters set next_seq = next_seq + 1 where id = true returning next_seq - 1 into v_seq;
  return 'Sale-' || lpad(v_seq::text, 3, '0');
end; $$;
