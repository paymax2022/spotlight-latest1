// ── Referral Home (Earn dashboard) API ───────────────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`.
// Money is ALWAYS integer kobo. Earnings tie to friends' verified activity (§7).

import { api } from '@/api/client';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import type { EarnStateKey } from '../constants/referral.constants';
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

// ── Direct Rewards engine (live source of truth) ────────────────────────────
// The home/* endpoints under REFERRAL_API_BASE do not exist. The live branches
// below source from the fully-live Direct Rewards engine at /api/v1/referrals
// (note the trailing 's'), which returns BARE snake_case JSON.
const REWARDS_ENGINE_BASE = '/api/v1/referrals';

interface EngineDashboard {
  code: string;
  current_tier: string;
  current_rate: number;
  active_referral_count: number;
  this_month_earned_kobo: number;
  lifetime_earned_kobo: number;
  next_milestone?: { threshold: number; bonus_kobo: number; remaining: number };
}

interface EngineEarning {
  id: string;
  referred_user_id: string;
  module: string;
  margin_kobo: number;
  applied_rate: number;
  reward_kobo: number;
  status: string;
  created_at: string;
  credited_at?: string;
  reversed_at?: string;
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ── Mock fixtures ─────────────────────────────────────────────────────────────
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
  invitesSent: 14,
  signups: 6,
  activated: 4,
  rank: 23,
  rankTotal: 1840,
  rankTier: 'Rising',
};

const MOCK_MY_CODE: MyCode = {
  code: 'CHIDI-PAY',
  link: 'https://spotlight.ng/join?ref=CHIDI-PAY',
  shortLink: 'https://spot.ng/r/chidi',
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

// ── Calls ─────────────────────────────────────────────────────────────────────
export async function getDashboard(): Promise<DashboardSummary> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_SUMMARY, snapshot: { ...MOCK_SNAPSHOT } };
  }
  // Live: Direct Rewards engine dashboard (tier/counts/lifetime) + the RB0
  // reward-ledger summary (GET /api/v1/referral/my-rewards) for the per-state
  // snapshot. Money stays integer kobo, no float math.
  const [dRes, sRes] = await Promise.all([
    api.get('/api/v1/referrals/me/dashboard'),
    api.get('/api/v1/referral/my-rewards').catch(() => null),
  ]);
  const d = unwrap<EngineDashboard>(dRes);
  const s = sRes
    ? unwrap<{
        total_earned_kobo?: number;
        eligible_kobo?: number;
        paid_kobo?: number;
        clawed_back_kobo?: number;
        by_state?: Record<string, number>;
      }>(sRes)
    : null;
  const byState = s?.by_state ?? {};
  const snapshot: EarningsSnapshot = {
    eligibleKobo: Math.trunc(s?.eligible_kobo ?? 0),
    pendingKobo: Math.trunc(byState.pending ?? 0),
    vestingKobo: Math.trunc(byState.vesting ?? 0),
    paidKobo: Math.trunc(s?.paid_kobo ?? d.this_month_earned_kobo),
    clawedBackKobo: Math.trunc(s?.clawed_back_kobo ?? 0),
    lifetimeEarnedKobo: Math.trunc(s?.total_earned_kobo ?? d.lifetime_earned_kobo),
    currency: 'NGN',
  };
  return {
    snapshot,
    invitesSent: null, // TODO(referral phase3): needs invite-tracking backend (R3)
    signups: null, // TODO(referral phase3): needs invite-tracking backend (R3)
    activated: d.active_referral_count,
    rank: null, // TODO(referral phase3): needs leaderboard rank source (R2)
    rankTotal: null, // TODO(referral phase3): needs leaderboard total (R2)
    rankTier: d.current_tier,
  };
}

export async function getMyCode(): Promise<MyCode> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_MY_CODE };
  }
  // Live: pull the code from the Direct Rewards dashboard (avoids an extra
  // POST /link round-trip). Build the invite link from the code.
  const res = await api.get('/api/v1/referrals/me/dashboard');
  const d = unwrap<EngineDashboard>(res);
  const link = `https://spotlight.ng/j/${d.code}`;
  return {
    code: d.code,
    link,
    shortLink: link, // TODO(referral phase3): no vanity/short-link source yet
  };
}

export async function getActivity(): Promise<ActivityItem[]> {
  if (USE_MOCK) {
    await delay(280);
    return MOCK_ACTIVITY.map((a) => ({ ...a }));
  }
  // Live: there is no dedicated activity feed on the engine. Derive the
  // timeline from recent earnings (GET /me/earnings) — one reward row each.
  const res = await api.get('/api/v1/referrals/me/earnings?limit=20&offset=0');
  const body = unwrap<{ earnings: EngineEarning[] }>(res);
  const earnings = body?.earnings ?? [];
  return earnings.map((e) => ({
    id: e.id,
    kind: 'reward' as const,
    title: 'Reward earned',
    detail: `${e.module} · ${e.status}`,
    createdAt: e.created_at,
    amountKobo: e.reward_kobo,
    state: mapEarningStatus(e.status),
  }));
}

// Map engine earning status → reward-ledger EarnStateKey (drives the pill).
// The Direct Rewards engine returns UPPERCASE statuses (CREDITED/PENDING/REVERSED);
// the RB0 reward-ledger uses lowercase states. Normalise so both map correctly.
function mapEarningStatus(status: string): EarnStateKey {
  switch ((status ?? '').toLowerCase()) {
    case 'pending':
      return 'pending';
    case 'vesting':
      return 'vesting';
    case 'eligible':
      return 'eligible';
    case 'credited':
    case 'paid':
      return 'paid';
    case 'reversed':
    case 'clawed_back':
      return 'clawed_back';
    default:
      return 'earned';
  }
}
