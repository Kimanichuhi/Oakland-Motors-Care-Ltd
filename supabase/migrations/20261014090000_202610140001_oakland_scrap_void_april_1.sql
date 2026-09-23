/*
# Treat 1 Apr 2026 as if it never happened — ledger now starts 2 Apr 2026

Voids every active scrap purchase, expense and cash transaction dated
1 Apr 2026 (reversing each purchase's effect on its stock cycle's running
quantity, same as scrap_void_purchase does one at a time), then recomputes
the cash cascade forward so 2 Apr 2026 onward reflects the change.

Note: 2 Apr 2026's own entries were purchases only, with no cash added that
day in the original ledger. With 1 Apr's cash injection now voided, 2 Apr's
purchases will show a larger negative-cash discrepancy than before (they
had 1 Apr's cash as a cushion; now they don't) until 3 Apr's cash-added
entry evens it back out. That's the expected result of this change, not a
new problem — nothing here bypasses or hides it.

Run manually via the Supabase Dashboard SQL editor; this only touches
already-live data and cannot be applied any other way from this session.
*/

do $$
declare r record;
begin
  for r in select * from public.scrap_purchases where date = '2026-04-01' and status = 'ACTIVE' loop
    update public.stock_cycles set current_quantity = current_quantity - r.quantity_purchased where id = r.stock_cycle_id;
    update public.scrap_purchases set
      status = 'VOID', void_reason = 'Ledger now starts 2 Apr 2026 — 1 Apr excluded', voided_at = now(), updated_at = now()
    where id = r.id;
    perform public.log_audit('VOID_SCRAP_PURCHASE', 'scrap_purchases', r.id, null, null, jsonb_build_object('reason', 'Ledger now starts 2 Apr 2026 — 1 Apr excluded'));
  end loop;
end $$;

update public.scrap_expenses set
  status = 'VOID', void_reason = 'Ledger now starts 2 Apr 2026 — 1 Apr excluded', voided_at = now(), updated_at = now()
where date = '2026-04-01' and status = 'ACTIVE';

update public.cash_transactions set
  status = 'VOID', void_reason = 'Ledger now starts 2 Apr 2026 — 1 Apr excluded', voided_at = now(), updated_at = now()
where date = '2026-04-01' and status = 'ACTIVE';

select public.scrap_recompute_cash_from('2026-04-01');
