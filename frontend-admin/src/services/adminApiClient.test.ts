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

  describe('getAdminOverviewResult — says why it failed', () => {
    function mockStatus(status: number, body?: unknown, jsonThrows = false) {
      const fn = vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (jsonThrows) throw new SyntaxError('Unexpected token <');
          return body;
        },
      }));
      vi.stubGlobal('fetch', fn);
      return fn;
    }

    it('401 is unauthorized (session), even though the backend answered', async () => {
      mockStatus(401, { success: false, error: 'Not authenticated.' });
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: false, reason: 'unauthorized' });
      expect(await mod.getAdminOverview()).toBeNull();
    });

    it('403 is forbidden (signed in, no access)', async () => {
      mockStatus(403, { success: false });
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: false, reason: 'forbidden' });
    });

    it.each([502, 503, 504, 500, 404])('%i is unreachable', async (status) => {
      mockStatus(status, { success: false });
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('a non-JSON body (e.g. an HTML error page) is unreachable', async () => {
      mockStatus(200, undefined, true);
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('a network error is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('a 200 without success/modules is unreachable, not a fake empty overview', async () => {
      mockStatus(200, { success: true });
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('a good answer returns the overview', async () => {
      mockStatus(200, { success: true, generated_at: 't', modules: [] });
      const mod = await import('@/services/adminApiClient');
      expect(await mod.getAdminOverviewResult()).toEqual({ ok: true, overview: { generated_at: 't', modules: [] } });
      expect(await mod.getAdminOverview()).toEqual({ generated_at: 't', modules: [] });
    });
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
