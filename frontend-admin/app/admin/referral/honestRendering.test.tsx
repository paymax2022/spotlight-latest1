/** @vitest-environment jsdom */
// Honest rendering for the referral surfaces re-pointed at the routes Go actually
// registers (src/services/referralRouteRemap.test.ts pins the request side).
//
// Two crash classes are covered here:
//  1. a field the endpoint does not answer must render NOT_REPORTED, never
//     "Invalid Date", NaN or a fabricated 0 on a money / growth screen;
//  2. a surface with no admin route at all must refuse ONLY itself — a sibling
//     loader that throws may not blank the whole page (that is what produced the
//     "This page couldn't load" boundary on /admin/referral/*).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NOT_REPORTED } from './_ui';

const api = vi.hoisted(() => ({
  listRewardLedger: vi.fn(),
  getProgramConfig: vi.fn(),
  getReferralRoles: vi.fn(),
  getFeatureFlags: vi.fn(),
  getReferralAudit: vi.fn(),
  listMissionsAdmin: vi.fn(),
  listRanksAdmin: vi.fn(),
  listLeaderboards: vi.fn(),
  listContests: vi.fn(),
  getAnalytics: vi.fn(),
}));

vi.mock('@/services/referralAdminService', async () => {
  const actual = await vi.importActual<typeof import('@/services/referralAdminService')>('@/services/referralAdminService');
  return {
    ...actual,
    listRewardLedger: api.listRewardLedger,
    getProgramConfig: api.getProgramConfig,
    getReferralRoles: api.getReferralRoles,
    getFeatureFlags: api.getFeatureFlags,
    getReferralAudit: api.getReferralAudit,
  };
});

vi.mock('@/services/referralAdminOpsService', async () => {
  const actual = await vi.importActual<typeof import('@/services/referralAdminOpsService')>('@/services/referralAdminOpsService');
  return {
    ...actual,
    listMissionsAdmin: api.listMissionsAdmin,
    listRanksAdmin: api.listRanksAdmin,
    listLeaderboards: api.listLeaderboards,
    listContests: api.listContests,
    getAnalytics: api.getAnalytics,
  };
});

import RewardLedgerPage from './rewards/page';
import RanksAdminPage from './gamification/ranks/page';
import LeaderboardsAdminPage from './gamification/leaderboards/page';
import GamificationOverviewPage from './gamification/page';
import AnalyticsOverviewPage from './analytics/page';
import ReferralConfigPage from './config/page';

const REFUSAL = 'has no backend yet — nothing was sent.';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

afterEach(() => cleanup());

describe('referral pages render what the routes actually answer', () => {
  it('rewards: a ledger row with no updated_at renders a dash, not NaN', async () => {
    api.listRewardLedger.mockResolvedValue([
      {
        id: 'rwd_1', beneficiary_id: 'usr_a1', kind: 'referrer', state: 'eligible',
        amount_kobo: 200_000, currency: 'NGN', is_house: false,
        excluded_from_override: false, excluded_from_kfactor: false,
      },
    ]);
    render(<RewardLedgerPage />);
    await screen.findByText('rwd_1');
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText(NOT_REPORTED)).toBeTruthy();
  });

  it('gamification overview: the leaderboard refusal does not blank missions or contests', async () => {
    api.listMissionsAdmin.mockResolvedValue([
      { id: 'msn_1', name: 'Refer three friends', condition: 'refer 3 KYC users', points_reward: 50 },
    ]);
    api.listRanksAdmin.mockResolvedValue([{ id: 'rnk_1', name: 'Bronze', threshold_points: 100 }]);
    api.listContests.mockResolvedValue([
      { id: 'cts_1', name: 'Ramadan sprint', status: 'active', starts_at: new Date(Date.now() - 86_400_000).toISOString() },
    ]);
    api.listLeaderboards.mockRejectedValue(new Error(REFUSAL));
    render(<GamificationOverviewPage />);

    // The missions the admin route DOES serve stay on screen.
    await screen.findByText('Refer three friends');
    // Completions/participants are not counted by gamification.Mission.
    expect(screen.getAllByText(NOT_REPORTED).length).toBeGreaterThan(0);
    // The refused surface is named, and the KPI is a dash rather than a fake 0.
    expect(screen.getByText(/no backend/i)).toBeTruthy();
    // Operators read the sentence the service wrote, not `String(error)`.
    expect(screen.queryByText(/^Error: /)).toBeNull();
    const leaderboardsKpi = screen.getByText('Leaderboards').parentElement as HTMLElement;
    expect(leaderboardsKpi.textContent).toContain(NOT_REPORTED);
    expect(leaderboardsKpi.textContent).not.toMatch(/^Leaderboards0/);
  });

  it('ranks: badge and holders the route never returns render as dashes', async () => {
    api.listRanksAdmin.mockResolvedValue([{ id: 'rnk_1', name: 'Bronze', threshold_points: 1000 }]);
    render(<RanksAdminPage />);
    await screen.findByText('Bronze');
    expect(screen.getAllByText(NOT_REPORTED).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it('leaderboards page: contests render while the missing admin route is surfaced as a note', async () => {
    api.listLeaderboards.mockRejectedValue(new Error(REFUSAL));
    api.listContests.mockResolvedValue([{ id: 'cts_9', name: 'Founder sprint', status: 'scheduled' }]);
    render(<LeaderboardsAdminPage />);
    await screen.findByText('Founder sprint');
    expect(screen.getByText(/no backend/i)).toBeTruthy();
  });

  it('analytics: absent KPIs render as dashes and no empty chart is drawn', async () => {
    api.getAnalytics.mockResolvedValue({
      k_factor: 0.42, referrers: 100, referred_signups: 42, house_signups: 7,
      referral_cac_kobo: 1_500_000,
    });
    render(<AnalyticsOverviewPage />);
    await screen.findByText('0.42');
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText('0.0%')).toBeNull();
    expect(screen.getAllByText(NOT_REPORTED).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/last 14 days/i)).toBeNull();
  });

  it('config: the program tab renders while roles/flags/audit refuse', async () => {
    api.getProgramConfig.mockResolvedValue({ welcome_reward_enabled: true });
    api.getReferralRoles.mockRejectedValue(new Error(REFUSAL));
    api.getFeatureFlags.mockRejectedValue(new Error(REFUSAL));
    api.getReferralAudit.mockRejectedValue(new Error(REFUSAL));
    render(<ReferralConfigPage />);
    await screen.findByText('Welcome reward');
    expect(screen.getAllByText(NOT_REPORTED).length).toBeGreaterThanOrEqual(4);
    // The caps table has no rows because /config has no tier caps — say so, do not
    // print an empty table that reads as "caps are switched off".
    fireEvent.click(screen.getByText(/RBAC & permissions/i));
    expect(screen.getByText(/no backend/i)).toBeTruthy();
  });
});
