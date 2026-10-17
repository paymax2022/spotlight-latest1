import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNavigationAnalytics, getNavigationFunnel } from './analyticsService';
import { AdminUsersRequestError } from './usersService';

const mockFetch = (status: number, body: unknown = {}) => {
  const f = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal('fetch', f);
  return f;
};

afterEach(() => vi.unstubAllGlobals());

describe('getNavigationAnalytics', () => {
  it('sends range/surface/search to the navigation path', async () => {
    const f = mockFetch(200, { topScreens: [] });
    await getNavigationAnalytics({ range: '7d', surface: 'web', search: 'a b' });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('/admin/analytics/navigation?');
    expect(url).toContain('range=7d');
    expect(url).toContain('surface=web');
    expect(url).toMatch(/search=a(\+|%20)b/);
  });
  it('404 -> disabled, no throw', async () => {
    mockFetch(404);
    await expect(getNavigationAnalytics({ range: '30d', surface: 'all', search: '' })).resolves.toEqual({
      enabled: false,
      data: null,
    });
  });
  it('403 throws AdminUsersRequestError', async () => {
    mockFetch(403, { error: 'forbidden' });
    await expect(getNavigationAnalytics({ range: '30d', surface: 'all', search: '' })).rejects.toMatchObject({
      status: 403,
    });
    mockFetch(403);
    await expect(getNavigationAnalytics({ range: '30d', surface: 'all', search: '' })).rejects.toBeInstanceOf(
      AdminUsersRequestError,
    );
  });
  it('200 -> enabled with data', async () => {
    const data = { range: '30d', surface: 'all', topScreens: [], timeseries: [], surfaceSplit: { mobile: 0, web: 0, total: 0 } };
    mockFetch(200, data);
    const r = await getNavigationAnalytics({ range: '30d', surface: 'all', search: '' });
    expect(r.enabled).toBe(true);
    expect(r.data).toMatchObject(data);
  });
});

describe('getNavigationFunnel', () => {
  const args = { steps: ['/a', '/b', '/c'], range: '7d', surface: 'web', gapMinutes: 15 };
  it('POSTs ordered steps and filters', async () => {
    const f = mockFetch(200, { steps: [] });
    await getNavigationFunnel(args);
    expect(String(f.mock.calls[0][0])).toContain('/admin/analytics/navigation/funnel');
    const init = f.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(args);
  });
  it('404 -> disabled, no throw', async () => {
    mockFetch(404);
    await expect(getNavigationFunnel(args)).resolves.toEqual({ enabled: false, data: null });
  });
  it('403 throws AdminUsersRequestError', async () => {
    mockFetch(403, { error: 'forbidden' });
    const p = getNavigationFunnel(args);
    await expect(p).rejects.toBeInstanceOf(AdminUsersRequestError);
    mockFetch(403);
    await expect(getNavigationFunnel(args)).rejects.toMatchObject({ status: 403 });
  });
  it('200 -> enabled with data', async () => {
    const data = { range: '7d', surface: 'web', gapMinutes: 15, steps: [{ route: '/a', users: 3 }] };
    mockFetch(200, data);
    const r = await getNavigationFunnel(args);
    expect(r.enabled).toBe(true);
    expect(r.data).toMatchObject(data);
  });
});
