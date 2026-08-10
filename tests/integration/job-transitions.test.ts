import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedJobCard } from './setup';

describe('transition_job_status', () => {
  it('walks the full valid state machine end to end', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const path = ['DIAGNOSING', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'];
    for (const status of path) {
      const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: status, p_reason: null });
      expect(error, `transition to ${status} should succeed`).toBeNull();
    }

    const { data: finalJob } = await admin.from('job_cards').select('status').eq('id', job.id).single();
    expect(finalJob?.status).toBe('DELIVERED');

    const { data: history } = await admin
      .from('job_card_status_history')
      .select('from_status,to_status')
      .eq('job_card_id', job.id)
      .order('changed_at', { ascending: true });
    expect(history?.map((h) => h.to_status)).toEqual(path);
  });

  it('rejects an illegal skip-ahead transition and leaves status unchanged', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { error } = await manager.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'DELIVERED', p_reason: null });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('job_cards').select('status').eq('id', job.id).single();
    expect(unchanged?.status).toBe('RECEIVED');
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
});
