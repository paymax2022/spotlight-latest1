// Finance/Payouts, Risk/Fraud, Compliance, Users/Graph, Gamification,
// Analytics/BI, Ambassadors/Agents, Merchants/Partners.
// PRD §8B (A-FIN / A-RSK / A-CMPL / A-USR / A-GAM / A-BI / A-AMB / A-MER) + §7A.6.
// All money is BIGINT kobo (integer minor units). Never floats for math.

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'on_hold';
export interface Payout {
  id: string;
  beneficiary_id: string;
  /**
   * Payout fields below are optional because finance.Payout (repo.go:415) does
   * not carry them: the row names a beneficiary_id and a wallet is a separate
   * surface, so the queue shows an em-dash instead of a value the API never sent.
   */
  beneficiary_name?: string;
  wallet_id?: string;
  reward_ids: string[];
  amount_kobo: number;
  currency: string;
  status: PayoutStatus;
  risk_flag?: 'low' | 'normal' | 'high' | 'critical';
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  idempotency_key?: string;
  reject_reason?: string;
}

export interface ReconRow {
  id: string;
  date: string;
  ledger_accrued_kobo: number;
  wallet_credited_kobo: number;
  payout_settled_kobo: number;
  variance_kobo: number;
  status: 'matched' | 'variance' | 'investigating';
}
export interface Reconciliation {
  as_of: string;
  total_accrued_kobo: number;
  total_credited_kobo: number;
  total_settled_kobo: number;
  unmatched_kobo: number;
  rows: ReconRow[];
}

export interface BudgetLine {
  scope: string; // campaign / program / vertical
  budget_kobo: number;
  spent_kobo: number;
  burn_rate_kobo_per_day: number | null; // null: the backend has no burn window yet
  projected_exhaust_date: string | null;
  alert: 'ok' | 'warn' | 'breach';
}
export interface BudgetBurn {
  as_of: string;
  program_budget_kobo: number | null; // null: no active global budget
  program_spent_kobo: number | null;
  reward_to_ltv_ratio: number | null; // 0..1 (A-FIN-04); null: not available
  reward_to_ltv_cap_pct: number | null; // null: no cap configured on the backend
  lines: BudgetLine[];
  trend: { date: string; spent_kobo: number }[];
}

export interface FloatPosition {
  id: string;
  account: string;
  provider: string;
  balance_kobo: number;
  reserved_kobo: number;
  available_kobo: number;
  threshold_kobo: number;
  status: 'healthy' | 'low' | 'critical';
  updated_at: string;
}
export interface Float {
  as_of: string;
  total_balance_kobo: number;
  total_reserved_kobo: number;
  total_available_kobo: number;
  positions: FloatPosition[];
}

export interface RiskAlert {
  id: string;
  kind: string; // velocity | device_farm | kyc_dup | self_referral | burn_spike
  severity: 'low' | 'normal' | 'high' | 'critical';
  subject_id: string;
  detail: string;
  /** risk.Alert has no amount column; a real alert is money-at-risk only if the
   * backend says so, so an unset value means "not reported", not "nothing". */
  amount_at_risk_kobo?: number;
  status?: string;
  created_at: string;
}
export interface RiskDashboard {
  /**
   * risk.DashboardCounts (repo.go:596) is four integers. Everything outside them
   * is optional HERE because no handler in internal/referral/risk computes it,
   * and the page must be able to tell "the API does not have this" apart from a
   * zero — the reading an operator would act on.
   */
  fraud_rate?: number; // 0..1
  open_cases: number;
  open_alerts?: number;
  queued_reviews?: number;
  active_blocks?: number;
  amount_at_risk_kobo?: number;
  blocked_24h?: number;
  clawbacks_30d_kobo?: number;
  alerts: RiskAlert[];
  burn_anomaly_trend?: { date: string; expected_kobo: number; actual_kobo: number }[];
}

export interface RiskRule {
  id: string;
  name: string;
  category: 'velocity' | 'device' | 'kyc_dedup' | 'behavioural';
  description: string;
  threshold: string;
  action: 'flag' | 'hold' | 'block' | 'clawback';
  enabled: boolean;
  hits_30d: number;
  updated_at: string;
}

export type CaseStatus = 'open' | 'investigating' | 'resolved' | 'closed';
export interface CaseEvidence {
  ts: string;
  kind: string;
  detail: string;
}
export interface CaseDetail {
  id: string;
  subject_id: string;
  subject_name: string;
  status: CaseStatus;
  severity: 'low' | 'normal' | 'high' | 'critical';
  reason: string;
  risk_score: number; // 0..100
  amount_at_risk_kobo: number;
  assigned_to: string | null;
  linked_accounts: string[];
  linked_devices: string[];
  evidence: CaseEvidence[];
  audit: { ts: string; actor: string; action: string }[];
  created_at: string;
  resolved_at: string | null;
}

