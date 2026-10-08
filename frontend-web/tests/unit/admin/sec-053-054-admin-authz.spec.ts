/**
 * E2E-SEC-053 / E2E-SEC-054 regression suite.
 *
 * SEC-053 (P0, mass-assignment → super_admin):
 *   PUT /api/me/profile {"role":"admin"} used to persist user_profiles.role,
 *   which assertAdminPermission trusted — and parseAdminRole aliases
 *   'admin' → 'super_admin' — so any user self-granted super_admin on ~142 BFF
 *   admin routes whose writes run through the service-role client.
 *   Fix (write boundary): updateUserProfile allowlists user-writable fields;
 *     `role` and every other privileged column can no longer reach the upsert,
 *     and the persisted role is preserved from the DB row rather than taken
 *     from input.
 *   Fix (check boundary): assertAdminPermission resolves the caller's role
 *     from public.user_roles → roles.slug — the same authoritative store the
 *     Go backend's rbac.GetUserRoles reads — never user_profiles.role or
 *     user_metadata.
 *
 * SEC-054 (P1, ungated routes): the facilities / facilities-rbac / privileges
 *   admin routes ran on requireRequestUser + service-role only. They now call
 *   assertAdminPermission before touching the DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));

import { updateUserProfile, sanitizeProfilePatch } from '@/src/server/user/profile';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { adminRoleFromRbacSlug, resolveAdminRoleFromRbacSlugs } from '@/src/server/admin/rbac';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { PUT as profilePut } from '../../../app/api/me/profile/route';
import { GET as facilitiesListGet, POST as facilitiesCreatePost } from '../../../app/api/admin/facilities/route';
import { GET as facilitiesRbacGet } from '../../../app/api/admin/modules/facilities-rbac/route';
import { PATCH as facilitiesRbacPatch } from '../../../app/api/admin/modules/facilities-rbac/[roleId]/route';
import { GET as privilegesGet } from '../../../app/api/admin/privileges/route';

const ORIGINAL_ADMIN_KEY = process.env.SPOTLIGHT_ADMIN_API_KEY;

type MockOpts = {
  /** null/undefined → supabase.auth.getUser fails (unauthenticated caller). */
  userId?: string | null;
  /** public.user_roles → roles.slug rows the caller holds (is_active only). */
  roleSlugs?: string[];
  /** What user_profiles.role would return IF any code still read it. */
  existingProfileRole?: string | null;
  /** Rows returned by terminal awaits per table (non-user_roles lookups). */
  tableData?: Record<string, unknown[]>;
};

function makeClient(opts: MockOpts) {
  const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];
  let userProfilesReads = 0;

  const client: Record<string, unknown> = {
    auth: {
      getUser: vi.fn(async () =>
        opts.userId
          ? { data: { user: { id: opts.userId, email: 'caller@example.com', app_metadata: {}, user_metadata: {} } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
      ),
    },
  };

  client.from = vi.fn((table: string) => {
    fromCalls.push(table);
    const b: Record<string, unknown> = {};
    for (const m of [
      'select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'range',
      'insert', 'update', 'delete', 'ilike', 'or', 'gt', 'gte', 'lt', 'lte',
    ]) {
      b[m] = vi.fn(() => b);
    }
    b.upsert = vi.fn((payload: Record<string, unknown>) => {
      upserts.push({ table, payload });
      return b;
    });
    b.single = vi.fn(async () => ({ data: opts.tableData?.[table]?.[0] ?? null, error: null }));
    b.maybeSingle = vi.fn(async () => {
      if (table === 'user_profiles') {
        userProfilesReads += 1;
        // First read is updateUserProfile's role-preservation select; any
        // subsequent maybeSingle on user_profiles is the post-upsert select.
        if (userProfilesReads === 1) {
          return { data: opts.existingProfileRole != null ? { role: opts.existingProfileRole } : null, error: null };
        }
        return { data: upserts.length ? upserts[upserts.length - 1].payload : null, error: null };
      }
      return { data: null, error: null };
    });
    // Terminal await — supabase-js builders are thenable at every step.
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'user_roles'
            ? (opts.roleSlugs ?? []).map((slug) => ({ roles: { slug } }))
            : (opts.tableData?.[table] ?? []),
        error: null,
      }).then(res, rej);
    return b;
  });

  return { client, upserts, fromCalls };
}

function installClients(opts: MockOpts) {
  const made = makeClient(opts);
  vi.mocked(createClient).mockResolvedValue(made.client as never);
  vi.mocked(createAdminClient).mockReturnValue(made.client as never);
  return made;
}

