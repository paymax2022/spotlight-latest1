// @vitest-environment node
/**
 * The referral finance budget page was calling GET /finance/budget, which the
 * backend does not serve (the list is /finance/budgets). The page now builds its
 * BudgetBurn from the budgets list and reward-to-LTV. These tests pin that
 * mapping: only ACTIVE budgets count, the program totals come from the GLOBAL
 * budget, and anything the backend cannot supply stays null rather than a guess.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BUDGETS = {
  budgets: [
    { scope: 'global', budget_kobo: 9000000, spent_kobo: 4500000, active: true, alert_triggered: false },
    { scope: 'campaign', scope_ref: 'camp_1', budget_kobo: 1000000, spent_kobo: 1000000, active: true, alert_triggered: true },
    { scope: 'campaign', scope_ref: 'camp_old', budget_kobo: 500, spent_kobo: 1, active: false, alert_triggered: false },
  ],
};
const LTV = { reward_to_ltv: { reward_spent_kobo: 4500000, referred_ltv_kobo: 9000000, ratio_bps: 2000 } };

describe('getBudgetBurn', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_REFERRAL_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('builds the page shape from the active budgets and reward-to-LTV', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/finance/budgets') ? BUDGETS : LTV),
    })));
    const { getBudgetBurn } = await import('./referralAdminOpsService');
    const b = await getBudgetBurn();

    expect(b.program_budget_kobo).toBe(9000000);
    expect(b.program_spent_kobo).toBe(4500000);
    expect(b.reward_to_ltv_ratio).toBeCloseTo(0.2);
    // Inactive budgets are not shown.
    expect(b.lines.map((l) => l.scope)).toEqual(['global', 'campaign: camp_1']);
    // A line that has spent its whole budget is a breach, even without the flag.
    expect(b.lines[1].alert).toBe('breach');
    expect(b.lines[0].alert).toBe('ok');
    // Not supplied by the backend, so not invented.
    expect(b.lines[0].burn_rate_kobo_per_day).toBeNull();
    expect(b.lines[0].projected_exhaust_date).toBeNull();
    expect(b.reward_to_ltv_cap_pct).toBeNull();
    expect(b.trend).toEqual([]);
  });

  it('reports no program budget when no global budget is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/finance/budgets') ? { budgets: [] } : LTV),
    })));
    const { getBudgetBurn } = await import('./referralAdminOpsService');
    const b = await getBudgetBurn();
    expect(b.program_budget_kobo).toBeNull();
    expect(b.program_spent_kobo).toBeNull();
    expect(b.lines).toEqual([]);
  });
});