export interface BlocklistEntry {
  id: string;
  type: 'device' | 'identity' | 'account' | 'bank';
  list: 'block' | 'allow';
  value: string;
  reason: string;
  added_by: string;
  created_at: string;
}

export type ClawbackStatus = 'pending' | 'executing' | 'recovered' | 'failed';
export interface ClawbackRecord {
  id: string;
  reward_id: string;
  beneficiary_id: string;
  amount_kobo: number;
  reason: string;
  status: ClawbackStatus;
  recovered_kobo: number;
  executed_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ReviewItem {
  id: string;
  reward_id: string;
  beneficiary_id: string;
  amount_kobo: number;
  hold_reason: string;
  risk_score: number;
  flagged_by_rule: string | null;
  status: 'held' | 'approved' | 'rejected';
  created_at: string;
}

export interface CompliancePolicy {
  jurisdiction: string;
  pyramid_line_enforced: boolean; // no earnings on recruitment alone
  activity_based_only: boolean;
  max_downline_depth: number;
  tier_caps: { tier: string; monthly_cap_kobo: number; override_pct: number }[];
  jurisdiction_toggles: { region: string; program_enabled: boolean; note: string }[];
  updated_at: string;
}

export interface Disclosure {
  id: string;
  title: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  effective_date: string;
  acceptance_rate: number; // 0..1
  required: boolean;
  updated_at: string;
}

export interface AmlAlert {
  id: string;
  subject_id: string;
  pattern: string; // structuring | layering | velocity | sanctioned
  amount_kobo: number;
  severity: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'cleared' | 'reported';
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  user_id: string;
  consent_type: string; // marketing | data_share | referral_terms | profiling
  granted: boolean;
  version: string;
  retention_until: string;
  source: string;
  updated_at: string;
}

export interface ReferralUserSummary {
  id: string;
  name: string;
  roles: string[]; // referrer | ambassador | agent | merchant
  status: 'active' | 'suspended' | 'restricted';
  total_earned_kobo: number;
  referrals_count: number;
  risk_score: number; // 0..100
  created_at: string;
}
export interface ReferralUser360 {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  status: 'active' | 'suspended' | 'restricted';
  kyc_tier: string;
  risk_score: number;
  total_earned_kobo: number;
  pending_kobo: number;
  clawed_back_kobo: number;
  referrals_count: number;
  active_referrals: number;
  referrals: { id: string; user_id: string; state: string; reward_kobo: number; created_at: string }[];
  earnings: { id: string; kind: string; state: string; amount_kobo: number; created_at: string }[];
  audit: { ts: string; actor: string; action: string }[];
  created_at: string;
}
export type InterventionAction = 'adjust' | 'suspend' | 'reverse' | 're_verify';
export interface InterveneInput {
  user_id: string;
  action: InterventionAction;
  amount_kobo?: number;
  reason: string;
}

/**
 * gamification.Mission (backend/internal/referral/gamification/service.go:186)
 * as GET /api/referral/admin/gamification/missions answers it.
 *
 * Go gives title / description / mission_type / target_count / points_reward /
 * cash_reward_kobo / is_active / starts_at / ends_at. It counts NO participants
 * and NO completions, and `is_active` cannot tell a draft from an ended
 * mission, so those three stay absent — a 0/0 in the Completions column reads
 * as "nobody has finished this" when the truth is "the route never counted".
 */
export interface MissionAdmin {
  id: string;
  name: string;
  condition: string; // e.g. "refer 5 KYC-verified users"
  points_reward: number; // non-cash
  status?: 'draft' | 'active' | 'ended';
  participants?: number;
  completions?: number;
  starts_at?: string;
  ends_at?: string | null;
}

/**
 * gamification.Rank (service.go:212): id / slug / name / tier_order /
 * min_points / perks. perks is a structured JSON object in the row rather than
 * a sentence, and no route names a badge or counts holders.
 */
export interface RankAdmin {
  id: string;
  name: string;
  threshold_points: number;
  tier_order?: number;
  badge?: string;
  perks?: string;
  holders?: number;
}

/**
 * There is NO admin leaderboard route: gamification/handlers.go:36 mounts GET
 * /gamification/leaderboard on the MEMBER group only (the caller's own board),
 * and the admin group registers missions, ranks and contests. listLeaderboards
 * therefore refuses rather than rendering a board nobody asked the backend
 * about, and the gamification page shows the KPI as not reported.
 */
export interface LeaderboardConfig {
  id: string;
  name: string;
  scope: string; // global | regional | campaign
  metric: string; // points | referrals | activations
  reset_cycle: 'daily' | 'weekly' | 'monthly' | 'seasonal';
  prize: string; // non-cash perk or recognition
  status: 'active' | 'paused';
}

/**
 * gamification.Contest (service.go:242): id / slug / title / status /
 * starts_at / ends_at / prize_config. prize_config is a structured pool
 * definition, not a display string, and nothing counts participants.
 */
export interface ContestAdmin {
  id: string;
  name: string;
  starts_at?: string;
  ends_at?: string | null;
  participants?: number;
  status: 'scheduled' | 'active' | 'ended' | string;
  prize?: string;
}

/**
 * What the analytics KPI strip can actually show.
 *
 * backend/internal/referral/analytics/service.go:142-148 registers SIX leaf
 * routes (/k-factor, /funnel, /cac, /cohorts, /channels, /segmentation) and NO
 * aggregate endpoint, so the console composes the two that answer these KPIs.
 * share_rate, invite-accept, blended CAC, an incl-house K-factor and a 14-day
 * trend have no source anywhere in that package — they are absent here, and the
 * page says so instead of printing 0.00 on a growth screen or drawing an empty
 * chart that reads as "flat".
 */
export interface AnalyticsOverview {
  // A-BI-01 true K-factor EXCLUDES house captures (§7A.6)
  k_factor?: number;
  k_factor_incl_house?: number;
  share_rate?: number; // 0..1
  invite_accept_rate?: number; // 0..1
  // A-BI-03 CAC vs paid
  referral_cac_kobo?: number;
  paid_cac_kobo?: number;
  blended_cac_kobo?: number;
  trend?: { date: string; k_factor: number; referral_cac_kobo: number; paid_cac_kobo: number }[];
  // The denominators the same two routes answer, shown next to the ratios.
  referrers?: number;
  referred_signups?: number;
  house_signups?: number;
  referral_spend_kobo?: number;
}

// A-BI-02 acquisition funnel: invite→click→signup→KYC→activate→retain
export interface FunnelData {
  stages: { stage: string; count: number }[];
  conversion_overall: number; // 0..1
}

// A-BI-08 organic vs referred segmentation (house_default split out)
export interface SegmentationData {
  referred_signups: number;
  house_default_signups: number; // organic — excluded from K-factor
  paid_signups: number;
  k_factor_true: number; // excludes house
  k_factor_naive_incl_house: number;
  segments: {
    segment: 'referred' | 'house_default' | 'paid';
    label: string;
    signups: number;
    activated: number;
    cac_kobo: number;
    counts_toward_kfactor: boolean;
  }[];
}

export interface Ambassador {
  id: string;
  name: string;
  tier: string; // Ambassador | Agent
  status: 'active' | 'suspended' | 'restricted';
  network_size: number;
  total_earned_kobo: number;
  override_earned_kobo: number;
  joined_at: string;
}

export interface AmbassadorApplication {
  id: string;
  applicant_id: string;
  applicant_name: string;
  requested_tier: string;
  reach: string; // social reach / context
  kyc_status: 'pending' | 'verified' | 'failed';
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
}

export interface AgentNetwork {
  id: string;
  agent_id: string;
  agent_name: string;
  depth: number;
  downline_count: number;
  max_depth_cap: number;
  verified_activity_kobo: number;
  override_paid_kobo: number;
}

export interface OverridePolicy {
  activity_based_only: boolean; // no earning on recruitment alone
  max_depth: number;
  override_pct_by_tier: { tier: string; pct: number; monthly_cap_kobo: number }[];
  recruitment_earnings_blocked: boolean;
  house_excluded_from_overrides: boolean; // §7A.2
  updated_at: string;
}

export type MerchantStatus = 'onboarding' | 'active' | 'suspended' | 'rejected';
export interface MerchantSummary {
  id: string;
  name: string;
  /**
   * merchant.Merchant (service.go:258) is id/name/slug/status/owner/created_at.
   * These five come from a different surface than the list route, so the table
   * leaves them unset rather than showing a category or a take rate invented
   * client-side.
   */
  category?: string;
  status: MerchantStatus;
  kyc_status?: 'pending' | 'verified' | 'failed';
  campaigns?: number;
  funded_kobo?: number;
  take_rate_pct?: number;
  joined_at: string;
}
export interface MerchantDetail extends MerchantSummary {
  /**
   * merchant.Handler.Get answers the Merchant struct alone (handlers.go:183 →
   * service.go:258: id/name/slug/status/owner/funding wallet/created_at). The
   * campaigns and partner keys come from their sibling routes (/:id/campaigns,
   * /:id/keys), and everything below them is a column no admin route serves, so
   * the profile card dashes it instead of filling it in.
   */
  contact_email?: string;
  contact_phone?: string;
  api_key_active: boolean;
  revenue_share_pct?: number;
  outstanding_balance_kobo: number;
  campaign_list: { id: string; name: string; status: string; funded_kobo: number; spent_kobo: number }[];
  /** No invoice route exists under /api/referral/admin/merchants — absent, not empty. */
  invoices?: { id: string; period: string; amount_kobo: number; status: 'paid' | 'due' | 'overdue' }[];
  /** Same: the console has no merchant audit endpoint to read. */
  audit?: { ts: string; actor: string; action: string }[];
}