function bearerRequest(url: string, init: { method?: string; body?: unknown } = {}) {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SPOTLIGHT_ADMIN_API_KEY;
});
afterEach(() => {
  if (ORIGINAL_ADMIN_KEY === undefined) delete process.env.SPOTLIGHT_ADMIN_API_KEY;
  else process.env.SPOTLIGHT_ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;
});

describe('SEC-053: PUT /api/me/profile can no longer self-assign a role', () => {
  it('strips role (and other privileged fields) before the upsert — DB value is preserved', async () => {
    const { client, upserts } = installClients({ userId: 'u-1', existingProfileRole: 'USER' });
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const res = await profilePut(
      bearerRequest('/api/me/profile', {
        method: 'PUT',
        body: { role: 'admin', is_admin: true, kyc_tier: 3, status: 'verified', firstName: 'Ada', phone: '08012345678' },
      }),
    );
    expect(res.status).toBe(200);

    expect(upserts.length).toBeGreaterThan(0);
    for (const { payload } of upserts) {
      // The role column is written only from the existing DB row / 'USER'
      // insert default — never from the request body.
      expect(payload.role).toBe('USER');
      expect(payload.is_admin).toBeUndefined();
      expect(payload.kyc_tier).toBeUndefined();
      expect(payload.kyc_status).toBeUndefined();
      expect(payload.status).toBeUndefined();
      expect(payload.verified).toBeUndefined();
      expect(payload.permissions).toBeUndefined();
      expect(payload.roles).toBeUndefined();
    }
    // Legitimate fields still flow through.
    expect(upserts[0].payload.first_name).toBe('Ada');
    expect(upserts[0].payload.phone).toBe('08012345678');
    expect((upserts[0].payload.metadata as Record<string, unknown>).firstName).toBe('Ada');
  });

  it('preserves an existing DB role on update instead of clobbering or honoring input', async () => {
    const { client, upserts } = installClients({ userId: 'u-1', existingProfileRole: 'support-admin' });
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    await updateUserProfile({ id: 'u-1', email: 'caller@example.com' }, { role: 'super_admin', phone: '0809' });
    expect(upserts[0].payload.role).toBe('support-admin');
    expect(upserts[0].payload.phone).toBe('0809');
  });

  it('sanitizeProfilePatch drops every non-allowlisted key', () => {
    const patch = sanitizeProfilePatch({
      role: 'admin', is_admin: true, kyc_tier: 3, kyc_status: 'verified', status: 'active',
      verified: true, permissions: ['*'], roles: ['super-admin'], id: 'spoofed',
      firstName: 'Ada', bio: 'hi',
    });
    expect(patch).toEqual({ firstName: 'Ada', bio: 'hi' });
  });
});

