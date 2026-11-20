// Mirrors the RB0 shared DB contract in docs/prd/referal/REFERRAL-BUILD-PLAN.md §3.
// All money is BIGINT kobo (integer minor units). Never floats for math.

export interface ReferralDashboard {
  // true K-factor EXCLUDES house-attributed signups (§7A.6)
  k_factor: number;
  k_factor_incl_house: number;
  referral_cac_kobo: number;
  paid_cac_kobo: number;
  gmv_kobo: number;
  fraud_rate: number; // 0..1
  reward_burn_kobo: number;
  reward_budget_kobo: number;
  referred_signups: number;
  house_signups: number;
  activated_rate: number; // 0..1
  reward_to_ltv_ratio: number;
  trend: { date: string; referred: number; house: number; burn_kobo: number }[];
  activity: ReferralActivity[];
}

export interface ReferralActivity {
  id: string;
  label: string;
  kind: string; // signup | reward_earned | clawback | reassignment | campaign | house_capture
  ref: string | null;
  created_at: string;
}

/**
 * The program tab's fields, read off the ONE config surface the backend mounts:
 * GET /api/referral/admin/config → referralconfig.Config
 * (backend/internal/referral/config/service.go:18, a single `referral_config`
 * row). That row answers attribution_window_hours, grace_window_hours,
 * fallback_chain, house_account_code, budget_neutral and
 * welcome_reward_enabled — and nothing else.
 *
 * The rest of what this tab used to show (program on/off, default tier, the
 * tier ladder, qualifying action, reward-to-LTV cap, last-updated) has no
 * column in that row and no other admin route, so they are optional here and
 * render as not reported. A "Disabled" badge or a "0%" cap invented from a
 * missing field is a claim about live money rules.
 */
export interface ProgramConfig {
  program_enabled?: boolean;
  default_tier?: string;
  tiers?: { name: string; monthly_cap_kobo: number; override_pct: number; disclosure: string }[];
  qualifying_action?: string; // e.g. "kyc_plus_first_txn"
  reward_to_ltv_cap_pct?: number;
  welcome_reward_enabled: boolean;
  updated_at?: string;
}

export interface ReferralRole {
  role: string;
  scope: string;
  permissions: string[];
}

export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  kill_switch: boolean; // emergency-pause flags
  phase: 'P1' | 'P2' | 'P3';
}

export interface ReferralAuditEntry {
  id: string;
  actor_id: string;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  created_at: string;
}

export type FallbackTier =
  | 'code'
  | 'deeplink'
  | 'context'
  | 'regional_house'
  | 'global_house';

export interface FallbackChainEntry {
  tier: FallbackTier;
  label: string;
  enabled: boolean;
}

export interface AttributionConfig {
  attribution_window_hours: number;
  grace_window_hours: number;
  fallback_chain: FallbackChainEntry[];
  house_account_code: string;
  // (a) budget-neutral (recommended default) vs (b) funded house pool (§7A.2)
  budget_neutral: boolean;
  welcome_reward_enabled: boolean;
  // referralconfig.Config has no self-referral column and no updated_at, so the
  // page renders both as not reported rather than a default it never measured.
  self_referral_blocked?: boolean;
  updated_at?: string;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'throttled' | 'ended';
export type RewardModel = 'flat' | 'dynamic' | 'ltv';

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  reward_model: RewardModel;
  vertical: string;
  funded_by: 'platform' | 'merchant';
  budget_kobo: number;
  spent_kobo: number;
  starts_at: string;
  ends_at: string | null;
  signups: number;
  activations: number;
  cost_per_activation_kobo: number;
  created_at: string;
}

export interface CampaignDetail extends CampaignSummary {
  audience: string;
  geography: string[];
  eligibility: string;
  referrer_reward_kobo: number;
  referee_reward_kobo: number;
  vesting: string; // e.g. "KYC 40% / first-txn 30% / retained-30d 30%"
  per_user_cap_kobo: number;
  daily_cap_kobo: number;
  roi_guardrail_pct: number;
  throttle_per_min: number;
  auto_pause_on_fraud: boolean;
  funnel: { stage: string; count: number }[];
}

