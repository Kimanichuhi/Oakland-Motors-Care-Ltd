import { describe, it, expect } from 'vitest';
import { JOB_TRANSITIONS, JOB_STATUSES } from '@/lib/constants';

// This mirrors transition_job_status() in
// supabase/migrations/20260910090000_202609100001_oakland_job_card_status_simplify.sql exactly.
// If this test ever fails, the client-side and database-side state machines have drifted.
const EXPECTED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
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

  it('rejects an illegal skip-ahead transition (DRAFT -> COMPLETED)', () => {
    expect(JOB_TRANSITIONS.DRAFT).not.toContain('COMPLETED');
  });

  it('rejects any transition out of terminal states', () => {
    expect(JOB_TRANSITIONS.COMPLETED).toEqual([]);
    expect(JOB_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('gates COMPLETED only from IN_PROGRESS', () => {
    const statusesLeadingToCompleted = Object.entries(JOB_TRANSITIONS)
      .filter(([, tos]) => tos.includes('COMPLETED'))
      .map(([from]) => from);
    expect(statusesLeadingToCompleted).toEqual(['IN_PROGRESS']);
  });
});
