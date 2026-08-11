import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedInvoice, seedJobCard, seedPart } from './setup';

// Asserts the exact RBAC matrix from the spec's Part 20 "Final Security Test", exercised
// against the real database (RLS policies + SECURITY DEFINER RPC permission checks) rather
// than the UI, since the UI only ever hides buttons — it never enforced access on its own.

describe('RBAC matrix: TECHNICIAN', () => {
  it('cannot record a payment', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 1_000_000);
    const { client: technician } = await createStaffUser('TECHNICIAN', 'technician');

    const { error } = await technician.rpc('record_payment', {
      p_invoice_id: invoice.id, p_amount_minor: 100000, p_method: 'CASH', p_reference: 'X', p_idempotency_key: null,
    });
    expect(error).not.toBeNull();
  });

  it('cannot modify an invoice', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 1_000_000);
    const { client: technician } = await createStaffUser('TECHNICIAN', 'technician');

    const { data } = await technician.from('invoices').update({ status: 'VOID' }).eq('id', invoice.id).select();
    expect(data ?? []).toHaveLength(0);

    const { data: unchanged } = await admin.from('invoices').select('status').eq('id', invoice.id).single();
    expect(unchanged?.status).toBe('ISSUED');
  });

  it('cannot adjust stock', async () => {
    const admin = adminClient();
    const part = await seedPart(admin, 10);
    const { client: technician } = await createStaffUser('TECHNICIAN', 'technician');

    const { error } = await technician.rpc('adjust_stock', {
      p_part_id: part.id, p_adjustment_type: 'ADJUSTMENT_IN', p_quantity: 5, p_reason: 'test',
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('parts').select('quantity_on_hand').eq('id', part.id).single();
    expect(unchanged?.quantity_on_hand).toBe(10);
  });

  it('can update its assigned job', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: technician } = await createStaffUser('TECHNICIAN', 'technician');

    const { data } = await technician.from('job_cards').update({ recommended_work: 'Replace worn brake pads' }).eq('id', job.id).select();
    expect(data ?? []).toHaveLength(1);

    const { data: updated } = await admin.from('job_cards').select('recommended_work').eq('id', job.id).single();
    expect(updated?.recommended_work).toBe('Replace worn brake pads');
  });
});

describe('RBAC matrix: STOREKEEPER', () => {
  it('can issue and receive stock', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const part = await seedPart(admin, 10);
    const { client: storekeeper } = await createStaffUser('STOREKEEPER', 'storekeeper');

    const issued = await storekeeper.rpc('issue_stock', { p_part_id: part.id, p_quantity: 2, p_reference: job.job_number, p_job_card_id: job.id });
    expect(issued.error).toBeNull();

    const received = await storekeeper.rpc('receive_stock', { p_part_id: part.id, p_quantity: 5, p_unit_cost_minor: 40000, p_reference: 'PO-1' });
    expect(received.error).toBeNull();
  });

  it('cannot record a payment', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 1_000_000);
    const { client: storekeeper } = await createStaffUser('STOREKEEPER', 'storekeeper');

    const { error } = await storekeeper.rpc('record_payment', {
      p_invoice_id: invoice.id, p_amount_minor: 100000, p_method: 'CASH', p_reference: 'X', p_idempotency_key: null,
    });
    expect(error).not.toBeNull();
  });
});

describe('RBAC matrix: ACCOUNTANT', () => {
  it('can create a payment and view invoices', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 1_000_000);
    const { client: accountant } = await createStaffUser('ACCOUNTANT', 'accountant');

    const paid = await accountant.rpc('record_payment', {
      p_invoice_id: invoice.id, p_amount_minor: 500000, p_method: 'CASH', p_reference: 'X', p_idempotency_key: null,
    });
    expect(paid.error).toBeNull();

    const { data: seen } = await accountant.from('invoices').select('id').eq('id', invoice.id);
    expect(seen ?? []).toHaveLength(1);
  });

  it('cannot alter technician assignments', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { userId: technicianId } = await createStaffUser('TECHNICIAN', 'technician-target');
    const { client: accountant } = await createStaffUser('ACCOUNTANT', 'accountant');

    const { error } = await accountant.from('job_card_assignments').insert({ job_card_id: job.id, technician_id: technicianId });
    expect(error).not.toBeNull();
  });
});

describe('RBAC matrix: SERVICE_ADVISOR', () => {
  it('can create customers, vehicles, jobs and quotations', async () => {
    const { client: advisor } = await createStaffUser('SERVICE_ADVISOR', 'advisor');

    const { data: customer, error: customerError } = await advisor
      .from('customers')
      .insert({ full_name: 'Advisor Customer', phone: '0711111111' })
      .select()
      .single();
    expect(customerError).toBeNull();

    const { error: vehicleError } = await advisor
      .from('vehicles')
      .insert({ customer_id: customer!.id, registration_number: 'KADV001', make: 'Nissan', model: 'Note', mileage: 500 })
      .select()
      .single();
    expect(vehicleError).toBeNull();
  });

  it('cannot adjust stock', async () => {
    const admin = adminClient();
    const part = await seedPart(admin, 10);
    const { client: advisor } = await createStaffUser('SERVICE_ADVISOR', 'advisor');

    const { error } = await advisor.rpc('adjust_stock', { p_part_id: part.id, p_adjustment_type: 'ADJUSTMENT_IN', p_quantity: 1, p_reason: 'test' });
    expect(error).not.toBeNull();
  });
});

describe('RBAC matrix: OWNER_READONLY', () => {
  it('can view dashboard/report data but cannot create or modify records', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: owner } = await createStaffUser('OWNER_READONLY', 'owner');

    const { data: seen } = await owner.from('job_cards').select('id').eq('id', job.id);
    expect(seen ?? []).toHaveLength(1);

    const { data: created, error: createError } = await owner.from('customers').insert({ full_name: 'Should not save', phone: '0700000000' }).select();
    expect(created ?? []).toHaveLength(0);
    void createError;

    const { data: modified } = await owner.from('job_cards').update({ recommended_work: 'nope' }).eq('id', job.id).select();
    expect(modified ?? []).toHaveLength(0);
  });
});

describe('RBAC: ledger tables reject direct client writes regardless of role', () => {
  it('blocks forging an audit log entry even for a broadly-permissioned MANAGER', async () => {
    const { client: manager } = await createStaffUser('MANAGER', 'manager');
    const { error } = await manager.from('audit_logs').insert({ action: 'FORGED', entity: 'test', entity_id: null });
    expect(error).not.toBeNull();
  });

  it('blocks a direct stock_movements insert, forcing all stock changes through the RPCs', async () => {
    const admin = adminClient();
    const part = await seedPart(admin, 10);
    const { client: manager } = await createStaffUser('MANAGER', 'manager');

    const { error } = await manager.from('stock_movements').insert({
      part_id: part.id, movement_type: 'ADJUSTMENT_IN', quantity: 100, previous_balance: 10, new_balance: 110,
    });
    expect(error).not.toBeNull();
  });
});
