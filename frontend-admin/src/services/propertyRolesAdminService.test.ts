// @vitest-environment node
/**
 * Property role review queue: reads fail loudly and writes never fake success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { url: string; init?: RequestInit };

function stubFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

const profile = { id: 'p1', role: 'realtor', verificationStatus: 'pending', documents: [] };

describe('propertyRolesAdminService', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('listRoles reads items and defaults to pending', async () => {
    const { calls } = stubFetch(200, { items: [profile] });
    const mod = await import('@/services/propertyRolesAdminService');
    const rows = await mod.listRoles();
    expect(rows).toEqual([profile]);
    expect(calls[0].url).toMatch(/\/api\/property\/admin\/roles\?status=pending$/);
  });

  it('listRoles passes an explicit status', async () => {
    const { calls } = stubFetch(200, { items: [] });
    const mod = await import('@/services/propertyRolesAdminService');
    await mod.listRoles('verified');
    expect(calls[0].url).toMatch(/status=verified$/);
  });

  it('listRoles rejects with the server message on non-2xx (no silent empty list)', async () => {
    stubFetch(403, { error: 'permission denied' });
    const mod = await import('@/services/propertyRolesAdminService');
    await expect(mod.listRoles()).rejects.toThrow(/permission denied/);
  });

  it('listRoles rejects on a 500 without a message', async () => {
    stubFetch(500, {});
    const mod = await import('@/services/propertyRolesAdminService');
    await expect(mod.listRoles()).rejects.toThrow(/500/);
  });

  it('approve / reject / suspend call the right method and URL', async () => {
    const { calls } = stubFetch(200, profile);
    const mod = await import('@/services/propertyRolesAdminService');
    await mod.approveRole('p1');
    await mod.rejectRole('p1', 'blurry id');
    await mod.suspendRole('p1', 'fraud');
    await mod.suspendRole('p1');
    expect(calls.map((c) => [c.init?.method, c.url.replace(/^.*\/api\/property/, '')])).toEqual([
      ['POST', '/admin/roles/p1/approve'],
      ['POST', '/admin/roles/p1/reject'],
      ['POST', '/admin/roles/p1/suspend'],
      ['POST', '/admin/roles/p1/suspend'],
    ]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ reason: 'blurry id' });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ reason: 'fraud' });
  });

  it('a self-review 403 surfaces the server message on approve', async () => {
    stubFetch(403, { error: 'cannot review your own profile' });
    const mod = await import('@/services/propertyRolesAdminService');
    await expect(mod.approveRole('p1')).rejects.toThrow(/cannot review your own profile/);
  });

  it('blank reject reason never calls fetch', async () => {
    const { fn } = stubFetch(200, profile);
    const mod = await import('@/services/propertyRolesAdminService');
    await expect(mod.rejectRole('p1', '   ')).rejects.toThrow(/reason/i);
    expect(fn).not.toHaveBeenCalled();
  });
});
