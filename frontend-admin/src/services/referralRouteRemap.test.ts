// @vitest-environment node
/**
 * Four referral admin pages reported "Error: Request failed (404)" in production
 * for one reason: the console asks the Go service for routes it never registers.
 *
 * Each pair below is the path the client used to spell and the path
 * backend/internal/referral actually mounts (verified against the registrations,
 * not the type names):
 *
 *   rewards      GET /api/referral/admin/rewards      → /ledger      {entries}
 *                (ledger.Handler.AdminList, referral_routes.go:155)
 *   gamification GET …/gamification/{missions,ranks,contests}
 *                — right paths, but named envelopes ({missions}, {ranks},
 *                {contests}) that the pages' `!rows || rows.length === 0` guard
 *                treats as a non-empty array and then crashes on .map
 *                (gamification/handlers.go:41-45)
 *   analytics    GET …/analytics                      → /analytics/{k-factor,cac}
 *                (analytics/service.go:142-148 — six leaf routes, no aggregate)
 *   config       GET …/config/program                 → /config
 *                (referral_routes.go:143, and it answers the attribution-shaped
 *                referralconfig.Config, not a ProgramConfig)
 *
 * Where the backend truly has nothing — /gamification/leaderboards,
 * /config/{rbac,flags,audit}, a single reward entry, manual grant — the client
 * now refuses with what is missing instead of forwarding a 404 or, worse,
 * reporting the click as a success. Absent metrics stay absent: the pages render
 * an em-dash, because a 0.00 K-factor or an empty trend chart on a growth screen
 * is a claim the route never made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const json = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

/** ledger.Entry (ledger/service.go:97) — no timestamps, no campaign, no idempotency key. */
const ledgerEntry = {
  id: 'rl_1', beneficiary_id: 'usr_ref', referred_user_id: 'usr_new',
  kind: 'cash', state: 'eligible', amount_kobo: 50_000, currency: 'NGN',
  is_house: false, excluded_from_override: false, excluded_from_kfactor: false,
};

/** gamification.Mission (service.go:186) — title/description/is_active, no counters. */
const missionWire = {
  id: 'ms_1', slug: 'invite-five', title: 'Invite five friends',
  description: 'refer 5 KYC-verified users', mission_type: 'referral',
  target_count: 5, points_reward: 250, cash_reward_kobo: 0,
  is_active: true, starts_at: '2026-11-01T00:00:00Z',
};

/** gamification.Rank (service.go:212) and .Contest (service.go:242). */
const rankWire = { id: 'rk_1', slug: 'bronze', name: 'Bronze', tier_order: 1, min_points: 0, perks: { badge: true } };
const contestWire = {
  id: 'ct_1', slug: 'dec-sprint', title: 'December sprint', status: 'active',
  starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-31T00:00:00Z',
  prize_config: { pool_kobo: 5_000_000 },
};

/** referralconfig.Config (config/service.go:18) — the singleton referral_config row. */
const configWire = {
  attribution_window_hours: 72, grace_window_hours: 72,
  fallback_chain: ['code', 'deeplink', 'context', 'regional_house', 'global_house'],
  house_account_code: 'SPOT-HOUSE', budget_neutral: true, welcome_reward_enabled: true,
};

const urls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]));

