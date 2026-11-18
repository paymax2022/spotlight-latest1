import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./telemedAdminAnnouncementsService');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('telemedicine admin announcements (live)', () => {
  it('asks the server for the campaign history and returns its rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'c1', title: 'New fees', body: 'From 1 Dec', tone: 'warning', recipients: 41, publishedAt: '2026-11-15T09:00:00Z' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = await load();
    const items = await svc.listAnnouncements({ limit: 10 });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.pathname.endsWith('/telemedicine/admin/announcements')).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '10' });
    expect(items[0].recipients).toBe(41);
  });

  it('sends the notice exactly as authored and returns how far it reached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'c2', title: 'Maintenance', body: 'Portal down 2am', tone: 'info', dismissible: false, recipients: 41, publishedAt: '2026-11-15T10:00:00Z' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = await load();
    const out = await svc.publishAnnouncement({
      title: 'Maintenance', body: 'Portal down 2am', tone: 'info', dismissible: false,
      ctaLabel: 'See status', ctaRoute: '/admin/telemedicine/dashboard',
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Maintenance', body: 'Portal down 2am', tone: 'info', dismissible: false,
      ctaLabel: 'See status', ctaRoute: '/admin/telemedicine/dashboard',
    });
    expect(out.recipients).toBe(41);
    expect(out.dismissible).toBe(false);
  });

  it('surfaces the server reason, and names the permission on a 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'tone must be one of info, success, warning' }),
    }));
    const svc = await load();
    await expect(svc.publishAnnouncement({ title: 'a', body: 'b', tone: 'purple' as never }))
      .rejects.toThrow('tone must be one of info, success, warning');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    const svc2 = await load();
    await expect(svc2.publishAnnouncement({ title: 'a', body: 'b', tone: 'info' }))
      .rejects.toThrow('telemedicine.admin.manage');
  });
});
