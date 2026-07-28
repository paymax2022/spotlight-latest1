// ── Referral Earnings & Rewards types ────────────────────────────────────────
// Self-contained types for the M-ERN-* surfaces (ledger, detail, vesting,
// withdraw, currency, catalog, statement, clawback, appeal). Money is ALWAYS
// integer kobo. Rewards are conditioned on a friend's real verified activity (§7).

import type { EarnStateKey } from '../constants/referral.constants';

export type { EarnStateKey };

// ── Reward ledger row (M-ERN-01 / M-ERN-02) ──────────────────────────────────
export type RewardKind = 'referrer' | 'referee' | 'override' | 'mission' | 'manual';

export type QualifyingAction =
  | 'kyc_completed'
  | 'first_transaction'
  | 'retained_30d'
  | 'retained_60d'
  | 'retained_90d'
  | 'mission_complete';

export interface RewardLedgerRow {
  id: string;
  state: EarnStateKey;
  kind: RewardKind;
  amountKobo: number;
  currency: string;
  /** Invitee / friend this reward is tied to (display name), null for missions. */
  inviteeName: string | null;
  /** The verified action that triggered/conditions this reward. */
  qualifyingAction: QualifyingAction;
  createdAt: string;
  updatedAt: string;
  /** Set when state === 'vesting'; references a VestingSchedule. */
  vestingScheduleId?: string | null;
  /** Set when state === 'clawed_back'. */
  clawbackId?: string | null;
}

// ── Reward detail (M-ERN-02) ─────────────────────────────────────────────────
export interface RewardTimelineEntry {
  state: EarnStateKey | 'event';
  label: string;
  at: string;
  done: boolean;
}

export interface RewardDetail extends RewardLedgerRow {
  /** Human explanation of why this reward exists / its conditions. */
  explanation: string;
  /** State transitions for this reward. */
  timeline: RewardTimelineEntry[];
}

// ── Vesting / holdback (M-ERN-03) ────────────────────────────────────────────
export interface VestingTranche {
  id: string;
  label: string;
  amountKobo: number;
  /** Condition that unlocks this tranche. */
  condition: QualifyingAction;
  unlocksAt: string | null;
  unlocked: boolean;
}

export interface VestingSchedule {
  id: string;
  rewardId: string;
  inviteeName: string | null;
  totalKobo: number;
  unlockedKobo: number;
  currency: string;
  tranches: VestingTranche[];
}

// ── Withdraw (M-ERN-04) ──────────────────────────────────────────────────────
export interface WithdrawQuote {
  eligibleKobo: number;
  minWithdrawKobo: number;
  feeKobo: number;
  currency: string;
  /** True when KYC tier allows withdrawal. */
  withdrawable: boolean;
  /** Reason copy when not withdrawable. */
  blockedReason?: string | null;
}

export interface WithdrawResult {
  ok: boolean;
  amountKobo: number;
  newEligibleKobo: number;
  walletBalanceKobo: number;
  reference: string;
  error?: 'below_min' | 'insufficient' | 'kyc_required' | 'failed';
}

// ── Reward currency (M-ERN-05) ───────────────────────────────────────────────
export type RewardCurrency = 'cash' | 'airtime_data' | 'points' | 'discount' | 'charity';

export interface CurrencyOption {
  key: RewardCurrency;
  label: string;
  icon: string;
  blurb: string;
  /** True when this is the user's active payout currency. */
  active: boolean;
}

// ── Rewards catalog (M-ERN-06) ───────────────────────────────────────────────
export interface CatalogItem {
  id: string;
  name: string;
  category: 'airtime' | 'data' | 'gift_card' | 'discount' | 'charity';
  costPoints: number;
  icon: string;
  available: boolean;
}

export interface RedeemResult {
  ok: boolean;
  item: string;
  remainingPoints: number;
  reference: string;
  error?: 'insufficient_points' | 'out_of_stock';
}

// ── Statement / export (M-ERN-07) ────────────────────────────────────────────
export type StatementPeriod = '30d' | '90d' | 'ytd' | 'all';

export interface StatementSummary {
  period: StatementPeriod;
  fromIso: string;
  toIso: string;
  earnedKobo: number;
  paidKobo: number;
  clawedBackKobo: number;
  rows: number;
  currency: string;
}

export interface StatementExport {
  ok: boolean;
  url: string | null;
  format: 'pdf' | 'csv';
}

// ── Clawback / appeal (M-ERN-08 / M-ERN-09) ──────────────────────────────────
export type ClawbackReason =
  | 'self_referral'
  | 'fake_account'
  | 'bought_signup'
  | 'duplicate_kyc'
  | 'chargeback'
  | 'policy_violation';

export interface ClawbackNotice {
  id: string;
  rewardId: string;
  inviteeName: string | null;
  amountKobo: number;
  currency: string;
  reason: ClawbackReason;
  reasonLabel: string;
  explanation: string;
  reversedAt: string;
  appealable: boolean;
  appealDeadline: string | null;
  /** Current appeal status, when one was filed. */
  appealStatus?: 'none' | 'submitted' | 'in_review' | 'upheld' | 'overturned';
}

export interface AppealInput {
  clawbackId: string;
  reason: string;
  /** Names of attached evidence files (mock: just labels). */
  evidence: string[];
}

export interface AppealResult {
  ok: boolean;
  caseId: string;
}
