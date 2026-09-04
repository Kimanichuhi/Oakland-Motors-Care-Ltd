/*
# Oakland Motor Care Ltd — Work Order field fixes

1. job_cards.job_types used to be constrained to a fixed set of category keys
   (SERVICE, REPAIR, ...). The Work Order dialog and creation form now store
   whatever free text staff type into the "Job Type" box instead, matching the
   physical work order pad — so that fixed-set check constraint now rejects
   every real insert/update. Drop it; job_types is free text going forward.

2. Vehicles required make/model at the database level. The Work Order flow
   should allow registering a vehicle from its registration number alone —
   make/model can be filled in later. Make both nullable.
*/

alter table public.job_cards drop constraint if exists job_cards_job_types_check;

alter table public.vehicles alter column make drop not null;
alter table public.vehicles alter column model drop not null;
