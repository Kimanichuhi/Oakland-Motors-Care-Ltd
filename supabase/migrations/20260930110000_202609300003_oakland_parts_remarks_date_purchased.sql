/*
# Parts: add Remarks and Date Purchased

The paper/Excel parts ledger this replaces tracks a Remarks note and a purchase
date per line that the parts table had no home for. Both are plain columns —
inventory.create/inventory.update already gate direct client writes to this
table (set in the RBAC hardening and parts-edit-permission migrations), so no
new RPC or permission is needed.
*/

alter table public.parts add column if not exists remarks text;
alter table public.parts add column if not exists date_purchased date;
