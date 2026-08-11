import { describe, it, expect } from 'vitest';
import { JOB_TRANSITIONS, JOB_STATUSES } from '@/lib/constants';

// This mirrors transition_job_status() in
// supabase/migrations/20260811090000_202608110001_oakland_job_card_status_pipeline.sql exactly.
// If this test ever fails, the client-side and database-side state machines have drifted.
const EXPECTED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['INSPECTION', 'DIAGNOSIS', 'AWAITING_APPROVAL', 'CANCELLED'],
  INSPECTION: ['DIAGNOSIS', 'AWAITING_APPROVAL', 'CANCELLED'],
  DIAGNOSIS: ['AWAITING_APPROVAL', 'WAITING_FOR_PARTS', 'IN_PROGRESS', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'WAITING_FOR_PARTS', 'IN_PROGRESS', 'CANCELLED'],
  APPROVED: ['WAITING_FOR_PARTS', 'IN_PROGRESS', 'CANCELLED'],
  WAITING_FOR_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['QUALITY_CHECK', 'WAITING_FOR_PARTS', 'CANCELLED'],
  QUALITY_CHECK: ['READY_FOR_COLLECTION', 'IN_PROGRESS', 'CANCELLED'],
  READY_FOR_COLLECTION: ['COLLECTED'],
  COLLECTED: ['CLOSED'],
  CLOSED: [],
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

  it('rejects an illegal skip-ahead transition (DRAFT -> COLLECTED)', () => {
    expect(JOB_TRANSITIONS.DRAFT).not.toContain('COLLECTED');
  });

  it('rejects any transition out of terminal states', () => {
    expect(JOB_TRANSITIONS.CLOSED).toEqual([]);
    expect(JOB_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('gates READY_FOR_COLLECTION only from QUALITY_CHECK', () => {
    const statusesLeadingToReadyForCollection = Object.entries(JOB_TRANSITIONS)
      .filter(([, tos]) => tos.includes('READY_FOR_COLLECTION'))
      .map(([from]) => from);
    expect(statusesLeadingToReadyForCollection).toEqual(['QUALITY_CHECK']);
  });
});
