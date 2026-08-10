/*
# Oakland Motors job_cards status constraint fix

1. Problem being fixed
- job_cards.status has a CHECK constraint listing 9 statuses that omits 'APPROVED'.
- transition_job_status() (oakland_privileged_functions.sql) explicitly allows the
  AWAITING_APPROVAL -> APPROVED -> IN_PROGRESS path, and the `job_statuses` lookup table
  (oakland_operations_expansion.sql) lists APPROVED as a real, non-terminal status.
- Net effect: calling transition_job_status(id, 'APPROVED') always fails with a check
  constraint violation, even though it's a valid transition by the RPC's own state machine.
  This was caught while writing job-transition tests for the new test suite.

2. Fix
- Drop and recreate the constraint to include 'APPROVED', matching job_statuses and the
  RPC's state machine exactly.
*/
alter table public.job_cards drop constraint if exists job_cards_status_check;
alter table public.job_cards add constraint job_cards_status_check
  check (status in ('RECEIVED','DIAGNOSING','AWAITING_APPROVAL','APPROVED','IN_PROGRESS','AWAITING_PARTS','COMPLETED','READY_FOR_PICKUP','DELIVERED','CANCELLED'));
