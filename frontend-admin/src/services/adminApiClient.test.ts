/**
 * AUTH-018 regression coverage.
 *
 * getAdminMenuCounts()/getAdminOverview() used to send only `credentials:
 * 'include'` — the session cookie. AUTH-010 tightened the admin-proxy and the
 * Go backend's admin/overview route groups to require a REAL verified bearer
 * token (middleware.RequireAdminConsoleRole), so cookie-only calls now 401
 * forever and the Operations dashboard never leaves "Loading…". These tests
 * pin that both calls attach `Authorization: Bearer <token>` sourced from the
 * same localStorage key adminAuth.ts's signInAdmin() writes to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('adminApiClient — attaches the admin bearer token', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function mockFetch(body: unknown) {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('getAdminMenuCounts sends an Authorization header when a token is stored', async () => {
    localStorage.setItem('spotlight_admin_access_token', 'test-token-123');
    const fetchFn = mockFetch({ success: true, counts: {} });
    const mod = await import('@/services/adminApiClient');

    await mod.getAdminMenuCounts();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/admin/menu-counts');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token-123');
    expect(init.credentials).toBe('include');
  });

  it('getAdminOverview sends an Authorization header when a token is stored', async () => {
    localStorage.setItem('spotlight_admin_access_token', 'test-token-456');
    const fetchFn = mockFetch({ success: true, modules: [] });
    const mod = await import('@/services/adminApiClient');

    await mod.getAdminOverview();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/admin/overview');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token-456');
  });

  it('omits Authorization (without throwing) when no token is stored', async () => {
    const fetchFn = mockFetch({ success: true, counts: {} });
    const mod = await import('@/services/adminApiClient');

    await mod.getAdminMenuCounts();

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
