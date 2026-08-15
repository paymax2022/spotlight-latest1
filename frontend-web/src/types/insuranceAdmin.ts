// ── Admin — Paymax Insurance (micro-insurance) types ─────────────────────────
// Field names mirror the Go JSON (snake_case) from /api/insurance/admin/*.
// Money is BIGINT kobo (minor units) throughout. Underwriter + aggregator are
// always disclosed (PRD §13/§18).

export type Provider = 'mycover' | 'octamile';
export type BindingMode = 'embedded' | 'voluntary';
export type PremiumModel = 'one_off' | 'recurring' | 'per_event';

export type ProductLine =
  | 'wallet_protection' | 'health' | 'personal_accident' | 'credit_life' | 'device'
  | 'sme' | 'spotlight_event' | 'ride_hailing' | 'logistics' | 'parcel' | 'bus'
  | 'motor' | 'git' | 'driver_protection' | 'passenger_protection';

// ── Dashboard (§15.4) ────────────────────────────────────────────────────────
export interface InsuranceDashboardActivity {
  id: string;
  kind: string;        // bind_succeeded | claim_settled | reconciliation_break | renewal_due | bind_failed …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface ProviderHealth {
  provider: Provider;
  underwriter: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime_pct: number;
  quote_p95_ms: number;
  webhook_lag_s: number;
  open_breaks: number;
}
export interface InsuranceDashboard {
  gwp_today_kobo: number;          // gross written premium
  gwp_30d_kobo: number;
  policies_active: number;
  policies_bound_today: number;
  attach_rate: number;             // 0..1 — embedded attach on eligible events
  claims_ratio: number;            // 0..1 — incurred claims / earned premium
  claims_open: number;
  claims_settled_30d: number;
  premium_collected_30d_kobo: number;
  commission_earned_30d_kobo: number;
  reconciliation_breaks_open: number;
  reconciliation_break_value_kobo: number;
  refunds_pending: number;
  renewals_due_7d: number;
  provider_health: ProviderHealth[];
  premium_vs_commission: { date: string; premium_kobo: number; commission_kobo: number }[];
  activity: InsuranceDashboardActivity[];
}

// ── Catalog (§9.1, §6) ───────────────────────────────────────────────────────
export interface SumInsuredRule {
  min_kobo: number;
  max_kobo: number;
  default_kobo: number;
  step_kobo?: number;
}
export interface InsuranceProduct {
  code: string;
  name: string;
  product_line: ProductLine;
  provider: Provider;
  underwriter: string;             // NAICOM-licensed insurer (disclosed)
  provider_product_code: string;
  binding_mode: BindingMode;
  premium_model: PremiumModel;
  required_kyc_tier: number;       // 0..3
  sum_insured: SumInsuredRule;
  base_premium_kobo: number;
  commission_basis_pct: number;
  active: boolean;
  version: number;
  policies_active: number;
  updated_at: string;
  created_at: string;
}
export interface ProductVersionEntry {
  version: number;
  change: string;
  actor: string;
  created_at: string;
}
export interface InsuranceProductDetail extends InsuranceProduct {
  description: string;
  required_fields: string[];       // schema field keys this product collects
  consent_version: string;
  history: ProductVersionEntry[];
}
export type ProductUpsert = Partial<InsuranceProductDetail> & { code: string };

// ── Routing table (§6) ───────────────────────────────────────────────────────
export interface RoutingRule {
  id: string;
  product_line: ProductLine;
  provider: Provider;
  underwriter: string;
  binding_trigger: string;         // e.g. 'trip_start', 'wallet_funded', 'opt_in'
  enabled: boolean;
  priority: number;
  updated_at: string;
}

// ── Field schema editor (§6 / data minimisation) ─────────────────────────────
export interface SchemaField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum' | 'file';
  required: boolean;
  pii: boolean;                    // shared with provider only if product needs it
  product_lines: ProductLine[];
  enum_values?: string[];
}

// ── Policies (§9.2) ──────────────────────────────────────────────────────────
export type PolicyState =
  | 'quoted' | 'pending_payment' | 'binding' | 'active' | 'renewal_due'
  | 'lapsed' | 'cancelled' | 'expired' | 'bind_failed' | 'payment_failed' | 'void';

export interface PolicySummary {
  id: string;
  provider_policy_ref: string;
  policyholder_masked: string;     // PII masked
  policyholder_user_id: string;
  product_code: string;
  product_name: string;
  provider: Provider;
  underwriter: string;
  binding_mode: BindingMode;
  state: PolicyState;
  sum_insured_kobo: number;
  premium_kobo: number;
  effective_at: string | null;
  expires_at: string | null;
  created_at: string;
}
export interface PolicyTimelineEntry {
  at: string;
  state: string;
  actor: string;
  note?: string | null;
}
export interface PolicyPremiumTx {
  id: string;
  reference: string;
  amount_kobo: number;
  direction: 'DEBIT' | 'CREDIT';
  status: string;
  wallet_ledger_ref: string;
  created_at: string;
}
export interface PolicyDetail extends PolicySummary {
  capability_id: string;
  source_event_id: string | null;
  currency: string;
  version: number;
  beneficiaries: { id: string; name_masked: string; relationship: string; share_pct: number }[];
  premium_transactions: PolicyPremiumTx[];
  commission: { amount_kobo: number; basis: string; revenue_ledger_ref: string; reconciled: boolean } | null;
  consent: { version: string; granted_at: string; scope: string } | null;
  timeline: PolicyTimelineEntry[];
}

