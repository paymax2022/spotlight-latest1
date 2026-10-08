/**
 * WAL-012 — Paystack error message leak.
 *
 * The shared `paystackRequest()` helper in src/server/transfers/bank.ts used to
 * embed Paystack's raw JSON error body verbatim into the thrown ApiError's
 * message, which is rendered directly to end users (and, on mobile, falls
 * through errorMapper.ts's `data.error` fallback into a user-facing alert).
 *
 * Live-reproduced leak (bank-transfer resolve-account failure):
 *   429 {"error":"Paystack error 429: {\"status\":false,\"message\":\"Test mode
 *   daily limit of 3 live bank resolves exceeded. Use test bank codes 001 or
 *   upgrade to live mode.\",\"meta\":{\"nextStep\":\"Try again later\"},
 *   \"type\":\"api_error\",\"code\":\"unknown\"}"}
 *
 * These tests assert the fix: the raw provider body is logged server-side but
 * never appears in the message the caller (and ultimately the client) sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RAW_PAYSTACK_BODY = JSON.stringify({
  status: false,
  message:
    'Test mode daily limit of 3 live bank resolves exceeded. Use test bank codes 001 or upgrade to live mode.',
  meta: { nextStep: 'Try again later' },
  type: 'api_error',
  code: 'unknown',
});

describe('paystackRequest error handling (WAL-012)', () => {
  const originalKey = process.env.PAYSTACK_SECRET_KEY;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc123';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.PAYSTACK_SECRET_KEY = originalKey;
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not leak the raw Paystack error body into listBanks()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => RAW_PAYSTACK_BODY,
    } as unknown as Response));

    const { listBanks } = await import('@/src/server/transfers/bank');
    const { ApiError } = await import('@/src/lib/api/responses');

    const err = await listBanks().catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    const message = (err as InstanceType<typeof ApiError>).message;

    // The clean, user-facing message must NOT contain any raw provider detail.
    expect(message).not.toContain('api_error');
    expect(message).not.toContain('Test mode daily limit');
    expect(message).not.toContain('status');
    expect(message).not.toContain('unknown');
    expect(message).not.toContain(RAW_PAYSTACK_BODY);

    // But it must still be a real, human-readable, non-empty message.
    expect(message.length).toBeGreaterThan(0);
    expect(message).toMatch(/try again/i);

    // Status mapping preserved: 429 stays 429 (only 5xx collapses to 502).
    expect((err as InstanceType<typeof ApiError>).status).toBe(429);

    // The raw body must still be logged server-side for debugging.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedArgs = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(loggedArgs).toContain('Test mode daily limit');
  });

  it('maps a 5xx Paystack failure to 502 with the same clean message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '{"status":false,"message":"internal provider failure XYZ"}',
    } as unknown as Response));

    const { resolveBankAccount } = await import('@/src/server/transfers/bank');
    const { ApiError } = await import('@/src/lib/api/responses');

    const err = await resolveBankAccount('058', '0123456789').catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(502);
    expect((err as InstanceType<typeof ApiError>).message).not.toContain('internal provider failure XYZ');
  });

  it('rejects a malformed account number before ever calling Paystack', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { resolveBankAccount } = await import('@/src/server/transfers/bank');

    await expect(resolveBankAccount('058', '12345')).rejects.toThrow(/10 digits/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
