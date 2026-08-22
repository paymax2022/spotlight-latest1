// ── Admin — Paymax Social Pay (P2P / Split / Pools) ops console types ─────────
// Field names mirror the Go JSON (snake_case) from /api/social/admin/*.
// Money is BIGINT kobo (minor units) throughout.
// Invariants surfaced in the UI: NL-8 (money is a ledger), NL-10 (KYC gates &
// AML velocity limits), NL-12 (immutable audit on every state change).

export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'rejected' | 'closed';
export type ReversalStatus = 'pending' | 'reversed' | 'rejected';
export type CashtagStatus = 'active' | 'reserved' | 'flagged' | 'suspended' | 'verified';

// ── Dashboard ────────────────────────────────────────────────────────────────
export interface SocialDashboardActivity {
  id: string;
  kind: string; // p2p_send | split_settled | pool_payout | reversal | limit_breach | dispute_opened …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface SocialDashboard {
  p2p_volume_today_kobo: number;
  p2p_volume_30d_kobo: number;
  p2p_count_today: number;
  p2p_count_30d: number;
  avg_p2p_value_kobo: number;
  // split-bill activity
  splits_active: number;
  split_outstanding_kobo: number;
  // group pools
  pools_active: number;
  pool_held_kobo: number;
  // risk / ops
  reversals_pending: number;
  reversals_value_kobo: number;
  disputes_open: number;
  limit_breaches_24h: number;
  aml_flags_open: number;
  cashtags_flagged: number;
  volume_trend: { date: string; p2p_kobo: number; split_kobo: number; pool_kobo: number }[];
  activity: SocialDashboardActivity[];
}

// ── Velocity / AML limits config (NL-10) ─────────────────────────────────────
export interface VelocityLimit {
  id: string;
  scope: 'tier1' | 'tier2' | 'tier3' | 'global';
  label: string;
  per_txn_kobo: number;
  daily_kobo: number;
  monthly_kobo: number;
  daily_count: number;
  aml_review_threshold_kobo: number; // single txn >= this → AML review
  enabled: boolean;
  updated_at: string;
}
export interface SocialLimits {
  updated_at: string;
  limits: VelocityLimit[];
}
export interface UpdateLimitsResult {
  updated: number;
  audit_id: string;  // immutable audit entry id (NL-12)
  message: string;
}

// ── Reversal tooling ─────────────────────────────────────────────────────────
export interface ReversalRecord {
  id: string;
  txn_ref: string;
  from_masked: string;
  to_masked: string;
  amount_kobo: number;
  reason: string;        // wrong_recipient | fraud | duplicate | dispute_resolution …
  status: ReversalStatus;
  requested_by_masked: string;
  requested_at: string;
  resolved_at: string | null;
}
export interface ReverseTxnResult {
  id: string;
  status: ReversalStatus;
  reversing_entry_id: string; // corrections are reversing ledger entries only (NL-8)
  audit_id: string;           // immutable audit entry id (NL-12)
  message: string;
}

// ── Disputes (request / payment) ─────────────────────────────────────────────
export interface SocialDispute {
  id: string;
  kind: 'payment' | 'request' | 'split' | 'pool';
  txn_ref: string;
  complainant_masked: string;
  respondent_masked: string;
  amount_kobo: number;
  reason: string;
  status: DisputeStatus;
  opened_at: string;
  updated_at: string;
}

// ── Cashtag directory (handle abuse / impersonation review) ───────────────────
export interface CashtagRecord {
  id: string;
  handle: string;          // @handle
  owner_masked: string;
  status: CashtagStatus;
  flag_reason: string | null; // impersonation | abuse | reserved | null
  txn_count_30d: number;
  volume_30d_kobo: number;
  created_at: string;
}
export type CashtagDecision = 'clear' | 'suspend' | 'release_handle' | 'verify';
export interface CashtagReviewResult {
  id: string;
  status: CashtagStatus;
  audit_id: string;  // immutable audit entry id (NL-12)
  message: string;
}
