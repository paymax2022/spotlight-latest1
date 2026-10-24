// Live path hits the Direct Rewards engine; the mock path (USE_MOCK, off unless
// EXPO_PUBLIC_REFERRAL_USE_MOCK=true and never in a deployed build) serves fixtures.
// Money is ALWAYS integer kobo. Earnings tie to friends' verified activity (§7).
// The mapping of engine payloads onto screen data lives in homeMap.ts (unit-tested).

import { homeCounts } from './counts';
import { api } from '@/api/client';
import { USE_MOCK } from '../constants/referral.constants';
import { buildActivity, mapMilestone, mapSnapshot } from './homeMap';
import type { EngineDashboard, EngineEarning, EngineReferral, EngineRewards } from './engine';
import type {
  DashboardSummary,
  EarningsSnapshot,
  MyCode,
  ActivityItem,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// The home/* endpoints under REFERRAL_API_BASE do not exist. The live branches
// below source from the fully-live Direct Rewards engine at /api/v1/referrals
// (note the trailing 's'), which returns BARE snake_case JSON.
const REWARDS_ENGINE_BASE = '/api/v1/referrals';

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const MOCK_SNAPSHOT: EarningsSnapshot = {
  eligibleKobo: 150_000, // ₦1,500 ready to withdraw
  pendingKobo: 50_000, // ₦500 awaiting qualifying action
  vestingKobo: 100_000, // ₦1,000 vesting over 30/60/90d
  paidKobo: 200_000, // ₦2,000 already paid to wallet
  clawedBackKobo: 50_000, // ₦500 reversed (invalid referral)
  lifetimeEarnedKobo: 500_000, // ₦5,000 gross earned
  currency: 'NGN',
};

const MOCK_SUMMARY: DashboardSummary = {
  snapshot: MOCK_SNAPSHOT,
  snapshotUnavailable: false,
  nextMilestone: { threshold: 10, bonusKobo: 500_000, remaining: 6 },
  invitesSent: 14,
  signups: 6,
  activated: 4,
  rank: 23,
  rankTotal: 1840,
  rankTier: 'Rising',
};

// Fixture mirrors the live shape: 5 characters, A-Z0-9. A 9-character mock made
// the screen look fine in fixture mode while live users saw an 11-character code.
const MOCK_MY_CODE: MyCode = {
  code: 'JIDE4',
  link: 'https://spotlight.ng/j/JIDE4',
  shortLink: 'https://spotlight.ng/j/JIDE4',
};

const MOCK_ACTIVITY: ActivityItem[] = [
  { id: 'a1', kind: 'reward', title: 'Reward earned', detail: 'Amara completed KYC', createdAt: minsAgo(12), amountKobo: 50_000, state: 'vesting', inviteeName: 'Amara' },
  { id: 'a2', kind: 'signup', title: 'New signup', detail: 'Tunde created an account', createdAt: minsAgo(140), inviteeName: 'Tunde' },
  { id: 'a3', kind: 'vesting_unlock', title: 'Reward unlocked', detail: 'Tranche 1 of your reward from Bola is ready', createdAt: minsAgo(1500), amountKobo: 50_000, state: 'eligible', inviteeName: 'Bola' },
  { id: 'a4', kind: 'activation', title: 'Friend activated', detail: 'Ngozi made her first transaction', createdAt: minsAgo(2880), inviteeName: 'Ngozi' },
  { id: 'a5', kind: 'payout', title: 'Payout to wallet', detail: '₦2,000 moved to your Spotlight wallet', createdAt: minsAgo(4320), amountKobo: 200_000, state: 'paid' },
  { id: 'a6', kind: 'click', title: 'Link clicked', detail: 'Someone opened your invite link', createdAt: minsAgo(5400) },
  { id: 'a7', kind: 'clawback', title: 'Reward reversed', detail: 'A referral was flagged as invalid', createdAt: minsAgo(8640), amountKobo: 50_000, state: 'clawed_back' },
];

export async function getDashboard(): Promise<DashboardSummary> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_SUMMARY, snapshot: { ...MOCK_SNAPSHOT } };
  }
  // The dashboard is required; the per-state reward summary is not. If only the summary
  // fails the screen still loads, with that section reported unavailable (never
  // substituted with a different figure — see mapSnapshot).
  const [dRes, sRes] = await Promise.all([
    api.get(`${REWARDS_ENGINE_BASE}/me/dashboard`),
    api.get('/api/v1/referral/my-rewards').catch(() => null),
  ]);
  const d = unwrap<EngineDashboard>(dRes);
  const rewards = sRes ? unwrap<EngineRewards>(sRes) : null;
  const { snapshot, unavailable } = mapSnapshot(d, rewards);
  return {
    snapshot,
    snapshotUnavailable: unavailable,
    nextMilestone: mapMilestone(d.next_milestone),
    ...homeCounts(d),
    // No leaderboard rank source exists in the backend, so none is reported; the screen
    // shows the tier and the next milestone instead.
    rank: null,
    rankTotal: null,
    rankTier: d.current_tier,
  };
}

export async function getMyCode(): Promise<MyCode> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_MY_CODE };
  }
  // The code comes from the dashboard; the link is built from it.
  const res = await api.get(`${REWARDS_ENGINE_BASE}/me/dashboard`);
  const d = unwrap<EngineDashboard>(res);
  const link = `https://spotlight.ng/j/${d.code}`;
  return {
    code: d.code,
    link,
    // There is no separate vanity/short-link source: do not present the same URL twice.
    shortLink: null,
  };
}

export async function getActivity(): Promise<ActivityItem[]> {
  if (USE_MOCK) {
    await delay(280);
    return MOCK_ACTIVITY.map((a) => ({ ...a }));
  }
  // People who joined with the code, plus the rewards they generated. Either source may
  // fail on its own and the feed still shows the other; only when BOTH fail is it an error.
  const [eRes, rRes] = await Promise.allSettled([
    api.get(`${REWARDS_ENGINE_BASE}/me/earnings?limit=20&offset=0`),
    api.get(`${REWARDS_ENGINE_BASE}/me/referrals?limit=20&offset=0`),
  ]);
  if (eRes.status === 'rejected' && rRes.status === 'rejected') throw eRes.reason;
  const earnings = eRes.status === 'fulfilled'
    ? unwrap<{ earnings?: EngineEarning[] }>(eRes.value)?.earnings ?? []
    : [];
  const referrals = rRes.status === 'fulfilled'
    ? unwrap<{ referrals?: EngineReferral[] }>(rRes.value)?.referrals ?? []
    : [];
  return buildActivity(earnings, referrals);
}
