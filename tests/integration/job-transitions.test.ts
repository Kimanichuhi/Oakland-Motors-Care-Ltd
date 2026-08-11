import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedJobCard } from './setup';

describe('transition_job_status', () => {
  it('walks the full valid state machine end to end', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const path = ['RECEIVED', 'DIAGNOSIS', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'QUALITY_CHECK'];
    for (const status of path) {
      const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: status, p_reason: null });
      expect(error, `transition to ${status} should succeed`).toBeNull();
    }

    // READY_FOR_COLLECTION is gated behind a passed quality check.
    const gated = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'READY_FOR_COLLECTION', p_reason: null });
    expect(gated.error).not.toBeNull();

    await admin.from('job_card_quality_checks').insert({ job_card_id: job.id, checklist: {}, result: 'PASSED' });

    for (const status of ['READY_FOR_COLLECTION', 'COLLECTED', 'CLOSED']) {
      const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: status, p_reason: null });
      expect(error, `transition to ${status} should succeed`).toBeNull();
    }

    const { data: finalJob } = await admin.from('job_cards').select('status,received_at,released_at').eq('id', job.id).single();
    expect(finalJob?.status).toBe('CLOSED');
    expect(finalJob?.received_at).not.toBeNull();
    expect(finalJob?.released_at).not.toBeNull();

    const { data: history } = await admin
      .from('job_card_status_history')
      .select('from_status,to_status')
      .eq('job_card_id', job.id)
      .order('changed_at', { ascending: true });
    expect(history?.map((h) => h.to_status)).toEqual([...path, 'READY_FOR_COLLECTION', 'COLLECTED', 'CLOSED']);
  });

  it('rejects an illegal skip-ahead transition and leaves status unchanged', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'COLLECTED', p_reason: null });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('job_cards').select('status').eq('id', job.id).single();
    expect(unchanged?.status).toBe('DRAFT');
  });

  it('rejects transitioning out of a terminal state', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'CANCELLED', p_reason: 'test' });
    const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'IN_PROGRESS', p_reason: null });
    expect(error).not.toBeNull();
  });

  it('rejects READY_FOR_COLLECTION without a passed quality check, and leaves status unchanged', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    for (const status of ['RECEIVED', 'DIAGNOSIS', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'QUALITY_CHECK']) {
      await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: status, p_reason: null });
    }
    // A FAILED result should not satisfy the gate.
    await admin.from('job_card_quality_checks').insert({ job_card_id: job.id, checklist: {}, result: 'FAILED' });

    const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'READY_FOR_COLLECTION', p_reason: null });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('job_cards').select('status').eq('id', job.id).single();
    expect(unchanged?.status).toBe('QUALITY_CHECK');
  });
});
