/*
# Oakland Motor Care Ltd — job card "Other charges" field

Supports the Work Order dialog's Charges section, which mirrors the physical work
order pad (Labour / Parts / Other / Total). Labour and Parts are already derived
from job_card_labour / job_card_parts; Other charges has no existing home, so it
gets a small dedicated column. Writable by anyone holding job.update, same as
every other job_cards field — no new RLS policy needed.
*/
alter table public.job_cards add column if not exists other_charges_minor integer not null default 0 check (other_charges_minor >= 0);
