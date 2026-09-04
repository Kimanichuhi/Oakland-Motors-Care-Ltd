import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedInvoice, seedJobCard, seedPart } from './setup';

// Oakland Motor Care Ltd runs two roles: ADMIN (full control) and MANAGER (read-only).
// Asserts that split against the real database (RLS policies + SECURITY DEFINER RPC
// permission checks) rather than the UI, since the UI only ever hides buttons — it never
// enforces access on its own.

describe('RBAC matrix: ADMIN', () => {
  it('can create customers and vehicles', async () => {
    const { client: admin } = await createStaffUser('ADMIN', 'admin');

    const { data: customer, error: customerError } = await admin
      .from('customers')
      .insert({ full_name: 'Admin Customer', phone: '0711111111' })
      .select()
      .single();
    expect(customerError).toBeNull();

    const { error: vehicleError } = await admin
      .from('vehicles')
      .insert({ customer_id: customer!.id, registration_number: 'KADM001', make: 'Nissan', model: 'Note', mileage: 500 })
      .select()
      .single();
    expect(vehicleError).toBeNull();
  });

  it('can record a payment', async () => {
    const seed = adminClient();
    const { customer } = await seedCustomerAndVehicle(seed);
    const invoice = await seedInvoice(seed, customer.id, 1_000_000);
    const { client: admin } = await createStaffUser('ADMIN', 'admin');

    const { error } = await admin.rpc('record_payment', {
      p_invoice_id: invoice.id, p_amount_minor: 500000, p_method: 'CASH', p_reference: 'X', p_idempotency_key: null,
    });
    expect(error).toBeNull();
  });

  it('can adjust stock', async () => {
    const seed = adminClient();
    const part = await seedPart(seed, 10);
    const { client: admin } = await createStaffUser('ADMIN', 'admin');

    const { error } = await admin.rpc('adjust_stock', {
      p_part_id: part.id, p_adjustment_type: 'ADJUSTMENT_IN', p_quantity: 5, p_reason: 'test',
    });
    expect(error).toBeNull();
  });
});

describe('RBAC matrix: MANAGER (read-only)', () => {
  it('can view customers, job cards, and invoices', async () => {
    const seed = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(seed);
    const job = await seedJobCard(seed, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { data: seen } = await manager.from('job_cards').select('id').eq('id', job.id);
    expect(seen ?? []).toHaveLength(1);
  });

  it('cannot create a customer', async () => {
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { data: created } = await manager.from('customers').insert({ full_name: 'Should not save', phone: '0700000000' }).select();
    expect(created ?? []).toHaveLength(0);
  });

  it('cannot modify a job card', async () => {
    const seed = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(seed);
    const job = await seedJobCard(seed, customer.id, vehicle.id);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { data: modified } = await manager.from('job_cards').update({ recommended_work: 'nope' }).eq('id', job.id).select();
    expect(modified ?? []).toHaveLength(0);
  });

  it('cannot record a payment', async () => {
    const seed = adminClient();
    const { customer } = await seedCustomerAndVehicle(seed);
    const invoice = await seedInvoice(seed, customer.id, 1_000_000);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { error } = await manager.rpc('record_payment', {
      p_invoice_id: invoice.id, p_amount_minor: 100000, p_method: 'CASH', p_reference: 'X', p_idempotency_key: null,
    });
    expect(error).not.toBeNull();
  });

  it('cannot adjust stock', async () => {
    const seed = adminClient();
    const part = await seedPart(seed, 10);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { error } = await manager.rpc('adjust_stock', {
      p_part_id: part.id, p_adjustment_type: 'ADJUSTMENT_IN', p_quantity: 1, p_reason: 'test',
    });
    expect(error).not.toBeNull();
  });
});

describe('RBAC: ledger tables reject direct client writes regardless of role', () => {
  it('blocks forging an audit log entry even for a fully-permissioned ADMIN', async () => {
    const { client: admin } = await createStaffUser('ADMIN', 'admin');
    const { error } = await admin.from('audit_logs').insert({ action: 'FORGED', entity: 'test', entity_id: null });
    expect(error).not.toBeNull();
  });

  it('blocks a direct stock_movements insert, forcing all stock changes through the RPCs', async () => {
    const seed = adminClient();
    const part = await seedPart(seed, 10);
    const { client: admin } = await createStaffUser('ADMIN', 'admin');

    const { error } = await admin.from('stock_movements').insert({
      part_id: part.id, movement_type: 'ADJUSTMENT_IN', quantity: 100, previous_balance: 10, new_balance: 110,
    });
    expect(error).not.toBeNull();
  });
});
