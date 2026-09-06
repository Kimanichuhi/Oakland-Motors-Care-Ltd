import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedJobCard } from './setup';

describe('transition_job_status', () => {
  it('walks the full valid state machine end to end', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-transitions');

    const path = ['OPEN', 'IN_PROGRESS', 'COMPLETED'];
    for (const status of path) {
      const { error } = await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: status, p_reason: null });
      expect(error, `transition to ${status} should succeed`).toBeNull();
    }

    const { data: finalJob } = await admin.from('job_cards').select('status,received_at,released_at').eq('id', job.id).single();
    expect(finalJob?.status).toBe('COMPLETED');
    expect(finalJob?.received_at).not.toBeNull();
    expect(finalJob?.released_at).not.toBeNull();

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
    const { client: staff } = await createStaffUser('ADMIN', 'admin-transitions');

    const { error } = await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'COMPLETED', p_reason: null });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('job_cards').select('status').eq('id', job.id).single();
    expect(unchanged?.status).toBe('DRAFT');
  });

  it('rejects transitioning out of a terminal state', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-transitions');

    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'CANCELLED', p_reason: 'test' });
    const { error } = await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'IN_PROGRESS', p_reason: null });
    expect(error).not.toBeNull();
  });

  it('issues pending parts on transition into IN_PROGRESS', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-transitions');

    const { data: part } = await admin.from('parts').insert({ sku: `TEST-${job.id.slice(0, 8)}`, name: 'Test part', category: 'Other', selling_price_minor: 1000, cost_price_minor: 500, quantity_on_hand: 10, reorder_level: 1 }).select().single();

    await staff.rpc('add_job_card_part', { p_job_card_id: job.id, p_part_id: part.id, p_quantity: 3 });
    const { data: beforeIssue } = await admin.from('parts').select('quantity_on_hand').eq('id', part.id).single();
    expect(beforeIssue?.quantity_on_hand).toBe(10);

    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'OPEN', p_reason: null });
    const { error } = await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'IN_PROGRESS', p_reason: null });
    expect(error).toBeNull();

    const { data: afterIssue } = await admin.from('parts').select('quantity_on_hand').eq('id', part.id).single();
    expect(afterIssue?.quantity_on_hand).toBe(7);

    const { data: line } = await admin.from('job_card_parts').select('issued_at').eq('job_card_id', job.id).eq('part_id', part.id).single();
    expect(line?.issued_at).not.toBeNull();

    const { data: sale } = await admin.from('sales').select('*, sale_items(*)').eq('job_card_id', job.id).single();
    expect(sale?.customer_type).toBe('JOB_CARD');
    expect(sale?.payment_method).toBe('JOB_CARD');
    expect(sale?.payment_status).toBe('PENDING');
    expect(sale?.total_minor).toBe(3000);
    expect(sale?.sale_items).toHaveLength(1);
    expect(sale?.sale_items[0].part_id).toBe(part.id);
    expect(sale?.sale_items[0].quantity).toBe(3);
  });

  it('creates exactly one sale for a batch of parts issued in a single transition', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-transitions-2');

    const { data: part } = await admin.from('parts').insert({ sku: `TEST2-${job.id.slice(0, 8)}`, name: 'Test part 2', category: 'Other', selling_price_minor: 500, cost_price_minor: 200, quantity_on_hand: 10, reorder_level: 1 }).select().single();
    await staff.rpc('add_job_card_part', { p_job_card_id: job.id, p_part_id: part.id, p_quantity: 2 });
    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'OPEN', p_reason: null });
    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'IN_PROGRESS', p_reason: null });

    const { count: firstCount } = await admin.from('sales').select('id', { count: 'exact', head: true }).eq('job_card_id', job.id);
    expect(firstCount).toBe(1);
  });

  it('creates one separate sale per distinct part when a job card uses more than one', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-transitions-3');

    const { data: partA } = await admin.from('parts').insert({ sku: `TEST3A-${job.id.slice(0, 8)}`, name: 'Brake Pad', category: 'Other', selling_price_minor: 1000, cost_price_minor: 500, quantity_on_hand: 10, reorder_level: 1 }).select().single();
    const { data: partB } = await admin.from('parts').insert({ sku: `TEST3B-${job.id.slice(0, 8)}`, name: 'Oil Filter', category: 'Other', selling_price_minor: 700, cost_price_minor: 300, quantity_on_hand: 10, reorder_level: 1 }).select().single();
    await staff.rpc('add_job_card_part', { p_job_card_id: job.id, p_part_id: partA.id, p_quantity: 2 });
    await staff.rpc('add_job_card_part', { p_job_card_id: job.id, p_part_id: partB.id, p_quantity: 1 });
    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'OPEN', p_reason: null });
    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'IN_PROGRESS', p_reason: null });

    const { data: sales } = await admin.from('sales').select('*, sale_items(*)').eq('job_card_id', job.id).order('total_minor', { ascending: false });
    expect(sales).toHaveLength(2);
    expect(sales?.every((s) => s.job_card_id === job.id)).toBe(true);
    expect(new Set(sales?.map((s) => s.sale_number)).size).toBe(2); // distinct sale numbers

    const brakePadSale = sales?.find((s) => s.sale_items[0].part_id === partA.id);
    expect(brakePadSale?.total_minor).toBe(2000);
    expect(brakePadSale?.sale_items).toHaveLength(1);

    const oilFilterSale = sales?.find((s) => s.sale_items[0].part_id === partB.id);
    expect(oilFilterSale?.total_minor).toBe(700);
    expect(oilFilterSale?.sale_items).toHaveLength(1);
  });
});
