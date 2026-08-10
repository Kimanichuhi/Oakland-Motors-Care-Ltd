import { describe, it, expect } from 'vitest';
import { JOB_TRANSITIONS, JOB_STATUSES } from '@/lib/constants';

// This mirrors transition_job_status() in
// supabase/migrations/20260809194245_202608090004_oakland_privileged_functions.sql exactly.
// If this test ever fails, the client-side and database-side state machines have drifted.
const EXPECTED_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ['DIAGNOSING', 'AWAITING_APPROVAL', 'CANCELLED'],
  DIAGNOSING: ['AWAITING_APPROVAL', 'IN_PROGRESS', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_PARTS', 'COMPLETED', 'CANCELLED'],
  AWAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

describe('JOB_TRANSITIONS matches the database state machine', () => {
  it('covers every job status', () => {
    for (const status of JOB_STATUSES) {
      expect(JOB_TRANSITIONS).toHaveProperty(status);
    }
  });

  for (const [from, tos] of Object.entries(EXPECTED_TRANSITIONS)) {
    it(`allows exactly [${tos.join(', ') || 'nothing'}] from ${from}`, () => {
      expect([...JOB_TRANSITIONS[from]].sort()).toEqual([...tos].sort());
    });
  }

  it('rejects an illegal skip-ahead transition (RECEIVED -> DELIVERED)', () => {
    expect(JOB_TRANSITIONS.RECEIVED).not.toContain('DELIVERED');
  });

  it('rejects any transition out of terminal states', () => {
    expect(JOB_TRANSITIONS.DELIVERED).toEqual([]);
    expect(JOB_TRANSITIONS.CANCELLED).toEqual([]);
  });
});