export interface CampaignDraft {
  name: string;
  vertical: string;
  reward_model: RewardModel;
  funded_by: 'platform' | 'merchant';
  audience: string;
  eligibility: string;
  referrer_reward_kobo: number;
  referee_reward_kobo: number;
  vesting: string;
  budget_kobo: number;
  per_user_cap_kobo: number;
  daily_cap_kobo: number;
  starts_at: string;
  ends_at: string | null;
}

export type RewardState = 'earned' | 'pending' | 'vesting' | 'eligible' | 'paid' | 'clawed_back';
export type RewardKind = 'referrer' | 'referee' | 'override' | 'mission' | 'manual';

/**
 * One row of the referral reward ledger as GET /api/referral/admin/ledger
 * answers it (ledger.Entry, backend/internal/referral/ledger/service.go:97).
 *
 * That struct is the whole list: id, beneficiary/house/referred user, kind,
 * state, amount, currency and the two exclusion flags — and every one of the
 * user/campaign links is `omitempty` in Go, so it can be absent rather than
 * null. It carries NO campaign, no finance-ledger link, no idempotency key and
 * no timestamps: the live mapper in referralAdminService.ts leaves those
 * undefined, the dev fixtures below carry them, and _ui renders an em-dash
 * wherever the route did not answer.
 */
export interface RewardLedgerEntry {
  id: string;
  beneficiary_id?: string;
  referred_user_id?: string | null;
  house_account_id?: string | null;
  campaign_id?: string | null;
  kind: RewardKind;
  state: RewardState;
  amount_kobo: number;
  currency: string;
  is_house: boolean;
  excluded_from_override: boolean;
  excluded_from_kfactor: boolean;
  ledger_entry_id?: string | null;
  idempotency_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ManualGrantInput {
  beneficiary_id: string;
  amount_kobo: number;
  kind: RewardKind;
  reason: string;
}

export interface ClawbackInput {
  reward_id: string;
  reason: string;
}

export interface HouseAccount {
  id: string;
  code: string;
  scope: 'global' | 'regional';
  region: string | null;
  owner_user_id: string;
  non_withdrawable: boolean;
  /** Not a column of referral_house_accounts: absent beats a measured ₦0.00. */
  balance_kobo?: number; // notional internal credit
  created_at: string;
}

export interface HouseLedger {
  accounts: HouseAccount[];
  total_house_volume: number; // count of house-attributed rewards
  total_house_value_kobo: number;
  /** From the house account's own non_withdrawable flag — §7A.2's definition. */
  budget_neutral: boolean;
  entries: HouseLedgerEntry[];
}

/**
 * HouseLedgerEntry carries exactly the columns house.Handler.Ledger selects
 * (backend/internal/referral/house/service.go:175): id, referred_user_id, kind,
 * state, amount_kobo, currency and the two exclusion flags. A reward row's
 * beneficiary, campaign, ledger-entry link and idempotency key are not in that
 * query, so this view type does not claim to have them — the house ledger page
 * never renders those columns, and inventing nulls for them would only make the
 * type look wider than the endpoint is.
 */
export interface HouseLedgerEntry {
  id: string;
  referred_user_id: string | null;
  kind: RewardKind;
  state: RewardState;
  amount_kobo: number;
  currency: string;
  excluded_from_override: boolean;
  excluded_from_kfactor: boolean;
  created_at: string;
}

export type ReassignReason = 'late_claim' | 'fraud_correction' | 'dispute';
export type ReassignStatus = 'pending' | 'approved' | 'rejected';

export interface Reassignment {
  id: string;
  attribution_id: string;
  referred_user_id: string;
  from_party: string;
  to_party: string;
  reason: ReassignReason;
  requested_by: string;
  cosigned_by: string | null;
  benefits_house: boolean; // when true, separation-of-duties co-sign required
  status: ReassignStatus;
  audit: { ts: string; actor: string; action: string }[];
  created_at: string;
  decided_at: string | null;
}

export interface ReassignDecision {
  id: string;
  decision: 'approved' | 'rejected';
  cosigner_id: string;
  note: string;
}
