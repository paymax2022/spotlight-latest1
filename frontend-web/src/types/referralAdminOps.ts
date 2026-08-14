// ── Referral Admin OPS types (RA2) ───────────────────────────────────────────
// Finance/Payouts, Risk/Fraud, Compliance, Users/Graph, Gamification,
// Analytics/BI, Ambassadors/Agents, Merchants/Partners.
// PRD §8B (A-FIN / A-RSK / A-CMPL / A-USR / A-GAM / A-BI / A-AMB / A-MER) + §7A.6.
// All money is BIGINT kobo (integer minor units). Never floats for math.

// ── A-FIN-01: Payout queue & approvals ───────────────────────────────────────
export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'on_hold';
export interface Payout {
  id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  wallet_id: string;
  reward_ids: string[];
  amount_kobo: number;
  currency: string;
  status: PayoutStatus;
  risk_flag: 'low' | 'normal' | 'high' | 'critical';
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  idempotency_key: string;
}

// ── A-FIN-02: Reconciliation (reward ledger ↔ wallet/payout) ──────────────────
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

// ── A-FIN-03: Budget & burn monitoring + A-FIN-04 reward-to-LTV ───────────────
export interface BudgetLine {
  scope: string; // campaign / program / vertical
  budget_kobo: number;
  spent_kobo: number;
  burn_rate_kobo_per_day: number;
  projected_exhaust_date: string | null;
  alert: 'ok' | 'warn' | 'breach';
}
export interface BudgetBurn {
  as_of: string;
  program_budget_kobo: number;
  program_spent_kobo: number;
  reward_to_ltv_ratio: number; // 0..1 (A-FIN-04)
  reward_to_ltv_cap_pct: number;
  lines: BudgetLine[];
  trend: { date: string; spent_kobo: number }[];
}

// ── A-FIN-05: Float management ───────────────────────────────────────────────
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

// ── A-RSK-01: Fraud dashboard ────────────────────────────────────────────────
export interface RiskAlert {
  id: string;
  kind: string; // velocity | device_farm | kyc_dup | self_referral | burn_spike
  severity: 'low' | 'normal' | 'high' | 'critical';
  subject_id: string;
  detail: string;
  amount_at_risk_kobo: number;
  created_at: string;
}
export interface RiskDashboard {
  fraud_rate: number; // 0..1
  open_cases: number;
  amount_at_risk_kobo: number;
  blocked_24h: number;
  clawbacks_30d_kobo: number;
  alerts: RiskAlert[];
  burn_anomaly_trend: { date: string; expected_kobo: number; actual_kobo: number }[];
}

// ── A-RSK-02: Rules engine ───────────────────────────────────────────────────
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

// ── A-RSK-03: Investigation workbench (case) ─────────────────────────────────
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

// ── A-RSK-04: Blocklists / allowlists ────────────────────────────────────────
export interface BlocklistEntry {
  id: string;
  type: 'device' | 'identity' | 'account' | 'bank';
  list: 'block' | 'allow';
  value: string;
  reason: string;
  added_by: string;
  created_at: string;
}

// ── A-RSK-05: Clawback execution & history ───────────────────────────────────
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

// ── A-RSK-07: Manual review queue ────────────────────────────────────────────
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

// ── A-CMPL-01: Pyramid-line & tier-cap policy ────────────────────────────────
export interface CompliancePolicy {
  jurisdiction: string;
  pyramid_line_enforced: boolean; // no earnings on recruitment alone
  activity_based_only: boolean;
  max_downline_depth: number;
  tier_caps: { tier: string; monthly_cap_kobo: number; override_pct: number }[];
  jurisdiction_toggles: { region: string; program_enabled: boolean; note: string }[];
  updated_at: string;
}

// ── A-CMPL-02: Disclosure / T&Cs versioning ──────────────────────────────────
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

// ── A-CMPL-03: AML monitoring (reward-linked txn surveillance) ────────────────
export interface AmlAlert {
  id: string;
  subject_id: string;
  pattern: string; // structuring | layering | velocity | sanctioned
  amount_kobo: number;
  severity: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'cleared' | 'reported';
  created_at: string;
}

// ── A-CMPL-05: Consent / data management (NDPC) ──────────────────────────────
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

// ── A-USR-01..04: User 360 (referral) ────────────────────────────────────────
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

// ── A-GAM-01: Mission / quest builder ────────────────────────────────────────
export interface MissionAdmin {
  id: string;
  name: string;
  condition: string; // e.g. "refer 5 KYC-verified users"
  points_reward: number; // non-cash
  status: 'draft' | 'active' | 'ended';
  participants: number;
  completions: number;
  starts_at: string;
  ends_at: string | null;
}

// ── A-GAM-02: Tier / rank / badge config ─────────────────────────────────────
export interface RankAdmin {
  id: string;
  name: string;
  threshold_points: number;
  badge: string;
  perks: string;
  holders: number;
}

// ── A-GAM-03: Leaderboard config ─────────────────────────────────────────────
export interface LeaderboardConfig {
  id: string;
  name: string;
  scope: string; // global | regional | campaign
  metric: string; // points | referrals | activations
  reset_cycle: 'daily' | 'weekly' | 'monthly' | 'seasonal';
  prize: string; // non-cash perk or recognition
  status: 'active' | 'paused';
}

// ── A-GAM-04: Contest / challenge management ─────────────────────────────────
export interface ContestAdmin {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  participants: number;
  status: 'scheduled' | 'active' | 'ended';
  prize: string;
}

// ── A-BI: Analytics / growth ─────────────────────────────────────────────────
export interface AnalyticsOverview {
  // A-BI-01 true K-factor EXCLUDES house captures (§7A.6)
  k_factor: number;
  k_factor_incl_house: number;
  share_rate: number; // 0..1
  invite_accept_rate: number; // 0..1
  // A-BI-03 CAC vs paid
  referral_cac_kobo: number;
  paid_cac_kobo: number;
  blended_cac_kobo: number;
  trend: { date: string; k_factor: number; referral_cac_kobo: number; paid_cac_kobo: number }[];
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

// ── A-AMB-01: Ambassador directory & tiers ───────────────────────────────────
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

// ── A-AMB-02: Application / approval queue ────────────────────────────────────
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

// ── A-AMB-03: Agent network management ───────────────────────────────────────
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

// ── A-AMB-04: Override policy config (activity-based + caps) ──────────────────
export interface OverridePolicy {
  activity_based_only: boolean; // no earning on recruitment alone
  max_depth: number;
  override_pct_by_tier: { tier: string; pct: number; monthly_cap_kobo: number }[];
  recruitment_earnings_blocked: boolean;
  house_excluded_from_overrides: boolean; // §7A.2
  updated_at: string;
}

// ── A-MER-01: Partner directory & onboarding ─────────────────────────────────
export type MerchantStatus = 'onboarding' | 'active' | 'suspended' | 'rejected';
export interface MerchantSummary {
  id: string;
  name: string;
  category: string;
  status: MerchantStatus;
  kyc_status: 'pending' | 'verified' | 'failed';
  campaigns: number;
  funded_kobo: number;
  take_rate_pct: number;
  joined_at: string;
}
export interface MerchantDetail extends MerchantSummary {
  contact_email: string;
  contact_phone: string;
  api_key_active: boolean;
  revenue_share_pct: number;
  outstanding_balance_kobo: number;
  campaign_list: { id: string; name: string; status: string; funded_kobo: number; spent_kobo: number }[];
  invoices: { id: string; period: string; amount_kobo: number; status: 'paid' | 'due' | 'overdue' }[];
  audit: { ts: string; actor: string; action: string }[];
}
