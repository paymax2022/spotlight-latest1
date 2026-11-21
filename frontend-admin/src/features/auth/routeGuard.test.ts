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

describe('isRouteAllowed — the contest leaderboard → contestant route', () => {
  // /admin/competitions/results links each ranked contestant to
  // /admin/voting/contestant/<id> (the profile + the admin-vote form). With no
  // mapping for either prefix, both fall through to the default-deny baseline —
  // `admin.access`, a slug no seeded role holds — so the sidebar advertises the
  // contest pages to a contest operator (contest.create / contest.update) and the
  // guard then bounces that same operator to /admin/unauthorized. The entries must
  // agree with AdminSidebar.tsx's own permission pairs.
  const results = '/admin/competitions/results';
  const contestant = '/admin/voting/contestant/87ad2762-bd98-4f61-9bc9-b2a86807be83';

  it('admits the contest-operator pair the sidebar advertises', () => {
    expect(isRouteAllowed(results, operator(['contest.update']))).toBe(true);
    expect(isRouteAllowed(results, operator(['contest.create']))).toBe(true);
    expect(isRouteAllowed('/admin/competitions/list', operator(['contest.publish']))).toBe(true);
    expect(isRouteAllowed(contestant, operator(['contest.update']))).toBe(true);
  });

  it('admits voting managers to the /admin/voting pages the sidebar lists for votes:manage', () => {
    expect(isRouteAllowed('/admin/voting/packages', operator(['votes:manage']))).toBe(true);
    expect(isRouteAllowed('/admin/voting/results', operator(['votes:manage']))).toBe(true);
    expect(isRouteAllowed(contestant, operator(['votes:manage']))).toBe(true);
  });

  it('still denies an operator who holds neither contest nor voting rights', () => {
    expect(isRouteAllowed(results, operator(['users.view']))).toBe(false);
    expect(isRouteAllowed(contestant, operator(['users.view']))).toBe(false);
    expect(isRouteAllowed('/admin/voting/audit-log', operator(['users.view']))).toBe(false);
  });

  it('admits a wildcard admin everywhere', () => {
    expect(isRouteAllowed(results, operator(['*']))).toBe(true);
    expect(isRouteAllowed(contestant, operator(['*']))).toBe(true);
  });
});
