// ── Types — Paymax Health admin · MDCN doctor verification (Mode B / ASSISTED) ──
// Companion to the doctor admin surface; this owns the assisted MDCN
// verification-review console (HEALTH-BUILD; HL-2 credential-gated discoverability,
// HL-8 sensitive health/identity data NDPA, HL-12 immutable audit). Mirrors the
// vet healthVetVerification.ts shapes — but doctors are a separate vertical
// (medical/dental) gated on RBAC `health.doctor.review`.
//
// Mode B (ASSISTED): a doctor (medical or dental) submits their MDCN registration
// number + name + documents inside Paymax. An ops reviewer (this console) reviews
// the documents + an automatic identity cross-check (name vs the doctor's Paymax
// KYC) and records a decision. A doctor can NEVER self-review/decide. On approval
// the doctor becomes discoverable via an idempotent capability grant and a
// licence-expiry auto-suspend is scheduled (HL-2). Every document view is
// access-logged server-side (HL-8 / NDPA). The doctor never sees the MDCN portal.
//
// VerificationRecord state machine: pending → approved | needs_info | rejected.

export type MdcnVerificationStatus = 'pending' | 'needs_info' | 'approved' | 'rejected';

// Medical & Dental Council of Nigeria — the two disciplines it registers.
export type MdcnDiscipline = 'medical' | 'dental';

// Advisory identity cross-check outcome per field (name vs KYC etc.).
export type MdcnFieldMatch = 'match' | 'mismatch' | 'unverifiable';

// matchedFields keys are advisory (e.g. name) — never auto-decide.
export type MdcnMatchedFields = Record<string, MdcnFieldMatch>;

// Evidence document — JSON keys are camelCase (id, docType, fileUrl, …).
export type MdcnVerificationDoc = {
  id: string;
  verificationId?: string;
  userId?: string;
  docType: string;
  label?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  required: boolean;
  uploadedAt: string;
  createdAt?: string;
};

// Queue row — joined doctor identity plus advisory identity flag.
export type MdcnQueueItem = {
  verificationId: string;
  userId: string;
  doctorName: string;
  mdcnNumber: string;
  discipline?: MdcnDiscipline | null;
  status: string;
  submittedAt?: string | null;
  matchedFields: MdcnMatchedFields; // advisory name-vs-KYC cross-check (HL-8)
  identityFlag: boolean; // advisory — any mismatch surfaced
};

export type MdcnReviewRecord = {
  verificationId: string;
  userId: string;
  doctorName: string;
  status: MdcnVerificationStatus;
  source: string; // MDCN
  method: string; // ASSISTED (Mode B)
  discipline?: MdcnDiscipline | null;
  mdcnNumber: string; // MDCN registration number (surfaced — HL-2)
  matchedFields: MdcnMatchedFields; // advisory name-vs-KYC cross-check (HL-8)
  licenceExpiry?: string | null; // YYYY-MM-DD — drives auto-suspend (HL-2)
  notes?: string | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  documents: MdcnVerificationDoc[]; // view access-logged server-side (HL-8)
};

export type MdcnDecisionAction = 'approve' | 'need_info' | 'reject';

export type MdcnDecisionInput = {
  action: MdcnDecisionAction;
  licence_expiry?: string; // YYYY-MM-DD — REQUIRED when action === 'approve'
  discipline?: MdcnDiscipline; // REQUIRED when action === 'approve'
  notes?: string;
};
