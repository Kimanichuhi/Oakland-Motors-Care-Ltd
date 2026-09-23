/*
# Backfill a non-null scrap opening cash balance

scrap_recompute_cash_from() falls back to scrap_settings.opening_cash_minor
(coalesced to 0) as the pre-ledger cash position when no earlier
scrap_cash_summary row exists. If the scrap_settings singleton row is
missing, or exists with opening_cash_minor left null and something upstream
skips the coalesce, the very first scrap_cash_summary insert fails with a
not-null violation on opening_cash_minor -- exactly what blocked the
historical bulk import.

Sets it to 0: the business had no cash reserve before the ledger begins.
The first real cash injection (KES 20,000) is already recorded as an
ordinary CASH entry dated 1 Apr 2026 in the ledger itself, so treating it
as a separate pre-ledger opening balance would double-count it. Only
touches the row if opening_cash_minor is currently null, so this never
overwrites a legitimately different value.
*/

insert into public.scrap_settings (id, opening_cash_minor, opening_cash_date, opening_notes)
values (
  true, 0, '2026-04-01',
  'Backfilled to unblock the historical bulk import. The business had no cash reserve before the ledger begins -- the first cash injection (KES 20,000) is recorded as an ordinary CASH entry on 1 Apr 2026 in the ledger itself, not as a separate opening balance.'
)
on conflict (id) do update set
  opening_cash_minor = 0,
  opening_cash_date = coalesce(scrap_settings.opening_cash_date, excluded.opening_cash_date),
  opening_notes = coalesce(scrap_settings.opening_notes, excluded.opening_notes)
where scrap_settings.opening_cash_minor is null;
