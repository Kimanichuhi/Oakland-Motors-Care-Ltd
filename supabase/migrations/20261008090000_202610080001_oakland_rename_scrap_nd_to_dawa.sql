/*
# Rename scrap type "ND" to "DAWA"

Renames the existing "ND 1"/"ND 2" scrap items to "DAWA 1"/"DAWA 2". Historical
purchases/expenses reference the item by scrap_item_id, not by name, so this is
a pure label change with no effect on past records.
*/

update public.scrap_items set name = 'DAWA 1', updated_at = now() where name = 'ND 1';
update public.scrap_items set name = 'DAWA 2', updated_at = now() where name = 'ND 2';
