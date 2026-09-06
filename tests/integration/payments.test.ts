import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedJobCard, seedInvoice } from './setup';

describe('record_payment', () => {
  it('applies partial payments and flips to PAID once the balance is cleared', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 5_000_000); // KES 50,000.00
    const { client: staff } = await createStaffUser('ADMIN', 'admin-payments');

    const first = await staff.rpc('record_payment', {
      p_invoice_id: invoice.id,
      p_amount_minor: 2_000_000,
      p_method: 'CASH',
      p_reference: 'RCP-1',
      p_idempotency_key: null,
    });
    expect(first.error).toBeNull();

    const { data: afterFirst } = await admin.from('invoices').select('amount_paid_minor,status').eq('id', invoice.id).single();
    expect(afterFirst?.amount_paid_minor).toBe(2_000_000);
    expect(afterFirst?.status).toBe('PART_PAID');

    const second = await staff.rpc('record_payment', {
      p_invoice_id: invoice.id,
      p_amount_minor: 3_000_000,
      p_method: 'CASH',
      p_reference: 'RCP-2',
      p_idempotency_key: null,
    });
    expect(second.error).toBeNull();

    const { data: afterSecond } = await admin.from('invoices').select('amount_paid_minor,status').eq('id', invoice.id).single();
    expect(afterSecond?.amount_paid_minor).toBe(5_000_000);
    expect(afterSecond?.status).toBe('PAID');
  });

  it('rejects a payment that would exceed the outstanding balance', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 1_000_000);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-payments');

    const { error } = await staff.rpc('record_payment', {
      p_invoice_id: invoice.id,
      p_amount_minor: 1_500_000,
      p_method: 'CASH',
      p_reference: 'RCP-OVER',
      p_idempotency_key: null,
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin.from('invoices').select('amount_paid_minor').eq('id', invoice.id).single();
    expect(unchanged?.amount_paid_minor).toBe(0);
  });

  it('is idempotent: the same idempotency_key submitted twice produces exactly one payment', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 3_000_000);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-payments');
    const idempotencyKey = `mpesa-test-${Date.now()}`;

    const params = {
      p_invoice_id: invoice.id,
      p_amount_minor: 1_000_000,
      p_method: 'MPESA',
      p_reference: 'MPESA-RCPT-1',
      p_idempotency_key: idempotencyKey,
    };
    const first = await staff.rpc('record_payment', params);
    const second = await staff.rpc('record_payment', params);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data); // same payment id returned both times

    const { data: payments, count } = await admin
      .from('payments')
      .select('id', { count: 'exact' })
      .eq('idempotency_key', idempotencyKey);
    expect(count).toBe(1);
    expect(payments?.length).toBe(1);
  });

  it('propagates the M-Pesa reference and paid status onto sales generated from the paid job card', async () => {
    const admin = adminClient();
    const { customer, vehicle } = await seedCustomerAndVehicle(admin);
    const job = await seedJobCard(admin, customer.id, vehicle.id);
    const { client: staff } = await createStaffUser('ADMIN', 'admin-payments-jobcard');

    const { data: part } = await admin.from('parts').insert({ sku: `PAYTEST-${job.id.slice(0, 8)}`, name: 'Test Part', category: 'Other', selling_price_minor: 1000, cost_price_minor: 500, quantity_on_hand: 10, reorder_level: 1 }).select().single();
    await staff.rpc('add_job_card_part', { p_job_card_id: job.id, p_part_id: part.id, p_quantity: 2 });
    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'OPEN', p_reason: null });
    await staff.rpc('transition_job_status', { p_job_card_id: job.id, p_new_status: 'IN_PROGRESS', p_reason: null });

    const invoice = await seedInvoice(admin, customer.id, 2000, job.id);

    const partial = await staff.rpc('record_payment', { p_invoice_id: invoice.id, p_amount_minor: 1000, p_method: 'MPESA', p_reference: 'QWERTY123', p_idempotency_key: null });
    expect(partial.error).toBeNull();

    const { data: afterPartial } = await admin.from('sales').select('payment_reference,payment_status,amount_paid_minor,balance_minor').eq('job_card_id', job.id).single();
    expect(afterPartial?.payment_reference).toBe('QWERTY123');
    expect(afterPartial?.payment_status).toBe('PARTIAL');
    expect(afterPartial?.amount_paid_minor).toBe(1000);
    expect(afterPartial?.balance_minor).toBe(1000);

    const rest = await staff.rpc('record_payment', { p_invoice_id: invoice.id, p_amount_minor: 1000, p_method: 'MPESA', p_reference: 'QWERTY456', p_idempotency_key: null });
    expect(rest.error).toBeNull();

    const { data: afterFull } = await admin.from('sales').select('payment_reference,payment_status,amount_paid_minor,balance_minor').eq('job_card_id', job.id).single();
    expect(afterFull?.payment_reference).toBe('QWERTY456');
    expect(afterFull?.payment_status).toBe('PAID');
    expect(afterFull?.amount_paid_minor).toBe(2000);
    expect(afterFull?.balance_minor).toBe(0);
  });
});
