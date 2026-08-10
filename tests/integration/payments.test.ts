import { describe, it, expect } from 'vitest';
import { adminClient, createStaffUser, seedCustomerAndVehicle, seedInvoice } from './setup';

describe('record_payment', () => {
  it('applies partial payments and flips to PAID once the balance is cleared', async () => {
    const admin = adminClient();
    const { customer } = await seedCustomerAndVehicle(admin);
    const invoice = await seedInvoice(admin, customer.id, 5_000_000); // KES 50,000.00
    const { client: accountant } = await createStaffUser('ACCOUNTANT', 'accountant');

    const first = await accountant.rpc('record_payment', {
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

    const second = await accountant.rpc('record_payment', {
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
    const { client: accountant } = await createStaffUser('ACCOUNTANT', 'accountant');

    const { error } = await accountant.rpc('record_payment', {
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
    const { client: accountant } = await createStaffUser('ACCOUNTANT', 'accountant');
    const idempotencyKey = `mpesa-test-${Date.now()}`;

    const params = {
      p_invoice_id: invoice.id,
      p_amount_minor: 1_000_000,
      p_method: 'MPESA',
      p_reference: 'MPESA-RCPT-1',
      p_idempotency_key: idempotencyKey,
    };
    const first = await accountant.rpc('record_payment', params);
    const second = await accountant.rpc('record_payment', params);
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
});
