import { describe, it, expect } from 'vitest';
import { hasPermission, type UserPermission } from '@/lib/permissions';

function perms(list: string[]): UserPermission {
  return { permissions: list, role: 'TEST', roleLabel: 'Test', fullName: 'Test User' };
}

describe('hasPermission', () => {
  it('grants everything to the ADMIN wildcard', () => {
    const admin = perms(['*']);
    expect(hasPermission(admin, 'payment.create')).toBe(true);
    expect(hasPermission(admin, 'settings.manage')).toBe(true);
    expect(hasPermission(admin, 'anything.at.all')).toBe(true);
  });

  it('grants only explicitly listed permissions', () => {
    const technician = perms(['dashboard.view', 'job.view', 'job.update']);
    expect(hasPermission(technician, 'job.update')).toBe(true);
    expect(hasPermission(technician, 'payment.create')).toBe(false);
    expect(hasPermission(technician, 'inventory.adjust')).toBe(false);
  });

  it('denies everything for a user with no permissions', () => {
    const nobody = perms([]);
    expect(hasPermission(nobody, 'dashboard.view')).toBe(false);
  });
});
