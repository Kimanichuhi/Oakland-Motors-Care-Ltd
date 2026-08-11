import { describe, it, expect } from 'vitest';
import { createStaffUser } from './setup';

describe('generate_job_card_number', () => {
  it('produces a well-formed, sequential number', async () => {
    const { client: advisor } = await createStaffUser('SERVICE_ADVISOR', 'advisor');
    const year = new Date().getFullYear();

    const first = await advisor.rpc('generate_job_card_number');
    const second = await advisor.rpc('generate_job_card_number');
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const pattern = new RegExp(`^[A-Za-z0-9]+-JC-${year}-\\d{6}$`);
    expect(first.data).toMatch(pattern);
    expect(second.data).toMatch(pattern);
    expect(first.data).not.toBe(second.data);

    const firstSeq = parseInt(String(first.data).split('-').pop() as string, 10);
    const secondSeq = parseInt(String(second.data).split('-').pop() as string, 10);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('never produces duplicate numbers under concurrent calls', async () => {
    const { client: advisor } = await createStaffUser('SERVICE_ADVISOR', 'advisor-concurrent');
    const results = await Promise.all(Array.from({ length: 10 }, () => advisor.rpc('generate_job_card_number')));
    expect(results.every((r) => r.error === null)).toBe(true);
    const numbers = results.map((r) => r.data);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('rejects a role without job.create', async () => {
    const { client: technician } = await createStaffUser('TECHNICIAN', 'technician-numbering');
    const { error } = await technician.rpc('generate_job_card_number');
    expect(error).not.toBeNull();
  });
});
