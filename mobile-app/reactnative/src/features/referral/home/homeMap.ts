// Maps the live Direct Rewards engine payloads onto what the Earn hub home screen shows.
// Pure, so the failure behaviour is unit-tested: a figure that is wrong but plausible is
// worse than one that is plainly unavailable, so nothing here substitutes one number for
// another when a source is missing.

import type { EarnStateKey } from '../constants/referral.constants';
import type { ActivityItem, EarningsSnapshot, NextMilestone } from './types';
import type {
  EngineDashboard, EngineEarning, EngineNextMilestone, EngineReferral, EngineRewards,
} from './engine';

const kobo = (v: unknown): number => {
  const n = Math.trunc(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/**
 * The per-state earnings snapshot. When the rewards summary call failed (`rewards` null)
 * the breakdown is reported UNAVAILABLE and every state is zero: the dashboard's "earned
 * this month" figure must not stand in for "paid to wallet" — different numbers under one
 * label. The dashboard's own lifetime total is real and is kept.
 */
export function mapSnapshot(
  d: EngineDashboard,
  rewards: EngineRewards | null,
): { snapshot: EarningsSnapshot; unavailable: boolean } {
  if (!rewards) {
    return {
      unavailable: true,
      snapshot: {
        eligibleKobo: 0, pendingKobo: 0, vestingKobo: 0, paidKobo: 0, clawedBackKobo: 0,
        lifetimeEarnedKobo: kobo(d.lifetime_earned_kobo), currency: 'NGN',
      },
    };
  }
  const byState = rewards.by_state ?? {};
  return {
    unavailable: false,
    snapshot: {
      eligibleKobo: kobo(rewards.eligible_kobo),
      pendingKobo: kobo(byState.pending),
      vestingKobo: kobo(byState.vesting),
      paidKobo: kobo(rewards.paid_kobo),
      clawedBackKobo: kobo(rewards.clawed_back_kobo),
      lifetimeEarnedKobo: kobo(rewards.total_earned_kobo ?? d.lifetime_earned_kobo),
      currency: 'NGN',
    },
  };
}

export function mapMilestone(raw: EngineNextMilestone | undefined | null): NextMilestone | null {
  if (!raw) return null;
  const { threshold, bonus_kobo: bonus, remaining } = raw;
  if (![threshold, bonus, remaining].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (threshold <= 0 || bonus < 0) return null;
  return { threshold, bonusKobo: Math.trunc(bonus), remaining };
}

/** How far through the milestone the referrer is, clamped to 0–100%. */
export function milestoneProgress(m: NextMilestone): { done: number; pct: number } {
  const remaining = Math.min(Math.max(m.remaining, 0), m.threshold);
  const done = m.threshold - remaining;
  return { done, pct: Math.round((done / m.threshold) * 100) };
}

const sentenceCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');

export function tierLabel(t: string | null | undefined): string | null {
  const v = (t ?? '').trim();
  return v ? sentenceCase(v) : null;
}

/** "bills" -> "Bills", "cable_tv" -> "Cable tv". */
export function moduleLabel(m: string | null | undefined): string {
  return sentenceCase((m ?? '').trim().replace(/[_-]+/g, ' '));
}

// Engine earning status -> reward-ledger state (drives the pill). The engine and the RB0
// ledger spell some states differently, so normalise case and aliases.
export function mapEarningStatus(status: string): EarnStateKey {
  switch ((status ?? '').toLowerCase()) {
    case 'pending': return 'pending';
    case 'vesting': return 'vesting';
    case 'eligible': return 'eligible';
    // The engine's CREDITED means "credited to the referral balance", not "paid out":
    // a commission split stays withdrawable until the referrer withdraws (RB0 ledger
    // eligible -> paid). The paid figure comes from /my-rewards.
    case 'credited': return 'earned';
    case 'paid': return 'paid';
    case 'reversed':
    case 'clawed_back': return 'clawed_back';
    default: return 'earned';
  }
}

/**
 * One feed from both sources, newest first: people who joined with the code, and the
 * rewards they generated. Rows with an unreadable date sort last rather than first.
 */
export function buildActivity(
  earnings: EngineEarning[],
  referrals: EngineReferral[],
  limit = 20,
): ActivityItem[] {
  const rewardItems: ActivityItem[] = earnings.map((e) => {
    const state = mapEarningStatus(e.status);
    const reversed = state === 'clawed_back';
    return {
      id: `e:${e.id}`,
      kind: reversed ? 'clawback' : 'reward',
      title: reversed ? 'Reward reversed' : 'Reward earned',
      detail: moduleLabel(e.module),
      createdAt: e.created_at,
      amountKobo: e.reward_kobo,
      state,
    };
  });

  const signupItems: ActivityItem[] = referrals.map((r) => ({
    id: `r:${r.referred_user_id}`,
    kind: 'signup',
    title: `${r.masked_contact} joined`,
    detail: r.active ? 'Active: made a qualifying purchase this month' : 'Signed up with your code',
    createdAt: r.joined_at,
    inviteeName: r.masked_contact,
  }));

  const ts = (a: ActivityItem): number => {
    const t = Date.parse(a.createdAt);
    return Number.isFinite(t) ? t : -Infinity;
  };
  return [...rewardItems, ...signupItems].sort((a, b) => ts(b) - ts(a)).slice(0, limit);
}
