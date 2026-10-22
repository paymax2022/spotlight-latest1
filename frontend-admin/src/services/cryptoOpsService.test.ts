// @vitest-environment node
/**
 * Crypto controls client. Safety configuration: validated before sending, never faked in
 * fixture mode, keyed by content so a double-click dedupes and a different change never
 * reuses a key, and a stale version surfaces as a conflict the page can reload on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CryptoControlsUpdate } from '@/types/cryptoAdmin';

const CEIL = 1_000_000_000_00;
const UPDATE: CryptoControlsUpdate = {
  expected_version: 2, trading_paused: true, withdrawals_paused: false, disabled_assets: ['doge', ' btc ', 'DOGE'],
  max_quote_kobo: 50_000_000, banner: { message: '  Trading is paused for maintenance.  ', severity: 'warning' }, reason: ' provider incident ',
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}
async function load() {
  vi.resetModules();
  return import('@/services/cryptoOpsService');
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('validateControlsUpdate', () => {
  it('accepts a normal change and the boundaries', async () => {
    const m = await load();
    expect(m.validateControlsUpdate(UPDATE, CEIL)).toBeNull();
    expect(m.validateControlsUpdate({ ...UPDATE, max_quote_kobo: 0, banner: null, disabled_assets: [] }, CEIL)).toBeNull();
    expect(m.validateControlsUpdate({ ...UPDATE, max_quote_kobo: CEIL }, CEIL)).toBeNull();
  });
  it('rejects what the backend would', async () => {
    const m = await load();
    const cases: Array<Partial<CryptoControlsUpdate>> = [
      { max_quote_kobo: -1 }, { max_quote_kobo: CEIL + 1 }, { max_quote_kobo: 1.5 },
      { disabled_assets: ['BTC!'] }, { disabled_assets: ['ngn'] },
      { banner: { message: ' ', severity: 'info' } }, { banner: { message: 'x'.repeat(281), severity: 'info' } },
      { banner: { message: 'hi', severity: 'panic' as never } },
      { reason: '  ' }, { reason: 'x'.repeat(501) }, { expected_version: -1 },
    ];
    for (const c of cases) expect(m.validateControlsUpdate({ ...UPDATE, ...c }, CEIL), JSON.stringify(c)).not.toBeNull();
  });
});

describe('updateControls', () => {
  it('sends a normalised body with a content-derived idempotency key', async () => {
    const fetchMock = respond(200, { success: true, created: true, current: { version: 3 } });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const out = await m.updateControls(UPDATE, CEIL);
    expect(out.current.version).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/crypto\/controls$/);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body.disabled_assets).toEqual(['BTC', 'DOGE']);
    expect(body.reason).toBe('provider incident');
    expect(body.banner.message).toBe('Trading is paused for maintenance.');
    const key = init.headers['Idempotency-Key'];
    expect(key).toMatch(/^admin:crypto:controls:2:/);
    expect(key).toMatch(/^[A-Za-z0-9._:-]{1,255}$/); // what the backend accepts

    await m.updateControls(UPDATE, CEIL);
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe(key); // a retry dedupes
    await m.updateControls({ ...UPDATE, trading_paused: false }, CEIL);
    expect(fetchMock.mock.calls[2][1].headers['Idempotency-Key']).not.toBe(key); // a different change never reuses it
  });

  it('turns a stale version into ControlsConflictError', async () => {
    vi.stubGlobal('fetch', respond(409, { success: false, error: 'version_conflict' }));
    const m = await load();
    await expect(m.updateControls(UPDATE, CEIL)).rejects.toBeInstanceOf(m.ControlsConflictError);
  });

  it('never sends an invalid change and never fakes one in fixture mode', async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    await expect(m.updateControls({ ...UPDATE, reason: '' }, CEIL)).rejects.toThrow(/reason/);
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK', 'true');
    const fixture = await load();
    await expect(fixture.updateControls(UPDATE, CEIL)).rejects.toThrow(/fixture mode/);
    await expect(fixture.runReconciler()).rejects.toThrow(/fixture mode/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reads', () => {
  it('maps unmounted routes to null rather than an empty healthy answer', async () => {
    vi.stubGlobal('fetch', respond(503, { error: 'x' }));
    const m = await load();
    expect(await m.getProviderHealth()).toBeNull();
    expect(await m.searchAudit({})).toBeNull();
    expect(await m.listDeposits()).toBeNull();
  });
  it('passes only non-empty audit filters', async () => {
    const fetchMock = respond(200, { entries: [], next_before: '2026-10-22T00:00:00Z' });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const page = await m.searchAudit({ action: 'crypto.controls', actor: ' ', limit: 50 });
    expect(page?.next_before).toBe('2026-10-22T00:00:00Z');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('action=crypto.controls');
    expect(url).toContain('limit=50');
    expect(url).not.toContain('actor=');
  });
});
