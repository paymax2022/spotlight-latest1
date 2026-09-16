'use client';

import type { AuthUser } from '@/features/auth/rbac';

/** Reads the cached admin identity written at sign-in (see features/auth/adminAuth). */
export function readCurrentAdmin(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('spotlight_admin_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      id: String(parsed.id ?? ''),
      email: String(parsed.email ?? ''),
      roles: Array.isArray(parsed.roles) ? parsed.roles.map(String) : [],
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function isSuperAdmin(user: AuthUser | null): boolean {
  return Boolean(user?.roles?.includes('super-admin'));
}
