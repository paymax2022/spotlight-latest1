import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('referralRewardsAdminService live URLs', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_REFERRAL_REWARDS_USE_MOCK = 'false';
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_REFERRAL_REWARDS_USE_MOCK;
    vi.unstubAllGlobals();
  });

  it('calls the Go mount /v1/admin/referrals through the admin proxy, not /api/v1/...', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/referralRewardsAdminService');

    await mod.getFraudQueue();

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/admin-proxy/v1/admin/referrals/fraud-queue');
    expect(url).not.toContain('/api/v1/admin/referrals');
  });
});
