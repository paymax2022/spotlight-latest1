import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * Spray BFF route contract tests (E2E-SOC-036).
 *
 *   POST /api/v1/spray                       → Go POST /api/finance/p2p/spray
 *   *    /api/v1/spray/<...>                 → Go *    /api/finance/p2p/spray/<...>
 *
 * The Go backend mounts the shared spray engine on the P2P member group
 * (backend/internal/spray/service.go Handler.Register on /api/finance/p2p),
 * so /api/v1/spray/* must proxy under /api/finance/p2p/spray* — proxying to a
 * standalone /api/finance/spray/* upstream 404'd every call even with the
 * feature flag on.
 *
 * The BFF gate must be featureFlags.p2pMarket (FEATURE_P2P_MARKET_ENABLED) —
 * that is the env that controls whether RegisterP2PMarket (and therefore the
 * spray mount) runs on the Go side. socialPay is the WRONG flag here: it left
 * spray reachable-but-404ing when P2P was off, and needlessly 503'd when
 * social pay alone was off.
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

// Mock the proxy so tests assert the UPSTREAM PATH the route builds, without
// needing a live Go backend on GO_BACKEND_URL.
vi.mock('@/src/lib/go-backend', () => ({
  GO_BACKEND_URL: 'http://localhost:8080',
  proxyToGoBackend: vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { GET, POST as catchAllPOST } from '../../../app/api/v1/spray/[...path]/route';
import { POST as rootPOST } from '../../../app/api/v1/spray/route';

const TEST_USER = { id: 'user-spray-1', email: 'spray@example.com' };

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe('spray BFF route → Go upstream mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.socialPay).mockReturnValue(true);
    vi.mocked(featureFlags.p2pMarket).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies GET /api/v1/spray/leaderboard/<ctx> to /api/finance/p2p/spray/leaderboard/<ctx>', async () => {
    const res = await GET(
      makeRequest('/api/v1/spray/leaderboard/ctx-1', { method: 'GET', headers: withAuth() }),
      params(['leaderboard', 'ctx-1'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/spray/leaderboard/ctx-1'
    );
  });

  it('proxies nested sub-paths under /api/finance/p2p/spray/', async () => {
    await GET(
      makeRequest('/api/v1/spray/leaderboard/ctx-9/extra', { method: 'GET', headers: withAuth() }),
      params(['leaderboard', 'ctx-9', 'extra'])
    );
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/spray/leaderboard/ctx-9/extra'
    );
  });

  it('proxies POST /api/v1/spray (root send action) to /api/finance/p2p/spray', async () => {
    const res = await rootPOST(
      makeRequest('/api/v1/spray', { method: 'POST', headers: withAuth(), body: {} })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/spray'
    );
  });

  it('proxies catch-all POST /api/v1/spray/<sub> to /api/finance/p2p/spray/<sub>', async () => {
    await catchAllPOST(
      makeRequest('/api/v1/spray/resend', { method: 'POST', headers: withAuth(), body: {} }),
      params(['resend'])
    );
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/spray/resend'
    );
  });

  it('refuses 503 before auth when the p2pMarket flag is off', async () => {
    vi.mocked(featureFlags.p2pMarket).mockReturnValue(false);
    const res = await GET(
      makeRequest('/api/v1/spray/leaderboard/ctx-1', { method: 'GET' }),
      params(['leaderboard', 'ctx-1'])
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });

  it('still proxies when socialPay is off — spray is gated by the P2P mount flag', async () => {
    vi.mocked(featureFlags.socialPay).mockReturnValue(false);
    const res = await GET(
      makeRequest('/api/v1/spray/leaderboard/ctx-1', { method: 'GET', headers: withAuth() }),
      params(['leaderboard', 'ctx-1'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/p2p/spray/leaderboard/ctx-1'
    );
  });

  it('root POST also refuses 503 before auth when p2pMarket is off', async () => {
    vi.mocked(featureFlags.p2pMarket).mockReturnValue(false);
    const res = await rootPOST(
      makeRequest('/api/v1/spray', { method: 'POST', headers: withAuth(), body: {} })
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});
