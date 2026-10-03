import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * P2P BFF route contract tests (E2E-SOC-036, same class as spray).
 *
 *   *    /api/v1/p2p/<...>                   → Go *    /api/finance/p2p/<...>
 *
 * Go mounts the whole P2P surface (listings, escrow, disputes, AND the spray
 * engine) inside RegisterP2PMarket under FEATURE_P2P_MARKET_ENABLED
 * (backend/internal/app/finance_routes.go:631). The BFF gate must therefore be
 * featureFlags.p2pMarket — it previously checked socialPay, which 503'd the
 * route whenever social pay alone was off even though the upstream mount was
 * healthy.
 *
 * Canonical upstream is /api/finance/p2p/<sub>: RegisterP2PMarket now receives
 * the bare finance group and p2pmarket.Handler.Register supplies the "/p2p"
 * prefix itself. The earlier /api/finance/p2p/p2p/* double-mount is fixed
 * (E2E-SOC-036).
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
  featureFlags: { socialPay: vi.fn(() => true), p2pMarket: vi.fn(() => true) },
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
import { GET, POST } from '../../../app/api/v1/p2p/[...path]/route';

const TEST_USER = { id: 'user-p2p-1', email: 'p2p@example.com' };

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe('p2p BFF route → Go upstream mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.socialPay).mockReturnValue(true);
    vi.mocked(featureFlags.p2pMarket).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies GET /api/v1/p2p/<sub> to /api/finance/p2p/<sub> (canonical mount)', async () => {
    const res = await GET(
      makeRequest('/api/v1/p2p/listings', { method: 'GET', headers: withAuth() }),
      params(['listings'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/listings'
    );
  });

  it('proxies POST /api/v1/p2p/<nested> to /api/finance/p2p/<nested>', async () => {
    await POST(
      makeRequest('/api/v1/p2p/orders/o-1/confirm', { method: 'POST', headers: withAuth(), body: {} }),
      params(['orders', 'o-1', 'confirm'])
    );
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/orders/o-1/confirm'
    );
  });

  it('refuses 503 before auth when the p2pMarket flag is off', async () => {
    vi.mocked(featureFlags.p2pMarket).mockReturnValue(false);
    const res = await GET(
      makeRequest('/api/v1/p2p/listings', { method: 'GET' }),
      params(['listings'])
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });

  it('still proxies when socialPay is off — the mount lives under the P2P flag', async () => {
    vi.mocked(featureFlags.socialPay).mockReturnValue(false);
    const res = await GET(
      makeRequest('/api/v1/p2p/listings', { method: 'GET', headers: withAuth() }),
      params(['listings'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/listings'
    );
  });
});
