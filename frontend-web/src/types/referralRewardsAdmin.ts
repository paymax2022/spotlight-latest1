// ── Direct Referral Rewards — admin console types (ADR-022) ───────────────────
// Single-level, purchase-triggered revenue-share program. Supersedes the tiered
// "house" referral model. Backend contract is snake_case; money is BIGINT kobo.
// Mounts: admin → /v1/admin/referrals · user → /v1/referrals.

export type RewardStatus = 'PENDING' | 'CREDITED' | 'REVERSED';
export type MilestoneStatus = 'ACHIEVED' | 'PAID' | 'VOIDED';
export type TierName = 'STARTER' | 'GROWTH' | 'PRO' | 'ELITE';
export type FraudFlagStatus = 'OPEN' | 'CLEARED' | 'VOIDED' | 'SUSPENDED';
export type FraudAction = 'CLEARED' | 'VOIDED' | 'SUSPENDED';

// ── A1 Program config ─────────────────────────────────────────────────────────
export interface TierRow {
  tier: TierName;
  min_count: number;
  max_count: number | null; // null = open-ended (Elite)
  rate: number; // fraction of margin, e.g. 0.05
}
export interface MilestoneRow {
  threshold: number;
  bonus_kobo: number;
}
export interface ProgramConfig {
  version: number;
  tier_table: TierRow[];
  milestone_table: MilestoneRow[];
  is_active: boolean;
  effective_from: string; // ISO
}
export interface ConfigPublishInput {
  tier_table: TierRow[];
  milestone_table: MilestoneRow[];
  effective_from?: string; // ISO; defaults server-side to now
}
export interface ConfigPublishResult {
  config: ProgramConfig;
  warning: string; // future-only advisory surfaced by the backend
}

// ── A2 Analytics dashboard ────────────────────────────────────────────────────
export interface ModuleRewardStat {
  module: string;
  reward_kobo: number;
  reward_count: number;
  last_event_at: string | null;
}
export interface TierReferrerStat {
  tier: TierName;
  referrer_count: number;
}
export interface ReferralAnalytics {
  active_referrers: number;
  active_referred_users: number;
  total_rewards_paid_kobo: number;
  total_margin_kobo: number;
  reward_cost_pct: number; // north-star: rewards / margin, as a %
  by_module: ModuleRewardStat[];
  by_tier: TierReferrerStat[];
}

// ── A3 Fraud & anti-abuse queue ───────────────────────────────────────────────
export interface FraudFlag {
  flag_id: string;
  referrer_id: string;
  referred_user_id: string;
  reason: string; // e.g. self_referral, circular_funding
  evidence: Record<string, string | number | boolean | null>;
  status: FraudFlagStatus;
  flagged_at: string;
}
export interface FraudActionInput {
  flag_id: string;
  action: FraudAction;
  note: string; // required
}

// ── A4 Ledger & reconciliation ────────────────────────────────────────────────
export interface Reward {
  id: string;
  referrer_id: string;
  referred_user_id: string;
  source_transaction_id: string;
  module: string;
  margin_amount_kobo: number;
  applied_rate: number;
  reward_amount_kobo: number;
  status: RewardStatus;
  created_at: string;
  credited_at: string | null;
  reversed_at: string | null;
}
export interface LedgerFilters {
  status?: string;
  module?: string;
  limit?: number;
  offset?: number;
}

// ── A5 Referrer case view ─────────────────────────────────────────────────────
export interface TierStatus {
  referrer_id: string;
  active_referral_count: number;
  current_tier: TierName;
  current_rate: number;
  last_recalculated_at: string;
}
export interface Milestone {
  id: string;
  referrer_id: string;
  threshold: number;
  bonus_kobo: number;
  status: MilestoneStatus;
  achieved_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
}
export interface ReferrerCase {
  referrer_id: string;
  tier: TierStatus;
  rewards: Reward[];
  milestones: Milestone[];
}
export interface CaseAdjustmentInput {
  adjust_kobo: number; // signed; positive = credit, negative = debit
  reason: string; // required — logged to the audit trail
}

// ── A6 Milestone payout log ───────────────────────────────────────────────────
export interface MilestonePayout extends Milestone {
  // referrer identity for the chronological log view
}

// ── A7 Module integration status ──────────────────────────────────────────────
export interface ModuleStatus {
  module: string;
  reward_kobo: number;
  reward_count: number;
  last_event_at: string | null;
}
