import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

/**
 * Referral BFF route contract tests — the two referral planes and their gates.
 *
 * Go mounts the two referral surfaces independently, on the root engine:
 *
 *   /v1/referrals/*          Direct Referral Rewards ENGINE — the only thing
 *   (plural)                 behind cfg.FeatureReferralRewardsEnabled
 *                            (backend/internal/app/finance_routes.go:468)
 *                            → proxied by /api/v1/referrals/<...>
 *
 *   /api/finance/referral/*  §7A house/earning system — behind
 *   (singular)               cfg.FeatureReferralsEnabled
 *                            (finance_routes.go:438)
 *                            → proxied by /api/v1/referral/<...>
 *
 * The plural proxy gated on featureFlags.referrals, i.e. the §7A flag, so an
 * environment that runs the rewards engine without §7A answered 503 on the Earn
 * hub while its upstream was healthy — the same class as E2E-SOC-036 (p2p gated
 * on socialPay). Each proxy must track its own mount.
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
  featureFlags: { referrals: vi.fn(() => true), referralRewards: vi.fn(() => true) },
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
import * as rewardsProxy from '../../../app/api/v1/referrals/[...path]/route';
import * as houseProxy from '../../../app/api/v1/referral/[...path]/route';

const TEST_USER = { id: 'user-referral-1', email: 'referral@example.com' };

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe('/api/v1/referrals/<sub> → Go /v1/referrals/<sub> (rewards engine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.referrals).mockReturnValue(true);
    vi.mocked(featureFlags.referralRewards).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies the Earn hub dashboard to the engine mount', async () => {
    const res = await rewardsProxy.GET(
      makeRequest('/api/v1/referrals/me/dashboard', { method: 'GET', headers: withAuth() }),
      params(['me', 'dashboard'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/v1/referrals/me/dashboard'
    );
  });

  it('refuses 503 before auth when the rewards engine flag is off', async () => {
    vi.mocked(featureFlags.referralRewards).mockReturnValue(false);
    const res = await rewardsProxy.GET(
      makeRequest('/api/v1/referrals/me/dashboard', { method: 'GET' }),
      params(['me', 'dashboard'])
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });

  it('still proxies when the §7A flag is off — the engine mount does not depend on it', async () => {
    vi.mocked(featureFlags.referrals).mockReturnValue(false);
    const res = await rewardsProxy.GET(
      makeRequest('/api/v1/referrals/me/earnings', { method: 'GET', headers: withAuth() }),
      params(['me', 'earnings'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/v1/referrals/me/earnings'
    );
  });
});

describe('/api/v1/referral/<sub> → Go /api/finance/referral/<sub> (§7A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.referrals).mockReturnValue(true);
    vi.mocked(featureFlags.referralRewards).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER as any);
  });

  it('proxies my-rewards to the §7A mount', async () => {
    const res = await houseProxy.GET(
      makeRequest('/api/v1/referral/my-rewards', { method: 'GET', headers: withAuth() }),
      params(['my-rewards'])
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(proxyToGoBackend)).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/referral/my-rewards'
    );
  });

  it('refuses 503 when the §7A flag is off, even with the engine running', async () => {
    vi.mocked(featureFlags.referrals).mockReturnValue(false);
    const res = await houseProxy.GET(
      makeRequest('/api/v1/referral/my-rewards', { method: 'GET' }),
      params(['my-rewards'])
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(proxyToGoBackend)).not.toHaveBeenCalled();
  });
});
