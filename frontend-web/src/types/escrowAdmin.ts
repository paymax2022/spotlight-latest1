// ── Admin — Paymax Social P2P Escrow (dispute arbitration) ops console types ───
// Field names mirror the Go JSON (snake_case) from /api/p2p/admin/* (escrow).
// Money is BIGINT kobo (minor units) throughout — display via formatNaira (kobo → ₦).
// Invariants surfaced in the UI:
//   NL-6  — Escrow holds, never lends: funds sit in the buyer's held sub-balance and
//           release on confirmation or arbitration. Paymax never takes principal risk
//           and never funds the gap.
//   NL-10 — KYC gates & AML/velocity limits on escrow movements.
//   NL-12 — immutable audit on every dispute decision / state change.
// Separation of duties: the arbitrator deciding a dispute MUST differ from the
// payout/release approver (enforced fail-closed; surfaced in the console).

export type EscrowState = 'held' | 'released' | 'refunded' | 'disputed';
export type DisputeStatus = 'open' | 'in_review' | 'awaiting_evidence' | 'resolved_release' | 'resolved_refund';
export type ArbitrationDecision = 'release' | 'refund' | 'request_evidence' | 'assign';
export type EscrowFraudKind = 'mule_account' | 'structuring' | 'collusive_dispute' | 'rapid_release' | 'aml_threshold';
export type EscrowFraudStatus = 'open' | 'investigating' | 'cleared' | 'blocked';
export type EscrowFraudAction = 'investigate' | 'clear' | 'block';

// ── A · Dashboard / oversight ────────────────────────────────────────────────
export interface EscrowDashboardActivity {
  id: string;
  kind: string; // hold_created | released | refunded | dispute_opened | dispute_resolved | mule_flag …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface EscrowDashboard {
  total_held_kobo: number;        // current outstanding holds (liability)
  held_count: number;
  released_30d_kobo: number;
  released_30d_count: number;
  refunded_30d_kobo: number;
  refunded_30d_count: number;
  disputed_open_kobo: number;
  disputed_open_count: number;
  ledger_held_kobo: number;       // ledger projection of held balance (NL-8)
  custody_balance_kobo: number;   // custodial account balance
  delta_kobo: number;             // recon delta — should be 0
  avg_resolution_hours: number;
  dispute_release_rate: number;   // share resolved in seller's favour
  fraud_open: number;
  state_mix: { state: EscrowState; count: number; value_kobo: number }[];
  resolution_trend: { date: string; opened: number; resolved: number }[];
  activity: EscrowDashboardActivity[];
}

// ── B · Disputes list + detail (arbitration console) ─────────────────────────
export interface DisputeListItem {
  id: string;
  escrow_id: string;
  listing_title: string;
  buyer_masked: string;
  seller_masked: string;
  amount_kobo: number;
  status: DisputeStatus;
  escrow_state: EscrowState;
  reason: string;                 // not_delivered | not_as_described | unauthorized …
  opened_at: string;
  sla_due_at: string;
  evidence_count: number;
  assigned_to_masked: string | null;
  created_at: string;
}
export interface DisputeEvidence {
  id: string;
  from: 'buyer' | 'seller' | 'system';
  submitter_masked: string;
  kind: 'message' | 'image' | 'receipt' | 'tracking' | 'system_log';
  note: string;
  attachment_masked?: string | null;
  at: string;
}
export interface DisputeTimelineEntry {
  id: string;
  status: string;
  label: string;
  actor_masked: string;
  audit_id: string;
  at: string;
}
export interface DisputeDetail extends DisputeListItem {
  description: string;
  buyer_kyc_tier: CreatorKycTierLike;
  seller_kyc_tier: CreatorKycTierLike;
  seller_rating: number;          // 0..5
  buyer_prior_disputes: number;
  seller_prior_disputes: number;
  release_approver_masked: string | null; // who approved the underlying release (separation-of-duties)
  current_arbitrator_masked: string | null;
  evidence: DisputeEvidence[];
  timeline: DisputeTimelineEntry[];
}
// local alias so this file does not depend on creatorsAdmin
export type CreatorKycTierLike = 'tier0' | 'tier1' | 'tier2' | 'tier3';

export interface ArbitrationResult {
  id: string;
  status: DisputeStatus;
  escrow_state: EscrowState;
  audit_id: string;
  message: string;
}

// ── C · Escrow fraud — mule / AML detection ──────────────────────────────────
export interface EscrowFraudSignal {
  id: string;
  escrow_id: string | null;
  kind: EscrowFraudKind;
  subject_masked: string;
  detail: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  amount_kobo: number;
  status: EscrowFraudStatus;
  created_at: string;
}
export interface EscrowFraudActionResult {
  id: string;
  status: EscrowFraudStatus;
  audit_id: string;
  message: string;
}
