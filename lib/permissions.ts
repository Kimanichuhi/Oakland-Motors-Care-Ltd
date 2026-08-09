'use client';

import { supabase } from '@/lib/supabase';

export type UserPermission = {
  permissions: string[];
  role: string;
  roleLabel: string;
  fullName: string;
};

let cached: UserPermission | null = null;

export async function loadUserPermissions(): Promise<UserPermission> {
  if (cached) return cached;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { permissions: [], role: '', roleLabel: '', fullName: '' };

  const [{ data: profile }, { data: userRoles }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle(),
    supabase.from('user_roles').select('role_id, roles(name,label)').eq('user_id', session.user.id),
  ]);

  const roles = (userRoles as unknown as { role_id: string; roles: { name: string; label: string } }[]) ?? [];
  const primaryRole = roles[0]?.roles;
  const roleName = primaryRole?.name ?? 'SERVICE_ADVISOR';
  const roleLabel = primaryRole?.label ?? 'Service Advisor';

  const { data: rolePerms } = await supabase
    .from('role_permissions')
    .select('permission_id, permissions(key)')
    .in('role_id', roles.map((r) => r.role_id));

  const perms = (rolePerms as unknown as { permissions: { key: string } }[]) ?? [];
  const permissions = roleName === 'ADMIN'
    ? ['*']
    : perms.map((p) => p.permissions?.key).filter(Boolean) as string[];

  cached = {
    permissions,
    role: roleName,
    roleLabel,
    fullName: profile?.full_name ?? session.user.email ?? 'User',
  };
  return cached;
}

export function hasPermission(perms: UserPermission, key: string): boolean {
  return perms.permissions.includes('*') || perms.permissions.includes(key);
}

export function clearPermissionCache() { cached = null; }
