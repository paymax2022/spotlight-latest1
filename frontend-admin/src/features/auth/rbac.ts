'use client';

export type AuthUser = {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
};

export function hasPermission(user: AuthUser | null, permission: string): boolean {
  if (!user) return false;
  if (user.roles?.includes('super-admin')) return true;
  // Wildcard: a user granted '*' passes any permission check (UX-only gate;
  // backend RBAC remains authoritative).
  if (user.permissions?.includes('*')) return true;
  return user.permissions?.includes(permission) ?? false;
}

export function hasAnyPermission(user: AuthUser | null, permissions: string[]): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export function hasAllPermissions(user: AuthUser | null, permissions: string[]): boolean {
  return permissions.every((p) => hasPermission(user, p));
}
