// ── Types — Platform SUPER-ADMIN console for the EdTech module (SU-01..SU-12) ──
// Platform-operator surface (Paymax staff), RBAC capability `platform_edtech_admin`.
// This is DISTINCT from any school-level role (school_owner / bursar / class_teacher
// / head_teacher). A school role has ZERO visibility here — see the RBAC note in
// platformEdtechAdminService.ts and the nav gate in AdminSidebar.tsx.
//
// All money is integer minor units (kobo) per CLAUDE.md iron rules. Render in ₦.

export type VerificationTier = 'unverified' | 'basic' | 'verified' | 'premium';
export type SchoolStatus = 'draft' | 'active' | 'suspended' | 'closed';

// SU-01 — Platform School Directory
export interface PlatformSchool {
  id: string;
  name: string;
  state: string;
  owner_identity_id: string;
  verification_tier: VerificationTier;
  status: SchoolStatus;
  students: number;
  gmv_kobo: number;              // lifetime collections through the platform
  trust_score: number;          // 0..100 (see SU-07)
  gov_sync_opt_in: boolean;
  created_at: string;
}

// SU-02 — School Verification Queue
export type VerificationDecision = 'approve' | 'reject';
export interface VerificationSubmission {
  id: string;
  school_id: string;
  school_name: string;
  requested_tier: VerificationTier;
  cac_number: string;
  cac_doc_url: string;
  references: { name: string; role: string; phone: string }[];
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewer?: string;
  decided_at?: string;
  reason?: string;
}
export interface VerificationReviewInput {
  id: string;
  decision: VerificationDecision;
  granted_tier?: VerificationTier;  // when approving
  reason: string;                   // audited — required for both approve and reject
}

// SU-03 — Platform-Wide Collections Dashboard
export interface CollectionsOverview {
  gmv_kobo: number;
  gmv_today_kobo: number;
  active_schools: number;
  invoices_issued: number;
  invoices_paid: number;
  collection_rate: number;          // 0..1
  reconciliation: {
    matched: number;
    pending: number;
    drift_flagged: number;          // SF-8 nightly recon drift
    last_run_at: string;
  };
  gmv_trend: { date: string; value_kobo: number }[];
  top_schools: { school_id: string; name: string; gmv_kobo: number }[];
}

// SU-04 — Fraud & Risk Queue
export type RiskKind = 'anomalous_payment' | 'disputed_promotion' | 'chargeback';
export type RiskStatus = 'open' | 'investigating' | 'actioned' | 'dismissed';
export interface RiskCase {
  id: string;
  kind: RiskKind;
  school_id: string;
  school_name: string;
  severity: 'low' | 'high' | 'critical';
  amount_kobo?: number;
  summary: string;
  opened_at: string;
  status: RiskStatus;
}
export interface RiskActionInput { id: string; status: RiskStatus; note: string; }

// SU-05 — Gov / Regulator Sync Oversight (+ SU-11 audit log; ComplianceExport SF-11)
export interface GovSyncRow {
  school_id: string;
  school_name: string;
  opted_in: boolean;
  data_categories: string[];        // per-category opt-in (SF-11)
  regulator: string;
  last_export_at: string | null;
  export_count: number;
}
export interface ComplianceExportLog {
  id: string;
  school_id: string;
  school_name: string;
  report_type: string;
  period: string;
  data_categories: string[];
  regulator: string;
  generated_at: string;
  generated_by: string;
  immutable_hash: string;           // append-only integrity anchor
}

// SU-11 — Platform Audit Log Viewer (SF-11 immutable trail across every entity)
export interface AuditLogEntry {
  id: string;
  module: string;                   // e.g. 'academy.fees'
  entity: string;                   // invoice / promotion / vault / school ...
  entity_id: string;
  action: string;                   // issued / approved / waived / reversed ...
  actor: string;
  actor_role: string;
  school_id?: string;
  at: string;
  immutable_hash: string;
  metadata?: Record<string, unknown>;
}

// SU-06 — Competition & Tournament Ops (E12 — Schools Cup production pipeline)
export type CompetitionStatus =
  | 'draft' | 'open_registration' | 'registration_closed'
  | 'in_progress' | 'results_pending' | 'completed' | 'archived';
export interface Competition {
  id: string;
  name: string;
  scope: 'class' | 'school' | 'city' | 'state' | 'national';
  status: CompetitionStatus;
  participating_schools: number;
  sponsor?: string;
  start_date: string;
  end_date: string;
  broadcast_ready: boolean;         // E12 broadcast-export gate
}
export interface CompetitionTransitionInput { id: string; to: CompetitionStatus; note: string; }
export const COMPETITION_FLOW: CompetitionStatus[] = [
  'draft', 'open_registration', 'registration_closed',
  'in_progress', 'results_pending', 'completed', 'archived',
];

// SU-07 — School Trust Score Admin
export interface TrustScoreRow {
  school_id: string;
  school_name: string;
  score: number;                    // 0..100
  components: { label: string; weight: number; value: number }[];
  overridden: boolean;
  override_reason?: string;
  updated_at: string;
}
export interface TrustScoreOverrideInput { school_id: string; score: number; reason: string; }

// SU-08 — Sponsor & Scholarship Oversight (fund-flow audit)
export type PledgeStatus = 'pledged' | 'funded' | 'disbursed' | 'refunded' | 'cancelled';
export interface ScholarshipPledge {
  id: string;
  sponsor: string;
  sponsor_identity_id: string;
  target_student_ref: string;       // minor-safe: ref, not PII (SF-7)
  school_name: string;
  amount_kobo: number;
  status: PledgeStatus;
  ledger_ref: string;               // every leg posts to the finance ledger
  created_at: string;
}

// SU-09 — Support Ticket Queue
export type TicketStatus = 'open' | 'in_review' | 'resolved' | 'escalated';
export interface SupportTicket {
  id: string;
  subject: string;
  origin: 'school_admin' | 'parent';
  school_name: string;
  priority: 'low' | 'high' | 'critical';
  status: TicketStatus;
  opened_at: string;
  last_update_at: string;
}
export interface TicketActionInput { id: string; status: TicketStatus; note: string; }

// SU-10 — Feature Flag & Tenant Config
export type FlagScopeType = 'global' | 'school' | 'region' | 'tier';
export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  scope_type: FlagScopeType;
  scope_ref: string;                // school id / region / tier ('' for global)
  enabled: boolean;
  updated_at: string;
}
export interface FlagToggleInput { key: string; scope_type: FlagScopeType; scope_ref: string; enabled: boolean; }

// SU-12 — Compliance & Licensing Dashboard (Model-A-only posture; §4)
export type DriftSeverity = 'ok' | 'warn' | 'critical';
export interface CompliancePosture {
  model_a_only: boolean;            // must stay true — Paymax never fronts fees
  bnpl_rail_repurposed: boolean;    // hard flag: BNPL rail advancing fees = factoring drift
  license_category: string;
  last_reviewed_at: string;
  drift_signals: {
    id: string;
    school_name: string;
    signal: string;                 // human description of the suspicious structure
    severity: DriftSeverity;
    detected_at: string;
  }[];
}
