// ── Types — Paymax Health admin · Vet VCN verification (Mode B / ASSISTED) ──────
// Companion to healthVetAdmin.ts — do NOT edit that file; this owns the assisted
// VCN verification-review surface (HEALTH-BUILD; HL-2 credential-gated supply,
// HL-8 sensitive health/identity data NDPA, HL-12 immutable audit).
//
// Mode B (ASSISTED): a veterinarian submits their VCN registration number + name
// + DOB + documents inside Paymax. An ops reviewer (this console, RBAC
// `health.vet.review`) reviews the documents + an automatic identity cross-check
// (name/DOB vs the vet's Paymax KYC) and records a decision. A vet can NEVER
// self-review/decide. On approval the vet capability is granted idempotently and a
// licence-expiry auto-suspend is scheduled (HL-2). Every document view is
// access-logged server-side (HL-8 / NDPA).
//
// ProviderApplication / VerificationRecord state machine:
//  PENDING → VERIFIED | NEEDS_INFO | REJECTED.

export type VcnVerificationStatus = 'PENDING' | 'VERIFIED' | 'NEEDS_INFO' | 'REJECTED';

// Advisory identity cross-check outcome per field (name / dob / kyc).
export type VcnFieldMatch = 'match' | 'mismatch' | 'unverifiable';

// matched_fields keys: name, dob, kyc (all advisory — never auto-decide).
export type VcnMatchedFields = Record<string, VcnFieldMatch>;

export type VcnVerificationRecord = {
  id: string;
  provider_application_id: string;
  capability: string; // capability granted on approval (e.g. vet provider)
  source: string; // VCN
  method: string; // ASSISTED (Mode B)
  status: VcnVerificationStatus;
  reg_number: string; // VCN registration number (surfaced — HL-2)
  matched_fields: VcnMatchedFields; // advisory name/dob/kyc cross-check (HL-8)
  licence_expiry: string | null; // YYYY-MM-DD — drives auto-suspend (HL-2)
  reviewer_id: string | null; // ops reviewer who decided (never the vet)
  notes: string;
  evidence_doc_ids: string[]; // doc ids; view access-logged server-side (HL-8)
  consent_at: string | null; // NDPA consent timestamp (HL-8)
  created_at: string;
  decided_at: string | null;
};

// Queue row — record plus joined owner / state / advisory identity flag.
export type VcnQueueItem = {
  record: VcnVerificationRecord;
  owner_user_id: string;
  display_name: string;
  application_state: string;
  identity_flag: boolean; // advisory — any name/dob/kyc mismatch surfaced
};

export type VcnDecisionAction = 'approve' | 'need_info' | 'reject';

export type VcnDecisionInput = {
  action: VcnDecisionAction;
  licence_expiry?: string; // YYYY-MM-DD — REQUIRED when action === 'approve'
  notes?: string;
};
