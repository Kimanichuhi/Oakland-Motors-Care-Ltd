import { describe, it, expect } from 'vitest';
import { createStaffUser } from './setup';

describe('generate_sale_number', () => {
  it('produces a well-formed, sequential Sale-### number', async () => {
    const { client: admin } = await createStaffUser('ADMIN', 'admin-sale-numbering');

    const first = await admin.rpc('generate_sale_number');
    const second = await admin.rpc('generate_sale_number');
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const pattern = /^Sale-\d{3,}$/;
    expect(first.data).toMatch(pattern);
    expect(second.data).toMatch(pattern);
    expect(first.data).not.toBe(second.data);

    const firstSeq = parseInt(String(first.data).split('-').pop() as string, 10);
    const secondSeq = parseInt(String(second.data).split('-').pop() as string, 10);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('never produces duplicate numbers under concurrent calls', async () => {
    const { client: admin } = await createStaffUser('ADMIN', 'admin-sale-numbering-concurrent');
    const results = await Promise.all(Array.from({ length: 10 }, () => admin.rpc('generate_sale_number')));
    expect(results.every((r) => r.error === null)).toBe(true);
    const numbers = results.map((r) => r.data);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('rejects a role without sales.create', async () => {
    const { client: manager } = await createStaffUser('MANAGER', 'manager-sale-numbering');
    const { error } = await manager.rpc('generate_sale_number');
    expect(error).not.toBeNull();
  });
});
