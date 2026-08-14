// ── Types — Paymax Health admin · Laboratory vertical (HEALTH-BUILD Phase 2 ADM) ──
// Parallel to healthAdmin.ts (Pharmacy P1) — do NOT edit that file; this owns Lab.
// Money is BIGINT kobo (minor units) throughout — formatNaira() converts kobo → ₦.
// Surfaces the HEALTH invariants the Lab vertical enforces (HEALTH-BUILD §4 / §7B):
//  HL-2 credential-gated supply (MLSCN lab + scientist licences; auto-suspend on expiry) ·
//  HL-6 chain-of-custody integrity (collection→accession; any break → recollect; no result
//        without an unbroken chain) ·
//  HL-7 critical-result human escalation (abnormal/critical values → defined human path; never silent) ·
//  HL-8 health data = sensitive NDPA (consent, masking, access-controlled result release) ·
//  HL-9 money held→released→refunded (escrow released on result release / fulfilment) ·
//  HL-10 payout KYC + AML gate · HL-12 immutable audit on every state transition.
//
// LabOrder state machine (HEALTH-RECONCILE §4):
//  CREATED→SCHEDULED→SAMPLE_COLLECTED→IN_TRANSIT→ACCESSIONED→PROCESSING→RESULT_READY→RELEASED→CLOSED
//  RESULT_READY(critical)→ESCALATED→RELEASED
// Sample/Custody: COLLECTED→IN_CUSTODY→HANDED_OVER→ACCESSIONED; break→BREACHED→RECOLLECT_REQUIRED.

// ── A · Dashboard ─────────────────────────────────────────────────────────────
export type LabActivity = {
  id: string;
  kind: string; // mlscn_approved | custody_breach | result_released | critical_escalated | catalog_governed | payout_held ...
  label: string;
  ref?: string | null;
  created_at: string;
};

export type LabDashboard = {
  generated_at: string;
  orders_today: number;
  orders_30d: number;
  gmv_today_kobo: number;
  gmv_30d_kobo: number;
  net_revenue_30d_kobo: number;
  take_rate: number;
  avg_order_value_kobo: number;
  // Turnaround time (TAT) — collection → result release, the core lab SLA
  tat_median_hours: number;
  tat_target_hours: number;
  tat_breaches: number; // orders over TAT target
  // HL-7 critical-result escalation
  critical_results_open: number;
  critical_results_30d: number;
  escalation_sla_minutes: number; // median time to human acknowledgement
  escalation_sla_target_minutes: number;
  // HL-6 chain-of-custody
  custody_breaks_open: number; // unbroken-chain violations awaiting recollection
  custody_breaks_30d: number;
  samples_in_transit: number;
  recollections_required: number;
  // HL-2 credential gating
  mlscn_pending_review: number;
  catalog_pending_governance: number;
  // HL-8 results audit / release
  results_pending_release: number;
  results_released_30d: number;
  // HL-10 payouts
  payouts_kyc_hold: number;
  // HL-9 escrow
  held_balance_kobo: number;
  released_30d_kobo: number;
  refunded_30d_kobo: number;
  labs_active: number;
  labs_suspended: number;
  phlebotomists_active: number;
  order_mix: { label: string; orders: number; gmv_kobo: number; share_pct: number }[];
  tat_trend: { date: string; tat_hours: number }[];
  activity: LabActivity[];
};

// ── B · MLSCN credential audit queue (HL-2) ────────────────────────────────────
export type MlscnApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'approved'
  | 'suspended'
  | 'rejected';

export type MlscnCredentialDoc = {
  kind: string; // MLSCN_lab_licence | lab_scientist_licence | CAC | facility_photo | equipment_cert
  reference: string;
  expires_at?: string | null;
  verified: boolean;
};

export type MlscnApplication = {
  id: string;
  lab_name: string;
  lab_scientist_masked: string; // registered medical laboratory scientist (NDPA — masked)
  mlscn_lab_no: string; // MLSCN facility / laboratory registration number
  mlscn_scientist_no: string; // MLSCN medical laboratory scientist licence number
  cac_rc_no: string;
  state: string;
  lga: string;
  status: MlscnApplicationStatus;
  lab_verified: boolean; // MLSCN facility licence check passed
  scientist_verified: boolean; // MLSCN scientist licence check passed
  licence_expires_at: string | null; // earliest expiry — drives auto-suspend (HL-2)
  docs: MlscnCredentialDoc[];
  submitted_at: string | null;
  created_at: string;
};

export type MlscnDecision = 'approve' | 'reject' | 'need_info' | 'suspend' | 'reinstate';

export type MlscnDecisionResult = {
  id: string;
  status: MlscnApplicationStatus;
  capability_granted: boolean; // on approve: idempotent provider capability grant
  audit_id: string;
  message: string;
};

// ── C · Test catalog governance ────────────────────────────────────────────────
export type LabCatalogStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type LabCatalogItem = {
  id: string;
  test_name: string;
  loinc_code: string | null; // LOINC mapping — null ⇒ flag for governance
  category: string; // haematology | chemistry | microbiology | serology | molecular | panel
  is_package: boolean; // health package vs single test
  specimen: string; // blood | urine | swab | stool ...
  prep_required: string; // e.g. "Fasting 8–12h" | "None"
  tat_hours: number; // turnaround target
  lab_masked: string;
  price_kobo: number;
  status: LabCatalogStatus;
  flagged_reason: string | null;
  created_at: string;
};

export type LabCatalogGovernanceAction = 'approve' | 'reject' | 'suspend';

