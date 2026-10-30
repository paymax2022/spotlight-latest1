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

describe('loadAdminOverview — tells a rejected session apart from an unreachable backend', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a 401 as unauthorized, never as the API not answering', async () => {
    // The backend answered — it rejected the session (GoTrue no longer knows
    // it: revoked by a password reset, or signed out elsewhere). Telling the
    // operator to "check the backend is running" sends them to the wrong place.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ success: false, error: 'invalid token' }),
    })));
    const mod = await import('@/services/adminApiClient');
    expect(await mod.loadAdminOverview()).toEqual({ status: 'unauthorized' });
  });

  it('reports a 403 as unauthorized too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 403, json: async () => ({ success: false, error: 'forbidden' }),
    })));
    const mod = await import('@/services/adminApiClient');
    expect(await mod.loadAdminOverview()).toEqual({ status: 'unauthorized' });
  });

  it('reports a network failure or 5xx as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    let mod = await import('@/services/adminApiClient');
    expect(await mod.loadAdminOverview()).toEqual({ status: 'unavailable' });

    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 504, json: async () => ({ success: false, error: 'The admin API could not be reached.' }),
    })));
    mod = await import('@/services/adminApiClient');
    expect(await mod.loadAdminOverview()).toEqual({ status: 'unavailable' });
  });

  it('returns the overview on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ success: true, generated_at: '2026-10-23T13:00:00Z', modules: [] }),
    })));
    const mod = await import('@/services/adminApiClient');
    expect(await mod.loadAdminOverview()).toEqual({
      status: 'ok', overview: { generated_at: '2026-10-23T13:00:00Z', modules: [] },
    });
  });
});