// ── Claims (§9.2, §10.2) ─────────────────────────────────────────────────────
export type ClaimState =
  | 'draft' | 'fnol_submitted' | 'under_assessment' | 'needs_more_info'
  | 'approved' | 'payout_pending' | 'settled' | 'rejected';

export interface ClaimSummary {
  id: string;
  provider_claim_ref: string;
  policy_id: string;
  product_name: string;
  provider: Provider;
  claimant_masked: string;
  state: ClaimState;
  claimed_amount_kobo: number;
  approved_amount_kobo: number;
  loss_event_at: string;
  reported_at: string;
  created_at: string;
}
export interface ClaimEvidence {
  id: string;
  kind: string;                    // photo | document | report
  label: string;
  signed_url_ref: string;          // access-controlled pointer (not raw URL)
  uploaded_at: string;
}
export interface ClaimTimelineEntry {
  at: string;
  state: string;
  actor: string;
  note?: string | null;
}
export interface ClaimDetail extends ClaimSummary {
  underwriter: string;
  payout_ledger_ref: string | null;
  sla_target_minutes: number | null;
  evidence: ClaimEvidence[];
  timeline: ClaimTimelineEntry[];
  notes: string | null;
}

// ── Finance: premiums / commission / reconciliation / refunds (§17) ──────────
export interface PremiumTransaction {
  id: string;
  reference: string;
  policy_id: string;
  provider: Provider;
  amount_kobo: number;
  direction: 'DEBIT' | 'CREDIT';
  status: string;
  idempotency_key: string;
  provider_remittance_ref: string | null;
  reconciled: boolean;
  created_at: string;
}
export interface CommissionEntry {
  id: string;
  policy_id: string;
  premium_transaction_id: string;
  provider: Provider;
  commission_amount_kobo: number;
  commission_basis: string;
  revenue_ledger_ref: string;
  reconciled: boolean;
  reversed: boolean;
  created_at: string;
}
export type BreakStatus = 'open' | 'investigating' | 'resolved';
export interface ReconciliationBreak {
  id: string;
  provider: Provider;
  break_type: 'premium' | 'commission' | 'claim_payout';
  policy_id: string | null;
  paymax_amount_kobo: number;
  provider_amount_kobo: number;
  delta_kobo: number;
  status: BreakStatus;
  age_hours: number;
  sla_breached: boolean;
  detail: string;
  created_at: string;
}
export interface BreakResolution {
  id: string;
  status: BreakStatus;
  resolved_at: string;
}
export type RefundStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export interface RefundRequest {
  id: string;
  reference: string;
  policy_id: string;
  provider: Provider;
  reason: string;            // cooling_off | cancellation | bind_failed | duplicate
  amount_kobo: number;
  status: RefundStatus;
  policyholder_masked: string;
  requested_at: string;
}
export interface RefundDecision {
  id: string;
  status: RefundStatus;
  decided_at: string;
}

// ── Providers (§12, §15.4) ───────────────────────────────────────────────────
export interface ProviderConfig {
  provider: Provider;
  display_name: string;
  underwriters: string[];          // NAICOM-licensed insurers behind this rail
  base_url: string;
  api_key_masked: string;          // never raw
  webhook_secret_masked: string;
  webhook_url: string;
  signature_verified: boolean;
  sandbox: boolean;
  sla_quote_p95_ms: number;
  sla_claim_settle_minutes: number;
  status: 'healthy' | 'degraded' | 'down';
  product_lines: ProductLine[];
  updated_at: string;
}
export interface ProviderEvent {
  id: string;
  provider: Provider;
  event_type: string;
  external_event_id: string;
  signature_verified: boolean;
  processed: boolean;
  duplicate: boolean;              // dropped via unique (provider, external_event_id)
  payload_ref: string;
  received_at: string;
  processed_at: string | null;
}
export interface WebhookDelivery {
  id: string;
  provider: Provider;
  event_type: string;
  external_event_id: string;
  status: 'delivered' | 'failed' | 'pending';
  attempts: number;
  last_attempt_at: string;
  replayable: boolean;
}
export interface WebhookReplayResult {
  id: string;
  status: 'queued';
  queued_at: string;
}

// ── Ops: consent/audit · sweeps · reports (§18) ──────────────────────────────
export interface ConsentAuditEntry {
  id: string;
  policy_id: string | null;
  user_masked: string;
  consent_version: string;
  scope: string;                   // fields shared with provider
  provider: Provider;
  action: 'granted' | 'withdrawn' | 'data_shared' | 'erasure_requested';
  actor: string;
  created_at: string;
}
export interface SweepRun {
  id: string;
  kind: 'lapse' | 'renewal';
  status: 'completed' | 'running' | 'failed';
  scanned: number;
  affected: number;
  notified: number;
  errors: number;
  window: string;
  ran_at: string;
}
export interface SweepsMonitor {
  renewals_due_7d: number;
  renewals_due_30d: number;
  lapses_pending: number;
  next_run_at: string;
  recent_runs: SweepRun[];
}
export interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  category: 'finance' | 'compliance' | 'operations';
  formats: string[];               // csv | xlsx | pdf
  last_generated_at: string | null;
}
