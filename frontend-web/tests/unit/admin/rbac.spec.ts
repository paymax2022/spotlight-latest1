/**
 * WAL-010 (P0): parseAdminRole() previously fell back to 'executive_readonly'
 * for ANY unrecognized role string — including the ordinary customer role
 * 'user', empty string, and null — and executive_readonly carries real
 * permissions (dashboard:view, finance:view, audit:view, utility:support).
 * That silently granted those permissions to every authenticated non-admin
 * caller: `assertAdminPermission(request, 'finance:view')` passed for a
 * plain customer JWT with zero admin signal (live-reproduced against
 * GET /api/admin/payments-finance).
 *
 * The fix: unrecognized/missing input now resolves to the 'no_access'
 * sentinel role, which is deliberately absent from every permission grant.
 * executive_readonly remains a real, assignable admin role reached only by
 * an exact match — this suite pins that its permission set is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { parseAdminRole, hasPermission, type AdminRole, type AdminPermission } from '@/src/server/admin/rbac';

const ALL_PERMISSIONS: AdminPermission[] = [
  'dashboard:view', 'programs:manage', 'contests:manage', 'applications:review', 'scores:manage',
  'votes:manage', 'votes:sensitive:initiate', 'votes:sensitive:approve', 'finance:view', 'finance:refund',
  'finance:adjust:initiate', 'finance:adjust:approve', 'utility:manage', 'utility:support', 'content:manage',
  'reports:export', 'users:manage', 'roles:manage', 'audit:view',
];

function grantedPermissions(role: AdminRole): AdminPermission[] {
  return ALL_PERMISSIONS.filter((p) => hasPermission(role, p));
}

describe('WAL-010: parseAdminRole() fail-closed fallback', () => {
  it.each([
    ['plain customer role', 'user'],
    ['empty string', ''],
    ['whitespace-only string', '   '],
    ['unrecognized garbage string', 'not_a_real_role_xyz123'],
    ['a role-like but wrong-case unrecognized value', 'Executive_Readonly_Typo'],
    ['the sentinel name spelled out directly', 'no_access'],
  ])('resolves %s (%j) to a role with ZERO permissions, never executive_readonly', (_label, input) => {
    const role = parseAdminRole(input);
    expect(role).toBe('no_access');
    expect(grantedPermissions(role)).toEqual([]);
    // The specific permissions executive_readonly grants — the ones the live
    // bug exposed (finance:view, dashboard:view, audit:view, utility:support)
    // — must all be denied for the fallback.
    expect(hasPermission(role, 'finance:view')).toBe(false);
    expect(hasPermission(role, 'dashboard:view')).toBe(false);
    expect(hasPermission(role, 'audit:view')).toBe(false);
    expect(hasPermission(role, 'utility:support')).toBe(false);
  });

  it.each([
    [null],
    [undefined],
  ])('resolves missing input (%j) to a role with ZERO permissions', (input) => {
    const role = parseAdminRole(input);
    expect(role).toBe('no_access');
    expect(grantedPermissions(role)).toEqual([]);
  });

  it('never returns executive_readonly for input that is not exactly "executive_readonly"', () => {
    expect(parseAdminRole('executive')).not.toBe('executive_readonly');
    expect(parseAdminRole('readonly')).not.toBe('executive_readonly');
    expect(parseAdminRole('exec_readonly')).not.toBe('executive_readonly');
  });
});

describe('WAL-010: real AdminRole permission sets are unchanged', () => {
  // Every real admin role, including executive_readonly itself, must still
  // resolve via an exact match and keep its documented permission set. This
  // pins the fix to the *fallback* only — it must not touch legitimate roles.
  const expected: Record<AdminRole, AdminPermission[]> = {
    super_admin: [
      'dashboard:view', 'programs:manage', 'contests:manage', 'applications:review', 'scores:manage',
      'votes:manage', 'votes:sensitive:approve', 'finance:view', 'finance:refund', 'content:manage',
      'reports:export', 'users:manage', 'roles:manage', 'audit:view', 'utility:manage', 'utility:support',
    ],
    program_manager: ['dashboard:view', 'programs:manage', 'applications:review', 'reports:export'],
    contest_manager: [
      'dashboard:view', 'contests:manage', 'applications:review', 'scores:manage', 'votes:manage',
      'votes:sensitive:initiate', 'reports:export',
    ],
    voting_manager: [
      'dashboard:view', 'scores:manage', 'votes:manage', 'votes:sensitive:initiate', 'reports:export',
    ],
    finance_admin: [
      'dashboard:view', 'finance:view', 'finance:refund', 'finance:adjust:initiate', 'finance:adjust:approve',
      'utility:manage', 'utility:support', 'reports:export', 'audit:view',
    ],
    finance_maker: ['dashboard:view', 'finance:view', 'finance:adjust:initiate', 'audit:view'],
    finance_checker: ['dashboard:view', 'finance:view', 'finance:adjust:approve', 'audit:view'],
    finance_viewer: ['dashboard:view', 'finance:view', 'audit:view'],
    content_manager: ['dashboard:view', 'content:manage'],
    media_manager: ['dashboard:view', 'content:manage'],
    sponsor_manager: ['dashboard:view', 'programs:manage', 'reports:export'],
    judge: ['dashboard:view', 'scores:manage'],
    reviewer: ['dashboard:view', 'applications:review', 'scores:manage'],
    event_manager: ['dashboard:view', 'programs:manage'],
    support_agent: ['dashboard:view', 'applications:review', 'utility:support'],
    auditor: ['dashboard:view', 'audit:view', 'utility:support', 'reports:export'],
    executive_readonly: ['dashboard:view', 'finance:view', 'audit:view', 'utility:support'],
    no_access: [],
  };

  it.each(Object.keys(expected) as AdminRole[])('parseAdminRole("%s") round-trips to itself with its documented permissions', (role) => {
    expect(parseAdminRole(role)).toBe(role);
    expect(grantedPermissions(role).sort()).toEqual([...expected[role]].sort());
  });

  it('executive_readonly is still a real, exactly-matched admin role (not removed by the fix)', () => {
    expect(parseAdminRole('executive_readonly')).toBe('executive_readonly');
    expect(hasPermission('executive_readonly', 'finance:view')).toBe(true);
    expect(hasPermission('executive_readonly', 'dashboard:view')).toBe(true);
    expect(hasPermission('executive_readonly', 'audit:view')).toBe(true);
    expect(hasPermission('executive_readonly', 'utility:support')).toBe(true);
  });

  it('aliases still map to their real roles', () => {
    expect(parseAdminRole('admin')).toBe('super_admin');
    expect(parseAdminRole('operations_manager')).toBe('program_manager');
    expect(parseAdminRole('  ADMIN  ')).toBe('super_admin');
  });
});
