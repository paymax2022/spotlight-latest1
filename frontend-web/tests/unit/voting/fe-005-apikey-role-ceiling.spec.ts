/**
 * AUD-FE-005 — the shared admin API key must not let its holder self-declare
 * an elevated role or forge audit attribution.
 *
 * Path (b) of assertAdminPermission now treats x-admin-role/x-spotlight-role
 * as a NARROWING of the ceiling in SPOTLIGHT_ADMIN_API_KEY_ROLE (same rule
 * the JWT path documents for role headers), refuses out-of-ceiling claims,
 * and always reports actorId 'api-key' — x-actor-id is ignored.
 *
 * Backward-compat note: with SPOTLIGHT_ADMIN_API_KEY_ROLE unset the declared
 * role is still honored (the pre-fix behaviour — the env var is the control
 * that closes the hole in deployed envs).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));

import { assertAdminPermission } from '@/src/server/admin/auth';
import { roleIsSubset } from '@/src/server/admin/rbac';

const KEY = 'test-admin-key';

function keyRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/x', {
    method: 'POST',
    headers: { 'x-admin-key': KEY, ...headers },
    body: JSON.stringify({}),
  });
}

describe('FE-005: admin API-key role ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPOTLIGHT_ADMIN_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.SPOTLIGHT_ADMIN_API_KEY_ROLE;
  });

  it('honours a declared role within the ceiling (narrowing)', async () => {
    process.env.SPOTLIGHT_ADMIN_API_KEY_ROLE = 'super_admin';
    const id = await assertAdminPermission(keyRequest({ 'x-admin-role': 'auditor' }), 'audit:view');
    expect(id.role).toBe('auditor');
  });

  it('refuses a role claim outside the ceiling — escalation attempt', async () => {
    process.env.SPOTLIGHT_ADMIN_API_KEY_ROLE = 'auditor';
    await expect(
      assertAdminPermission(keyRequest({ 'x-admin-role': 'super_admin' }), 'audit:view'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      assertAdminPermission(keyRequest({ 'x-admin-role': 'admin' }), 'audit:view'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('applies the ceiling role when no role header is sent', async () => {
    process.env.SPOTLIGHT_ADMIN_API_KEY_ROLE = 'auditor';
    const id = await assertAdminPermission(keyRequest(), 'audit:view');
    expect(id.role).toBe('auditor');
    await expect(assertAdminPermission(keyRequest(), 'finance:refund')).rejects.toMatchObject({ status: 403 });
  });

  it('ignores x-actor-id — audit attribution is the constant api-key', async () => {
    process.env.SPOTLIGHT_ADMIN_API_KEY_ROLE = 'auditor';
    const id = await assertAdminPermission(
      keyRequest({ 'x-admin-role': 'auditor', 'x-actor-id': 'forged-admin-uuid' }),
      'audit:view',
    );
    expect(id.actorId).toBe('api-key');
  });

  it('without a configured ceiling, legacy declared-role behaviour is unchanged', async () => {
    const id = await assertAdminPermission(keyRequest({ 'x-admin-role': 'judge' }), 'scores:manage');
    expect(id.role).toBe('judge');
    expect(id.actorId).toBe('api-key');
  });
});

describe('roleIsSubset', () => {
  it('a role is a subset of itself; no_access is a subset of everything', () => {
    expect(roleIsSubset('judge', 'judge')).toBe(true);
    expect(roleIsSubset('no_access', 'auditor')).toBe(true);
    expect(roleIsSubset('super_admin', 'auditor')).toBe(false);
  });
});
