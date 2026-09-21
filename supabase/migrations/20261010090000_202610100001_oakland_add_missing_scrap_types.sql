/*
# Add missing scrap types used in the historical bulk import, with their rates

Adds any of the 21 scrap types referenced in the historical purchase ledger
that don't already exist (matched case-insensitively by name), each with the
rate supplied for the bulk import. Existing items are left untouched — this
never updates a rate on a type that's already in scrap_items, even if the
value given here differs from what's currently set.

Mirrors what scrap_add_item does for a manually-added type: creates the item
plus an opening stock_cycles row (cycle 1, opening quantity 0, status OPEN)
so it immediately shows up on the Stock Position screen and is purchasable.

Note: scrap_items has one current rate per type, not a rate history, so this
picks a single rate for types that were bought at more than one rate in the
source ledger (DAWA: 1000 for 19 rows vs 800 for 3; SOFT: 200 for 95 rows vs
150/170 for 3; RADIATOR: 100 for 1 row vs 200 for 1) — the majority rate,
or an arbitrary pick for RADIATOR's 1-vs-1 tie. Bulk-importing the purchase
ledger will price every purchase of a type at whatever its single current
rate is at import time, so the minority-rate rows (7 total, well under 1% of
volume) will be priced at the majority rate instead of their true historical
rate.
*/

with new_items as (
  insert into public.scrap_items (name, current_rate_minor)
  select v.name, v.rate_minor
  from (values
    ('Heavy', 4500),
    ('Heavy 2', 4000),
    ('Heavy 3', 5000),
    ('Light', 3000),
    ('Light 2', 3500),
    ('Dawa', 100000),
    ('Dawa 2', 70000),
    ('Battery', 8000),
    ('Battery 2', 4000),
    ('Battery 3', 7000),
    ('Battery 4', 6000),
    ('Cast', 4000),
    ('Cast 2', 3500),
    ('Alu Hard', 13000),
    ('Alu Hard 2', 15000),
    ('Soft', 20000),
    ('Plastic', 2000),
    ('Brass', 40000),
    ('Gumboots', 5000),
    ('Radiator', 20000),
    ('Radiator Brass', 20000)
  ) as v(name, rate_minor)
  where not exists (select 1 from public.scrap_items si where lower(si.name) = lower(v.name))
  returning id
)
insert into public.stock_cycles (scrap_item_id, cycle_number, opening_quantity, opening_date, current_quantity, status)
select id, 1, 0, current_date, 0, 'OPEN' from new_items;
