import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * Loyalty BFF catch-all → Go /api/finance/loyalty/<...>.
 *
 * The Go backend requires Idempotency-Key on every redeem (iron rule). The BFF
 * is the edge: a mutating request that omits the header gets a server-generated
 * key injected per submit, while a caller-supplied key flows through verbatim
 * (the proxy forwards it itself) so client retries collapse onto one redemption.
 */

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/feature-flags', () => ({
  featureFlags: { loyalty: vi.fn(() => true) },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/lib/go-backend', () => ({
  GO_BACKEND_URL: 'http://localhost:8080',
  proxyToGoBackend: vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { GET, POST } from '../../../app/api/v1/loyalty/[...path]/route';

const TEST_USER = { id: 'user-loy-1', email: 'loy@example.com' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function pathParams(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

type ProxyOptions = { headers?: Record<string, string> } | undefined;

function lastOptions(): ProxyOptions {
  const call = vi.mocked(proxyToGoBackend).mock.calls.at(-1);
  return call?.[2] as ProxyOptions;
}

describe('loyalty BFF route → Idempotency-Key edge injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.loyalty).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as never);
  });

  it('synthesizes an Idempotency-Key for POST /redeem when the caller omits it', async () => {
    const res = await POST(
      makeRequest('/api/v1/loyalty/redeem', { method: 'POST', body: { sku: 'AIRTIME_500' }, headers: withAuth() }),
      pathParams(['redeem']),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/loyalty/redeem',
      expect.objectContaining({ headers: { 'Idempotency-Key': expect.stringMatching(UUID_RE) } }),
    );
  });

  it('synthesizes an Idempotency-Key for POST /points/redeem when omitted', async () => {
    await POST(
      makeRequest('/api/v1/loyalty/points/redeem', { method: 'POST', body: { sku: 'AIRTIME_500' }, headers: withAuth() }),
      pathParams(['points', 'redeem']),
    );
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/loyalty/points/redeem',
      expect.objectContaining({ headers: { 'Idempotency-Key': expect.stringMatching(UUID_RE) } }),
    );
  });

  it('mints a FRESH key per submit (two submits → two keys, dedupe is the backend’s job)', async () => {
    const req = () =>
      makeRequest('/api/v1/loyalty/redeem', { method: 'POST', body: { sku: 'AIRTIME_500' }, headers: withAuth() });
    await POST(req(), pathParams(['redeem']));
    const first = lastOptions()?.headers?.['Idempotency-Key'];
    await POST(req(), pathParams(['redeem']));
    const second = lastOptions()?.headers?.['Idempotency-Key'];
    expect(first).toMatch(UUID_RE);
    expect(second).toMatch(UUID_RE);
    expect(second).not.toBe(first);
  });

  it('does NOT synthesize when the caller sends a key — it must reach Go verbatim', async () => {
    await POST(
      makeRequest('/api/v1/loyalty/redeem', {
        method: 'POST',
        body: { sku: 'AIRTIME_500' },
        headers: withAuth({ 'Idempotency-Key': 'client-retry-key-1' }),
      }),
      pathParams(['redeem']),
    );
    // No injection options — proxyToGoBackend forwards the incoming header itself.
    expect(lastOptions()).toBeUndefined();
  });

  it('does NOT synthesize on reads (GET carries no mutation to dedupe)', async () => {
    await GET(
      makeRequest('/api/v1/loyalty/me', { method: 'GET', headers: withAuth() }),
      pathParams(['me']),
    );
    expect(lastOptions()).toBeUndefined();
  });

  it('503s and never proxies when the loyalty flag is off', async () => {
    vi.mocked(featureFlags.loyalty).mockReturnValue(false);
    const res = await POST(
      makeRequest('/api/v1/loyalty/redeem', { method: 'POST', body: { sku: 'X' }, headers: withAuth() }),
      pathParams(['redeem']),
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});
