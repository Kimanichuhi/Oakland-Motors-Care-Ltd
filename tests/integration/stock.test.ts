import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedJobCard, seedPart } from './setup';

describe('issue_stock', () => {
  it('decrements stock on a successful issue', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const part = await seedPart(admin, 10);
    const { client: storekeeper } = await createStaffUser('STOREKEEPER', 'storekeeper');

    const { error } = await storekeeper.rpc('issue_stock', {
      p_part_id: part.id,
      p_quantity: 4,
      p_reference: job.job_number,
      p_job_card_id: job.id,
    });
    expect(error).toBeNull();

    const { data: updated } = await admin.from('parts').select('quantity_on_hand').eq('id', part.id).single();
    expect(updated?.quantity_on_hand).toBe(6);
  });

  it('rejects issuing more than is on hand and leaves stock unchanged', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const part = await seedPart(admin, 10);
    const { client: storekeeper } = await createStaffUser('STOREKEEPER', 'storekeeper');

    const { error } = await storekeeper.rpc('issue_stock', {
      p_part_id: part.id,
      p_quantity: 11,
      p_reference: job.job_number,
      p_job_card_id: job.id,
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('parts').select('quantity_on_hand').eq('id', part.id).single();
    expect(unchanged?.quantity_on_hand).toBe(10);
  });
});

describe('receive_stock', () => {
  it('increments stock on a successful receipt', async () => {
    const admin = adminClient();
    const part = await seedPart(admin, 5);
    const { client: storekeeper } = await createStaffUser('STOREKEEPER', 'storekeeper');

    const { error } = await storekeeper.rpc('receive_stock', {
      p_part_id: part.id,
      p_quantity: 20,
      p_unit_cost_minor: 45000,
      p_reference: 'PO-TEST-1',
    });
    expect(error).toBeNull();

    const { data: updated } = await admin.from('parts').select('quantity_on_hand').eq('id', part.id).single();
    expect(updated?.quantity_on_hand).toBe(25);
  });
});