export type LabCatalogGovernanceResult = {
  id: string;
  status: LabCatalogStatus;
  audit_id: string;
  message: string;
};

// ── D · Chain-of-custody oversight (HL-6) ──────────────────────────────────────
export type CustodyStatus =
  | 'collected'
  | 'in_custody'
  | 'handed_over'
  | 'accessioned'
  | 'breached'
  | 'recollect_required';

export type CustodyEvent = {
  id: string;
  step: string; // COLLECTED | IN_CUSTODY | HANDED_OVER | ACCESSIONED | BREACHED | RECOLLECT_REQUIRED
  label: string;
  actor_masked: string;
  location: string;
  temperature_c: number | null; // cold-chain reading where applicable
  seal_intact: boolean;
  audit_id: string;
  at: string;
};

export type CustodySample = {
  id: string;
  order_ref: string;
  patient_masked: string; // NDPA masked (HL-8)
  test_summary: string;
  lab_masked: string;
  phlebotomist_masked: string;
  status: CustodyStatus;
  chain_intact: boolean; // HL-6 — false forces recollection; no result without unbroken chain
  break_reason: string | null;
  collected_at: string;
  updated_at: string;
};

export type CustodyChain = CustodySample & {
  events: CustodyEvent[];
};

export type CustodyBreakResult = {
  id: string;
  status: CustodyStatus;
  chain_intact: boolean;
  recollect_order_ref: string | null;
  audit_id: string;
  message: string;
};

// ── E · Results audit & release controls (HL-8) ────────────────────────────────
export type ResultStatus =
  | 'processing'
  | 'result_ready'
  | 'escalated'
  | 'released'
  | 'amended';

export type ResultAuditItem = {
  id: string;
  order_ref: string;
  patient_masked: string; // NDPA masked subject (HL-8)
  test_summary: string;
  lab_masked: string;
  scientist_masked: string | null; // signing medical laboratory scientist
  status: ResultStatus;
  abnormal_flag: 'normal' | 'abnormal' | 'critical';
  chain_intact: boolean; // HL-6 — no release on a broken chain
  signed_off: boolean; // scientist sign-off before release
  consent_on_file: boolean; // NDPA consent (HL-8) gates release to vault
  tat_hours: number | null;
  released_at: string | null;
  created_at: string;
};

export type ResultReleaseAction = 'release' | 'hold' | 'amend';

export type ResultReleaseResult = {
  id: string;
  status: ResultStatus;
  audit_id: string;
  message: string;
};

// ── F · Critical-result escalation queue (HL-7) ────────────────────────────────
export type EscalationStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';
export type EscalationSeverity = 'high' | 'critical';

export type Escalation = {
  id: string;
  order_ref: string;
  result_ref: string;
  patient_masked: string;
  test_summary: string;
  abnormal_value: string; // e.g. "Potassium 7.2 mmol/L (crit > 6.0)"
  severity: EscalationSeverity;
  status: EscalationStatus;
  lab_masked: string;
  scientist_masked: string | null;
  escalated_to_masked: string | null; // human owner of the escalation path (HL-7 — never silent)
  acknowledged_at: string | null;
  sla_minutes: number; // time-to-acknowledge target
  minutes_elapsed: number;
  created_at: string;
};

export type EscalationResolveAction = 'acknowledge' | 'resolve' | 'close';

export type EscalationResolveResult = {
  id: string;
  status: EscalationStatus;
  audit_id: string;
  message: string;
};

// ── G · Phlebotomist management ────────────────────────────────────────────────
export type PhlebotomistStatus = 'active' | 'pending' | 'suspended' | 'expired';

export type Phlebotomist = {
  id: string;
  name_masked: string;
  licence_no: string; // MLSCN / professional certification reference
  licence_expires_at: string | null;
  state: string;
  lga: string;
  status: PhlebotomistStatus;
  kyc_tier: string; // tier0..tier3
  kyc_verified: boolean;
  collections_30d: number;
  custody_breaks_30d: number; // HL-6 — quality signal
  rating: number; // 0..5
  created_at: string;
};

// ── H · Payouts (KYC-gated — HL-10) ────────────────────────────────────────────
export type LabPayoutStatus = 'pending' | 'approved' | 'paid' | 'kyc_hold' | 'rejected';

export type LabPayoutRecord = {
  id: string;
  lab_masked: string;
  kyc_tier: string; // tier0..tier3
  kyc_verified: boolean;
  collected_kobo: number; // released-to-provider gross over period (HL-9)
  fees_kobo: number;
  net_payable_kobo: number;
  payout_status: LabPayoutStatus;
  aml_flag: boolean; // AML check on settlement (HL-10)
  created_at: string;
};

export type LabPayoutDecision = 'approve' | 'reject';

export type LabPayoutDecisionResult = {
  id: string;
  payout_status: LabPayoutStatus;
  audit_id: string;
  message: string;
};

// ── I · Reporting ──────────────────────────────────────────────────────────────
export type LabReportingData = {
  generated_at: string;
  period_label: string;
  gmv_kobo: number;
  net_revenue_kobo: number;
  orders: number;
  home_collection_orders: number;
  walk_in_orders: number;
  refund_rate: number;
  tat_median_hours: number;
  tat_breach_rate: number; // share of orders over TAT
  custody_break_rate: number; // HL-6 — share of samples with a chain break
  critical_results: number; // HL-7
  critical_escalation_compliance: number; // share acknowledged within SLA
  payouts_kyc_hold: number; // HL-10
  by_state: { state: string; orders: number; gmv_kobo: number; share_pct: number }[];
  monthly: { month: string; gmv_kobo: number; net_kobo: number; orders: number }[];
};
