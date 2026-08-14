// ── Admin — Paymax Creators (Storefront, Tips, Subscriptions, Gated content) types ─
// Field names mirror the Go JSON (snake_case) from /api/creators/admin/*.
// Money is BIGINT kobo (minor units) throughout — display via formatNaira (kobo → ₦).
// Invariants surfaced in the UI:
//   NL-5  — Perks, not returns: creator income delivers goods/content/perks, never a
//           financial return or revenue share. No securities.
//   NL-10 — KYC gates & AML: creator payouts require the right KYC tier; payout is
//           gated fail-closed until KYC clears.
//   NL-11 — Content & age safety: all creator content passes moderation with
//           age-appropriate controls. Audience skews young — never weaken controls.
//   NL-12 — immutable audit on every state change (verification, moderation, payout,
//           billing, fee/config change, fraud action).

export type CreatorVerificationStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'suspended';
export type CreatorDecision = 'approve' | 'reject' | 'request_changes' | 'suspend';
export type ContentModStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type ContentModAction = 'approve' | 'reject' | 'flag';
export type AgeRating = 'all' | 'teen' | 'mature_18';
export type BillingStatus = 'active' | 'past_due' | 'failed' | 'cancelled' | 'paused';
export type PayoutStatus = 'pending' | 'kyc_hold' | 'approved' | 'paid' | 'rejected';
export type PayoutDecision = 'approve' | 'reject';
export type CreatorKycTier = 'tier0' | 'tier1' | 'tier2' | 'tier3';
export type CreatorFraudKind = 'self_tip' | 'tip_wash' | 'sub_churn_abuse' | 'chargeback_ring' | 'content_recycle';
export type CreatorFraudStatus = 'open' | 'investigating' | 'cleared' | 'blocked';
export type CreatorFraudAction = 'investigate' | 'clear' | 'block';

// ── A · Dashboard ───────────────────────────────────────────────────────────
export interface CreatorsDashboardActivity {
  id: string;
  kind: string; // creator_verified | content_flagged | payout_held | sub_failed | self_tip_flag | fee_updated …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface CreatorsDashboard {
  creators_total: number;
  creators_verified: number;
  creators_pending_verification: number;
  active_subscriptions: number;
  tips_volume_30d_kobo: number;
  subs_revenue_30d_kobo: number;
  gated_revenue_30d_kobo: number;
  gross_creator_earnings_30d_kobo: number;
  platform_fee_30d_kobo: number;
  take_rate: number; // platform fee ÷ gross
  payout_liability_kobo: number;     // creator earnings owed, not yet paid
  payouts_kyc_hold: number;          // NL-10 — payouts blocked on KYC
  payouts_kyc_hold_kobo: number;
  content_pending_moderation: number;
  content_flagged_open: number;
  billing_failed_open: number;
  fraud_open: number;
  earnings_trend: { date: string; tips_kobo: number; subs_kobo: number; gated_kobo: number }[];
  top_creators: { id: string; handle_masked: string; earnings_30d_kobo: number; subscribers: number; category: string }[];
  activity: CreatorsDashboardActivity[];
}

// ── B · Verification queue ───────────────────────────────────────────────────
export interface CreatorVerificationItem {
  id: string;
  handle_masked: string;
  legal_name_masked: string;
  category: string;
  city: string;
  status: CreatorVerificationStatus;
  kyc_tier: CreatorKycTier;
  kyc_verified: boolean;
  followers: number;
  storefront_complete: boolean;   // bio, banner, payout details present
  id_docs_present: boolean;
  flagged_terms: boolean;         // policy / impersonation flags
  submitted_at: string | null;
  created_at: string;
}
export interface CreatorDecisionResult {
  id: string;
  status: CreatorVerificationStatus;
  audit_id: string;
  message: string;
}

// ── C · Content moderation + age controls (NL-11) ────────────────────────────
export interface ContentModItem {
  id: string;
  creator_handle_masked: string;
  kind: 'video' | 'image' | 'audio' | 'gated_post' | 'live_replay';
  title: string;
  is_paid: boolean;
  price_kobo: number;
  age_rating: AgeRating;
  status: ContentModStatus;
  auto_flags: string[];           // model/keyword flags e.g. ['nudity_suspected','minor_audience_risk']
  reports_count: number;
  submitted_at: string;
  created_at: string;
}
export interface ContentModResult {
  id: string;
  status: ContentModStatus;
  age_rating: AgeRating;
  audit_id: string;
  message: string;
}

// ── D · Subscription billing + failed-renewal ────────────────────────────────
export interface CreatorBillingItem {
  id: string;                     // subscription id
  subscriber_masked: string;
  creator_handle_masked: string;
  tier_name: string;
  amount_kobo: number;            // per cycle
  cycle: 'monthly' | 'quarterly' | 'annual';
  status: BillingStatus;
  retries: number;
  max_retries: number;
  next_attempt_at: string | null;
  last_failure_reason: string | null;
  started_at: string;
  created_at: string;
}

// ── E · Payout queue (KYC-gated, NL-10) ──────────────────────────────────────
export interface CreatorPayoutItem {
  id: string;
  creator_handle_masked: string;
  kyc_tier: CreatorKycTier;
  kyc_verified: boolean;
  gross_earnings_kobo: number;
  fees_kobo: number;
  net_payable_kobo: number;
  status: PayoutStatus;
  bank_masked: string;
  requested_at: string;
  created_at: string;
}
export interface CreatorPayoutResult {
  id: string;
  status: PayoutStatus;
  audit_id: string;
  message: string;
}

// ── F · Fee config ───────────────────────────────────────────────────────────
export interface CreatorFeeConfig {
  generated_at: string;
  tip_fee_bps: number;            // basis points
  subscription_fee_bps: number;
  gated_content_fee_bps: number;
  min_payout_kobo: number;
  payout_kyc_min_tier: CreatorKycTier;
  hold_period_days: number;       // earnings hold before payout eligible
  updated_by_masked: string;
  updated_at: string;
}
export interface CreatorFeeConfigResult {
  config: CreatorFeeConfig;
  audit_id: string;
  message: string;
}

// ── G · Abuse / self-tip fraud ───────────────────────────────────────────────
export interface CreatorFraudSignal {
  id: string;
  creator_handle_masked: string;
  kind: CreatorFraudKind;
  subject_masked: string;
  detail: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  amount_kobo: number;
  status: CreatorFraudStatus;
  created_at: string;
}
export interface CreatorFraudActionResult {
  id: string;
  status: CreatorFraudStatus;
  audit_id: string;
  message: string;
}
