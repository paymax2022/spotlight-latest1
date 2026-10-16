// @vitest-environment node
/** Reconciler-status client: read-only, and "not mounted" is a state, not an error. */
import { describe, it, expect, vi, afterEach } from 'vitest';

const STATUS = {
  success: true,
  note: 'replica is the in-process state of the replica that answered',
  replica: {
    started_at: '2026-10-14T08:00:00Z', runs: 12, led_runs: 12, skipped_runs: 0,
    last_run_at: '2026-10-14T08:06:00Z', last_led_at: '2026-10-14T08:06:00Z', last_led: true, last_error: '',
    last_result: { resolved: 1, released: 0, parked: 0, expired: 2, errors: 0, clearing_negative: false },
    totals: { resolved: 3, released: 0, parked: 1, expired: 5, errors: 0, clearing_negative_runs: 0 },
    recent_alerts: [{ at: '2026-10-14T08:03:00Z', kind: 'swap_parked', message: 'swap parked' }],
  },
  backlog: [{ state: 'needs_review', count: 2, held_kobo: 3_022_500, oldest_updated_at: '2026-10-14T06:00:00Z', oldest_age_seconds: 7200 }],
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}
async function load() {
  vi.resetModules();
  return import('@/services/cryptoAdminService');
}

describe('adminGetReconcilerStatus', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('reads the replica block and the backlog from GET /admin/crypto/reconciler', async () => {
    const fetchMock = respond(200, STATUS);
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const r = await m.adminGetReconcilerStatus();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/admin/crypto/reconciler');
    expect(fetchMock.mock.calls[0][1].method ?? 'GET').toBe('GET');
    expect(r?.replica.runs).toBe(12);
    expect(r?.backlog[0].held_kobo).toBe(3_022_500);
    expect(r?.replica.recent_alerts).toHaveLength(1);
  });

  it('treats "flag off" (404) and "no reconciler on this replica" (503) as not available', async () => {
    for (const status of [404, 503]) {
      vi.stubGlobal('fetch', respond(status, { error: 'reconciler_not_running' }));
      const m = await load();
      expect(await m.adminGetReconcilerStatus()).toBeNull();
    }
  });

  it('surfaces a forbidden or server error instead of hiding it', async () => {
    for (const [status, body] of [[403, { error: 'forbidden' }], [500, { error: 'internal_error' }]] as const) {
      vi.stubGlobal('fetch', respond(status, body));
      const m = await load();
      await expect(m.adminGetReconcilerStatus()).rejects.toThrow(new RegExp(body.error));
    }
  });

  it('fills missing arrays so the page never has to guard against undefined', async () => {
    vi.stubGlobal('fetch', respond(200, { success: true, note: '', replica: { ...STATUS.replica, recent_alerts: undefined }, backlog: undefined }));
    const m = await load();
    const r = await m.adminGetReconcilerStatus();
    expect(r?.backlog).toEqual([]);
    expect(r?.replica.recent_alerts).toEqual([]);
  });

  it('returns a clearly labelled fixture only in fixture mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK', 'true');
    const fetchMock = respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const r = await m.adminGetReconcilerStatus();
    expect(r?.note).toMatch(/fixture/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
