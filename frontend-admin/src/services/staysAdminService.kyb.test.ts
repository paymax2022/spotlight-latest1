// @vitest-environment node
/**
 * Stays hotelier KYB review: the admin page must hit the REAL Go routes
 * (GET /api/stays/admin/kyb, POST /api/stays/admin/hoteliers/:id/kyb/decision).
 * It used to call /kyc and /kyc/:id/decide, which Go never registered, so the
 * page could neither list nor decide anything outside fixture mode. The
 * moderation list likewise called an unregistered /moderation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('staysAdminService — KYB + moderation hit registered routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_STAYS_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown) {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const urlOf = (fn: ReturnType<typeof mockFetch>) => String((fn.mock.calls[0] as unknown[])[0]);

  it('lists the KYB queue from /kyb with the status filter', async () => {
    const fn = mockFetch({ data: [] });
    const mod = await import('@/services/staysAdminService');
    await mod.listKyc({ status: 'submitted' });
    expect(urlOf(fn)).toMatch(/\/api\/stays\/admin\/kyb\?status=submitted$/);
    expect(urlOf(fn)).not.toContain('/kyc');
  });

  it('posts the decision to the hotelier KYB decision route', async () => {
    const fn = mockFetch({ data: { overall: 'approved' } });
    const mod = await import('@/services/staysAdminService');
    const out = await mod.decideKyc('prop-1', { decision: 'approve' });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/stays\/admin\/hoteliers\/prop-1\/kyb\/decision$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ decision: 'approve' });
    expect(out).toEqual({ id: 'prop-1', status: 'approved' });
  });

  it('refuses reject / needs_changes without a note, without calling the API', async () => {
    const fn = mockFetch({ data: {} });
    const mod = await import('@/services/staysAdminService');
    await expect(mod.decideKyc('p', { decision: 'reject', note: '  ' })).rejects.toThrow(/note is required/i);
    await expect(mod.decideKyc('p', { decision: 'needs_changes' })).rejects.toThrow(/note is required/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not report a decision in fixture mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_STAYS_USE_MOCK', 'true');
    const fn = mockFetch({});
    const mod = await import('@/services/staysAdminService');
    await expect(mod.decideKyc('p', { decision: 'approve' })).rejects.toThrow(/fixture mode/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reads the moderation queue from /properties', async () => {
    const fn = mockFetch({ data: [] });
    const mod = await import('@/services/staysAdminService');
    await mod.listModeration({ status: 'pending_review' });
    expect(urlOf(fn)).toMatch(/\/api\/stays\/admin\/properties\?status=pending_review$/);
  });
});
