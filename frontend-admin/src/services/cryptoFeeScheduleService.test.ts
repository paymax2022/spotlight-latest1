// @vitest-environment node
/**
 * Fee-schedule admin client. This is PRICING configuration, so the client validates before it
 * sends, never fakes a write in fixture mode, and keys the request by what it changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CryptoFeeScheduleUpdate, CryptoFeeScheduleVersion } from '@/types/cryptoAdmin';

const VERSION: CryptoFeeScheduleVersion = {
  version: 3, major_bps: 75, other_bps: 100, majors: ['BTC', 'ETH', 'USDC', 'USDT'], overrides: { DOGE: 140 },
  reason: 'Q3 review', created_by: 'admin-1', created_at: '2026-10-01T09:00:00Z',
};
const UPDATE: CryptoFeeScheduleUpdate = {
  expected_version: 3, major_bps: 80, other_bps: 110, majors: ['btc', ' eth ', 'USDT', 'btc'], overrides: { doge: 140 }, reason: ' Q4 pricing review ',
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

async function load() {
  vi.resetModules();
  return import('@/services/cryptoAdminService');
}

describe('validateFeeScheduleUpdate', () => {
  it('accepts a normal edit and the boundaries', async () => {
    const m = await load();
    expect(m.validateFeeScheduleUpdate(UPDATE, 150)).toBeNull();
    expect(m.validateFeeScheduleUpdate({ ...UPDATE, major_bps: 0, other_bps: 150, overrides: { SHIB: 0 } }, 150)).toBeNull();
  });

  it('rejects everything the backend would, before any request is made', async () => {
    const m = await load();
    const cases: Array<[string, Partial<CryptoFeeScheduleUpdate>]> = [
      ['above the ceiling', { major_bps: 151 }],
      ['negative', { other_bps: -1 }],
      ['fractional bps (money-adjacent values are integers)', { major_bps: 75.5 }],
      ['NaN', { major_bps: Number.NaN }],
      ['override above the ceiling', { overrides: { DOGE: 151 } }],
      ['blank reason', { reason: '   ' }],
      ['reason too long', { reason: 'x'.repeat(501) }],
      ['bad asset code', { majors: ['BTC$'] }],
      ['bad override code', { overrides: { 'd o g e': 100 } }],
      ['too many majors', { majors: Array.from({ length: 51 }, (_, i) => `AB${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`) }],
      ['negative expected version', { expected_version: -1 }],
      ['fractional expected version', { expected_version: 1.5 }],
    ];
    for (const [name, patch] of cases) {
      expect(m.validateFeeScheduleUpdate({ ...UPDATE, ...patch }, 150), name).not.toBeNull();
    }
  });
});

describe('adminGetFeeSchedule', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('returns the current schedule, ceiling and history', async () => {
    vi.stubGlobal('fetch', respond(200, { success: true, current: VERSION, ceiling_bps: 150, history: [VERSION] }));
    const m = await load();
    const r = await m.adminGetFeeSchedule();
    expect(r?.current.version).toBe(3);
    expect(r?.ceiling_bps).toBe(150);
    expect(r?.history).toHaveLength(1);
  });

  it('treats a missing route (flag off) and an unwired store as "not available", not as an error', async () => {
    for (const status of [404, 503]) {
      vi.stubGlobal('fetch', respond(status, { error: 'x' }));
      const m = await load();
      expect(await m.adminGetFeeSchedule()).toBeNull();
    }
  });

  it('surfaces a real server error', async () => {
    vi.stubGlobal('fetch', respond(500, { error: 'internal_error' }));
    const m = await load();
    await expect(m.adminGetFeeSchedule()).rejects.toThrow(/internal_error/);
  });
});

describe('adminUpdateFeeSchedule', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('PUTs a normalised body with an Idempotency-Key and returns the applied version', async () => {
    const fetchMock = respond(200, { success: true, current: { ...VERSION, version: 4, major_bps: 80 }, ceiling_bps: 150 });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const applied = await m.adminUpdateFeeSchedule(UPDATE);
    expect(applied.version).toBe(4);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/admin/crypto/fee-schedule');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^admin:/);
    expect(JSON.parse(init.body)).toEqual({
      expected_version: 3, major_bps: 80, other_bps: 110, majors: ['BTC', 'ETH', 'USDT'], overrides: { DOGE: 140 }, reason: 'Q4 pricing review',
    });
  });

  it('keys the request by what it changes: same edit retries share a key, a different edit does not', async () => {
    const fetchMock = respond(200, { success: true, current: VERSION, ceiling_bps: 150 });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    await m.adminUpdateFeeSchedule(UPDATE);
    await m.adminUpdateFeeSchedule({ ...UPDATE, majors: ['USDT', 'ETH', 'BTC'] }); // same schedule, different spelling
    await m.adminUpdateFeeSchedule({ ...UPDATE, major_bps: 81 });
    await m.adminUpdateFeeSchedule({ ...UPDATE, expected_version: 4 });
    const keys = fetchMock.mock.calls.map((c) => (c[1].headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
  });

  it('does not call the network when validation fails', async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    await expect(m.adminUpdateFeeSchedule({ ...UPDATE, major_bps: 999 })).rejects.toThrow(/150|ceiling|between/i);
    await expect(m.adminUpdateFeeSchedule({ ...UPDATE, reason: '' })).rejects.toThrow(/reason/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a stale version into a typed conflict error the page can act on', async () => {
    vi.stubGlobal('fetch', respond(409, { success: false, error: 'version_conflict' }));
    const m = await load();
    const err = await m.adminUpdateFeeSchedule(UPDATE).catch((e) => e);
    expect(err).toBeInstanceOf(m.FeeScheduleConflictError);
  });

  it('reports an idempotency conflict as a plain error, not a version conflict', async () => {
    vi.stubGlobal('fetch', respond(409, { success: false, error: 'idempotency_conflict' }));
    const m = await load();
    const err = await m.adminUpdateFeeSchedule(UPDATE).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(m.FeeScheduleConflictError);
    expect(String(err.message)).toMatch(/idempotency_conflict/);
  });

  it('shows the server reason for a rejected schedule', async () => {
    vi.stubGlobal('fetch', respond(400, { success: false, error: 'invalid_fee_schedule', detail: 'markup bps out of range' }));
    const m = await load();
    await expect(m.adminUpdateFeeSchedule(UPDATE)).rejects.toThrow(/invalid_fee_schedule/);
  });

  it('refuses in fixture mode instead of pretending a price changed', async () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK', 'true');
    const fetchMock = respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    await expect(m.adminUpdateFeeSchedule(UPDATE)).rejects.toThrow(/fixture mode/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
