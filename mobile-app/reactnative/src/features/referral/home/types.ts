// Self-contained types for the M-HOME-* surfaces (dashboard, my code/link/QR,
// earnings summary, activity timeline). Money is ALWAYS integer kobo.

import type { EarnStateKey } from '../constants/referral.constants';

// Totals are kept per reward-ledger state so the summary card can show
// paid / pending / vesting / clawed-back at a glance (PRD §7).
export interface EarningsSnapshot {
  /** Currently withdrawable (eligible) earnings in kobo. */
  eligibleKobo: number;
  pendingKobo: number;
  vestingKobo: number;
  paidKobo: number;
  clawedBackKobo: number;
  /** Lifetime gross earned (sum of all non-reversed accruals) in kobo. */
  lifetimeEarnedKobo: number;
  currency: string;
}

export interface DashboardSummary {
  snapshot: EarningsSnapshot;
  /** Total people invited (sent links/codes/contacts). null = no live source yet. */
  invitesSent: number | null;
  /** Invitees that signed up (account created). null = no live source yet. */
  signups: number | null;
  /** Invitees that activated (KYC + qualifying action). */
  activated: number;
  /** Leaderboard rank among referrers, null when unranked. */
  rank: number | null;
  rankTotal: number | null;
  /** Display rank tier label, e.g. "Rising". */
  rankTier: string | null;
}

export interface MyCode {
  code: string;
  /** Full shareable link (already includes the code). */
  link: string;
  /** Short / vanity alias when one exists. */
  shortLink: string | null;
}

export type ActivityKind =
  | 'click'
  | 'signup'
  | 'kyc'
  | 'activation'
  | 'reward'
  | 'vesting_unlock'
  | 'payout'
  | 'clawback';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  createdAt: string;
  /** Reward amount in kobo where relevant. */
  amountKobo?: number | null;
  /** Reward-ledger state for reward rows (drives the pill). */
  state?: EarnStateKey;
  /** Invitee display name (first name / masked), when known. */
  inviteeName?: string | null;
}