describe('SEC-053: assertAdminPermission resolves roles from user_roles only', () => {
  it('denies a caller whose user_profiles.role="admin" but user_roles has no admin role', async () => {
    // existingProfileRole 'admin' is the poisoned value the exploit wrote. If
    // the check boundary ever regresses to reading user_profiles.role, this
    // test goes red: the mocked user_profiles row would supply 'admin' →
    // super_admin → grant.
    installClients({ userId: 'u-1', existingProfileRole: 'admin', roleSlugs: ['registered-user', 'verified-user'] });

    await expect(
      assertAdminPermission(bearerRequest('/api/admin/audit-logs'), 'audit:view'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('denies a caller with NO user_roles rows at all', async () => {
    installClients({ userId: 'u-1', existingProfileRole: 'admin', roleSlugs: [] });
    await expect(
      assertAdminPermission(bearerRequest('/api/admin/audit-logs'), 'audit:view'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('never queries user_profiles during authorization', async () => {
    const { fromCalls } = installClients({ userId: 'u-1', roleSlugs: ['registered-user'] });
    await expect(
      assertAdminPermission(bearerRequest('/api/admin/x'), 'audit:view'),
    ).rejects.toMatchObject({ status: 403 });
    expect(fromCalls).toContain('user_roles');
    expect(fromCalls).not.toContain('user_profiles');
  });

  it('admits a real super-admin via user_roles', async () => {
    installClients({ userId: 'u-1', roleSlugs: ['registered-user', 'super-admin'] });
    const identity = await assertAdminPermission(bearerRequest('/api/admin/audit-logs'), 'audit:view');
    expect(identity.role).toBe('super_admin');
    expect(identity.actorId).toBe('u-1');
  });

  it('admits system-admin (platform admin) as super_admin', async () => {
    installClients({ userId: 'u-1', roleSlugs: ['system-admin'] });
    const identity = await assertAdminPermission(bearerRequest('/api/admin/audit-logs'), 'roles:manage');
    expect(identity.role).toBe('super_admin');
  });

  it('grants a permission when ANY held role grants it (union semantics)', async () => {
    installClients({ userId: 'u-1', roleSlugs: ['judge', 'finance-viewer'] });
    const identity = await assertAdminPermission(bearerRequest('/api/admin/x'), 'scores:manage');
    expect(identity.role).toBe('judge');
  });

  it('slug→AdminRole mapping is fail-closed for non-admin DB roles', () => {
    for (const slug of ['registered-user', 'verified-user', 'contestant', 'estate-admin', 'state-coordinator', 'sponsor-representative', 'school-representative']) {
      expect(adminRoleFromRbacSlug(slug)).toBeNull();
    }
    expect(adminRoleFromRbacSlug('super-admin')).toBe('super_admin');
    expect(adminRoleFromRbacSlug('system-admin')).toBe('super_admin');
    expect(adminRoleFromRbacSlug('contest-manager')).toBe('contest_manager');
    expect(adminRoleFromRbacSlug('judge')).toBe('judge');
    expect(resolveAdminRoleFromRbacSlugs([], 'audit:view')).toBe('no_access');
    expect(resolveAdminRoleFromRbacSlugs(['registered-user'], 'audit:view')).toBe('no_access');
  });
});

describe('SEC-054: previously ungated admin routes now enforce admin RBAC', () => {
  it('GET /api/admin/facilities → 403 for a non-admin', async () => {
    const { fromCalls } = installClients({ userId: 'u-1', roleSlugs: ['registered-user'] });
    const res = await facilitiesListGet(bearerRequest('/api/admin/facilities'));
    expect(res.status).toBe(403);
    expect(fromCalls).not.toContain('estate_facilities');
  });

  it('POST /api/admin/facilities → 403 for a non-admin (no row created)', async () => {
    const { fromCalls } = installClients({ userId: 'u-1', roleSlugs: ['registered-user'] });
    const res = await facilitiesCreatePost(
      bearerRequest('/api/admin/facilities', {
        method: 'POST',
        body: { name: 'Pool', kind: 'pool', estateId: 'est-1' },
      }),
    );
    expect(res.status).toBe(403);
    expect(fromCalls).not.toContain('estate_facilities');
  });

  it('GET /api/admin/modules/facilities-rbac → 403 for a non-admin', async () => {
    const { fromCalls } = installClients({ userId: 'u-1', roleSlugs: ['registered-user'] });
    const res = await facilitiesRbacGet(bearerRequest('/api/admin/modules/facilities-rbac'));
    expect(res.status).toBe(403);
    expect(fromCalls).not.toContain('roles');
    expect(fromCalls).not.toContain('role_permissions');
  });

  it('PATCH /api/admin/modules/facilities-rbac/[roleId] → 403 for a non-admin (no role_permissions write)', async () => {
    const { fromCalls } = installClients({ userId: 'u-1', roleSlugs: ['registered-user'] });
    const res = await facilitiesRbacPatch(
      bearerRequest('/api/admin/modules/facilities-rbac/role-1', {
        method: 'PATCH',
        body: { facilitiesCreate: true },
      }),
      { params: Promise.resolve({ roleId: 'role-1' }) },
    );
    expect(res.status).toBe(403);
    expect(fromCalls).not.toContain('role_permissions');
  });

  it('GET /api/admin/privileges → 403 for a non-admin', async () => {
    const { fromCalls } = installClients({ userId: 'u-1', roleSlugs: ['registered-user'] });
    const res = await privilegesGet(bearerRequest('/api/admin/privileges'));
    expect(res.status).toBe(403);
    expect(fromCalls).not.toContain('role_permissions');
    expect(fromCalls).not.toContain('user_permissions');
  });

  it('401s an unauthenticated caller before any data read', async () => {
    const { fromCalls } = installClients({ userId: null });
    const res = await facilitiesListGet(bearerRequest('/api/admin/facilities'));
    expect(res.status).toBe(401);
    expect(fromCalls).not.toContain('estate_facilities');
  });

  it('still serves a real super-admin (GET /api/admin/facilities → 200)', async () => {
    installClients({
      userId: 'admin-1',
      roleSlugs: ['super-admin'],
      tableData: {
        estate_facilities: [
          { id: 'f-1', estate_id: 'e-1', name: 'Hall', kind: 'hall', capacity: 50, fee_kobo: 1000 },
        ],
      },
    });
    const res = await facilitiesListGet(bearerRequest('/api/admin/facilities'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].name).toBe('Hall');
  });
});
