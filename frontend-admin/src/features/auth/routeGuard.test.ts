import { describe, expect, it } from 'vitest';
import { isRouteAllowed } from './routeGuard';
import type { AuthUser } from './rbac';

function operator(permissions: string[], roles: string[] = ['admin']): AuthUser {
  return { id: 'u1', email: 'operator@spotlight.internal', roles, permissions };
}

describe('isRouteAllowed — create-admin entry point', () => {
  const page = '/admin/admins/new';

  it('admits a wildcard admin', () => {
    expect(isRouteAllowed(page, operator(['*']))).toBe(true);
  });

  it('admits an operator who can assign roles', () => {
    expect(isRouteAllowed(page, operator(['users.roles.assign']))).toBe(true);
  });

  it('admits a super-admin on the role alone', () => {
    expect(isRouteAllowed(page, operator([], ['super-admin']))).toBe(true);
  });

  it('admits the cluster root as well as the form itself', () => {
    expect(isRouteAllowed('/admin/admins', operator(['users.roles.assign']))).toBe(true);
  });

  it('does NOT fall through to the default-deny baseline', () => {
    // The trap: with no mapping, /admin/admins is unmapped and the fallthrough
    // requires BASELINE_ADMIN_PERMISSION ('admin.access') — a slug no seeded
    // role holds, so only wildcard operators would match while the sidebar
    // entry (gated on users.roles.assign) disagrees with the guard.
    expect(isRouteAllowed(page, operator(['admin.access']))).toBe(false);
  });

  it('denies an operator who may only view users', () => {
    expect(isRouteAllowed(page, operator(['users.view']))).toBe(false);
  });

  it('denies an unauthenticated visitor', () => {
    expect(isRouteAllowed(page, null)).toBe(false);
  });
});
