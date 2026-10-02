/**
 * BFF session-cookie coverage (replaces the AUTH-018 localStorage pinning).
 *
 * getAdminMenuCounts()/getAdminOverview() call the same-origin /api/admin-proxy
 * with `credentials: 'include'` so the HttpOnly `sb-admin-token` cookie reaches
 * the route handler, which attaches `Authorization: Bearer <token>` SERVER-SIDE
 * from the cookie. No browser code may attach (or even read) the token — the
 * CodeQL js/clear-text-storage-of-sensitive-data fix removed the localStorage
 * copy entirely. These tests pin the new contract: proxy URL, credentials, and
 * NO client-supplied Authorization header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('adminApiClient — calls the session-cookie proxy, never sends a bearer', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown) {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('getAdminMenuCounts goes through /api/admin-proxy with credentials and no client Authorization', async () => {
    const fetchFn = mockFetch({ success: true, counts: {} });
    const mod = await import('@/services/adminApiClient');

    await mod.getAdminMenuCounts();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/admin-proxy/');
    expect(String(url)).toContain('/admin/menu-counts');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('getAdminOverview goes through /api/admin-proxy with credentials and no client Authorization', async () => {
    const fetchFn = mockFetch({ success: true, modules: [] });
    const mod = await import('@/services/adminApiClient');

    await mod.getAdminOverview();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/admin-proxy/');
    expect(String(url)).toContain('/admin/overview');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('adminAuthHeaders never attaches Authorization — even with a stale key planted', async () => {
    // A leftover/forged localStorage entry must not be picked up: the service
    // layer does not read the key at all any more.
    localStorage.setItem('spotlight_admin_access_token', 'planted-token');
    const mod = await import('@/config/env');
    expect(mod.adminAuthHeaders()).toEqual({});
    expect(mod.adminAuthHeaders({ 'Content-Type': 'application/json' }))
      .toEqual({ 'Content-Type': 'application/json' });
    localStorage.removeItem('spotlight_admin_access_token');
  });
});