describe('referral admin routes the console used to invent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_REFERRAL_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ── Rewards & Ledger (/admin/referral/rewards) ────────────────────────────
  it('listRewardLedger reads /ledger, the route that exists, and unwraps {entries}', async () => {
    const fetchFn = vi.fn(async () => json({ entries: [ledgerEntry] }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    const rows = await mod.listRewardLedger();

    expect(urls(fetchFn)[0]).toMatch(/\/api\/referral\/admin\/ledger$/);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('rl_1');
    expect(rows[0].amount_kobo).toBe(50_000);
  });

  it('state and kind filters narrow rows the route has already returned', async () => {
    // AdminList takes only ?beneficiary=, so a state= or kind= query would be
    // silently ignored by Go while the page's dropdown looked like it worked.
    vi.stubGlobal('fetch', vi.fn(async () => json({
      entries: [ledgerEntry, { ...ledgerEntry, id: 'rl_2', state: 'paid' }, { ...ledgerEntry, id: 'rl_3', kind: 'points' }],
    })));
    const mod = await import('./referralAdminService');

    const rows = await mod.listRewardLedger({ state: 'paid' });

    expect(rows.map((r) => r.id)).toEqual(['rl_2']);
  });

  it('keeps the ledger timestamps absent instead of inventing them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ entries: [ledgerEntry] })));
    const mod = await import('./referralAdminService');

    const [row] = await mod.listRewardLedger();

    expect(row.updated_at ?? null).toBeNull();
    expect(row.created_at ?? null).toBeNull();
  });

  it('getRewardEntry refuses: no single-entry route is registered', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    await expect(mod.getRewardEntry('rl_1')).rejects.toThrow(/has no backend yet/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('manualGrant refuses rather than POSTing to /rewards/grant and reporting success', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    await expect(mod.manualGrant({ beneficiary_id: 'usr_ref', amount_kobo: 5_000, kind: 'cash', reason: 'goodwill' }))
      .rejects.toThrow(/has no backend yet/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Gamification (/admin/referral/gamification) ───────────────────────────
  it('listMissionsAdmin unwraps {missions} and maps title/description/is_active onto what the page reads', async () => {
    const fetchFn = vi.fn(async () => json({ missions: [missionWire] }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    const [m] = await mod.listMissionsAdmin();

    expect(urls(fetchFn)[0]).toMatch(/\/gamification\/missions$/);
    expect(m.name).toBe('Invite five friends');
    expect(m.condition).toBe('refer 5 KYC-verified users');
    expect(m.status).toBe('active');
    // No admin route counts participants or completions; a 0 would read as
    // "nobody has completed this".
    expect(m.participants ?? null).toBeNull();
    expect(m.completions ?? null).toBeNull();
  });

  it('an inactive mission is not reported as ended', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ missions: [{ ...missionWire, is_active: false }] })));
    const mod = await import('./referralAdminOpsService');

    const [m] = await mod.listMissionsAdmin();

    // is_active is the only lifecycle field Go answers; draft and ended are
    // indistinguishable in it, so the console leaves status unclaimed.
    expect(m.status ?? null).toBeNull();
  });

  it('listRanksAdmin unwraps {ranks} and maps min_points onto threshold_points', async () => {
    const fetchFn = vi.fn(async () => json({ ranks: [rankWire] }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    const [r] = await mod.listRanksAdmin();

    expect(urls(fetchFn)[0]).toMatch(/\/gamification\/ranks$/);
    expect(r.name).toBe('Bronze');
    expect(r.threshold_points).toBe(0);
    expect(r.holders ?? null).toBeNull();
    // Rank.Perks is map[string]any on the row (service.go:212) — the console
    // shows what the route answered instead of an empty Perks column.
    expect(r.perks).toBe('badge: true');
  });

  it('listContests unwraps {contests} and takes name from title', async () => {
    const fetchFn = vi.fn(async () => json({ contests: [contestWire] }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    const [c] = await mod.listContests();

    expect(urls(fetchFn)[0]).toMatch(/\/gamification\/contests$/);
    expect(c.name).toBe('December sprint');
    expect(c.ends_at).toBe('2026-12-31T00:00:00Z');
    expect(c.participants ?? null).toBeNull();
    // Contest.PrizeConfig is map[string]any (service.go:242) — the Prize column
    // shows the pool the row defines rather than an empty cell.
    expect(c.prize).toBe('pool_kobo: 5000000');
  });

  it('listLeaderboards refuses: the admin group registers no leaderboard route', async () => {
    // Only the MEMBER group has GET /gamification/leaderboard
    // (gamification/handlers.go:36); /gamification/leaderboards was invented,
    // so the KPI counted a fixture array that never came from anywhere.
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    await expect(mod.listLeaderboards()).rejects.toThrow(/has no backend yet/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Analytics (/admin/referral/analytics) ─────────────────────────────────
  it('getAnalytics composes the two leaf routes that answer K-factor and CAC', async () => {
    const fetchFn = vi.fn(async (url: string) => (
      url.endsWith('/analytics/k-factor')
        ? json({ k_factor: { referrers: 400, referred_signups: 1200, house_signups: 80, k_factor: 3 } })
        : json({ cac: { referral_spend_kobo: 18_500_000, referred_signups: 1200, referral_cac_kobo: 15_416, paid_cac_kobo: 42_000 } })
    ));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminOpsService');

    const d = await mod.getAnalytics();

    const called = urls(fetchFn);
    expect(called).toHaveLength(2);
    expect(called.some((u) => /\/analytics\/k-factor$/.test(u))).toBe(true);
    expect(called.some((u) => /\/analytics\/cac$/.test(u))).toBe(true);
    // The bare aggregate that used to be asked for is not a route.
    expect(called.some((u) => /\/analytics$/.test(u))).toBe(false);
    expect(d.k_factor).toBe(3);
    expect(d.referral_cac_kobo).toBe(15_416);
    expect(d.paid_cac_kobo).toBe(42_000);
  });

  it('leaves the metrics no analytics route computes absent, rather than zeroed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url.endsWith('/analytics/k-factor')
        ? json({ k_factor: { referrers: 0, referred_signups: 0, house_signups: 0, k_factor: 0 } })
        : json({ cac: { referral_spend_kobo: 0, referred_signups: 0, referral_cac_kobo: 0, paid_cac_kobo: 0 } })
    )));
    const mod = await import('./referralAdminOpsService');

    const d = await mod.getAnalytics();

    // share_rate / invite-accept / blended CAC / the 14-day trend have no
    // source in analytics.Handler; an empty trend array also used to divide by
    // zero in the chart's max, which is the crash these pages showed.
    expect(d.share_rate ?? null).toBeNull();
    expect(d.invite_accept_rate ?? null).toBeNull();
    expect(d.blended_cac_kobo ?? null).toBeNull();
    expect(d.trend ?? null).toBeNull();
    expect(d.k_factor_incl_house ?? null).toBeNull();
  });

  // ── Config (/admin/referral/config) ───────────────────────────────────────
  it('getProgramConfig reads GET /config', async () => {
    const fetchFn = vi.fn(async () => json(configWire));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    const cfg = await mod.getProgramConfig();

    expect(urls(fetchFn)[0]).toMatch(/\/api\/referral\/admin\/config$/);
    expect(cfg.welcome_reward_enabled).toBe(true);
  });

  it('drops the program fields the config row does not carry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(configWire)));
    const mod = await import('./referralAdminService');

    const cfg = await mod.getProgramConfig();

    // program_enabled, default_tier, tiers, qualifying_action,
    // reward_to_ltv_cap_pct and updated_at are not in referralconfig.Config, so
    // the tab renders them as not reported instead of a fabricated "Enabled".
    expect(cfg.program_enabled ?? null).toBeNull();
    expect(cfg.default_tier ?? null).toBeNull();
    expect(cfg.tiers ?? null).toBeNull();
    expect(cfg.qualifying_action ?? null).toBeNull();
    expect(cfg.updated_at ?? null).toBeNull();
  });

  it('getAttributionConfig reads the same GET /config row', async () => {
    const fetchFn = vi.fn(async () => json(configWire));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    const cfg = await mod.getAttributionConfig();

    expect(urls(fetchFn)[0]).toMatch(/\/api\/referral\/admin\/config$/);
    expect(cfg.attribution_window_hours).toBe(72);
    expect(cfg.fallback_chain.map((f) => f.tier)).toEqual(['code', 'deeplink', 'context', 'regional_house', 'global_house']);
    expect(cfg.budget_neutral).toBe(true);
    expect(cfg.self_referral_blocked ?? null).toBeNull();
  });

  it('the RBAC, flags and audit tabs refuse instead of 404-ing the whole page', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('./referralAdminService');

    await expect(mod.getReferralRoles()).rejects.toThrow(/has no backend yet/i);
    await expect(mod.getFeatureFlags()).rejects.toThrow(/has no backend yet/i);
    await expect(mod.getReferralAudit()).rejects.toThrow(/has no backend yet/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
