// @vitest-environment node
/**
 * The referral Overview is assembled from several endpoints, each of which wraps
 * its body under its own key ({k_factor}, {cac}, {reward_to_ltv}, {budgets},
 * {dashboard}). Getting an unwrap wrong shows a figure as "not available" with no
 * error, so the mapping is pinned here. A source that fails must be named, not
 * silently dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BODIES: Record<string, unknown> = {
  '/analytics/k-factor': { k_factor: { referrers: 10, referred_signups: 25, house_signups: 4, k_factor: 2.5 } },
  '/analytics/cac': { cac: { referral_spend_kobo: 500000, referred_signups: 25, referral_cac_kobo: 20000, paid_cac_kobo: 0 } },
  '/finance/reward-to-ltv': { reward_to_ltv: { reward_spent_kobo: 500000, referred_ltv_kobo: 900000, ratio_bps: 18000 } },
  '/finance/budgets': {
    budgets: [
      { scope: 'campaign', budget_kobo: 100, spent_kobo: 1, active: true },
      { scope: 'global', budget_kobo: 9000000, spent_kobo: 500000, active: true },
    ],
  },
  '/risk/dashboard': { dashboard: { open_alerts: 3, open_cases: 1, queued_reviews: 0, active_blocks: 2 } },
};

describe('getReferralDashboardFigures', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_REFERRAL_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('unwraps each endpoint and maps the figures the Overview shows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = Object.keys(BODIES).find((p) => url.endsWith(p));
      if (!path) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => BODIES[path] };
    }));
    const { getReferralDashboardFigures } = await import('./referralAdminService');
    const f = await getReferralDashboardFigures();

    expect(f.kFactor).toBe(2.5);
    expect(f.referrers).toBe(10);
    expect(f.referredSignups).toBe(25);
    expect(f.houseSignups).toBe(4);
    expect(f.referralCacKobo).toBe(20000);
    expect(f.paidCacKobo).toBe(0);
    expect(f.rewardSpentKobo).toBe(500000);
    expect(f.rewardToLtv).toBeCloseTo(1.8);
    // Only the GLOBAL active budget counts; campaign budgets are not summed in.
    expect(f.globalBudgetKobo).toBe(9000000);
    expect(f.openAlerts).toBe(3);
    expect(f.activeBlocks).toBe(2);
    expect(f.failedSources).toEqual([]);
  });

  it('names each source that fails and leaves only that figure absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/analytics/cac')) return { ok: false, status: 404, json: async () => ({}) };
      const path = Object.keys(BODIES).find((p) => url.endsWith(p));
      return { ok: true, status: 200, json: async () => BODIES[path as string] };
    }));
    const { getReferralDashboardFigures } = await import('./referralAdminService');
    const f = await getReferralDashboardFigures();

    expect(f.failedSources).toEqual(['CAC']);
    expect(f.referralCacKobo).toBeNull();
    expect(f.kFactor).toBe(2.5);
    expect(f.rewardSpentKobo).toBe(500000);
  });

  it('reports no global budget when none is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/finance/budgets')) return { ok: true, status: 200, json: async () => ({ budgets: [] }) };
      const path = Object.keys(BODIES).find((p) => url.endsWith(p));
      return { ok: true, status: 200, json: async () => BODIES[path as string] };
    }));
    const { getReferralDashboardFigures } = await import('./referralAdminService');
    const f = await getReferralDashboardFigures();
    expect(f.globalBudgetKobo).toBeNull();
  });
});
