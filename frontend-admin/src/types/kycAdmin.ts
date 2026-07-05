// KYC verification admin console — domain types (snake_case mirrors the Go
// backend / openapi.yaml). RBAC: finance.admin.kyc.
//
// Roles (per docs/prd/kyc/admin-console.md — Authorization):
//   - KYC Ops     → review queue, case decisions (AK1, AK2).
//   - Compliance  → AML / fraud queues, thresholds, audit/consent logs (AK4, AK5, AK7, AK13).
//   - Admin       → routing rules, provider config, templates (AK6, AK8, AK9).
//   - System      → runs checks, drives transitions, ingests webhooks (no UI).
//
// Evidence (selfies, documents, bio-data) is object-level access-controlled and
// NEVER rendered inline — every view is fetched behind an explicit, logged call.

export type CheckType = 'ID_NUMBER' | 'ID_FACIAL' | 'LIVENESS' | 'DOCUMENT' | 'AML';

export type CheckStatus = 'INITIATED' | 'PENDING' | 'PASSED' | 'FAILED' | 'REVIEW';

export type SessionStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

export interface VerificationSession {
  id: string;
  user_id: string;
  target_tier: number;
  status: SessionStatus;
  created_at?: string;
  updated_at?: string;
}

export interface VerificationCheck {
  id: string;
  session_id: string;
  type: CheckType;
  provider: string;
  status: CheckStatus;
  match?: boolean | null;
  confidence?: number | null; // 0–100 confidence score from the provider.
  extracted_fields?: Record<string, string> | null;
  reason?: string | null;
  created_at: string;
}

// A reference to access-logged evidence (selfie / document). We only ever hold a
// pointer + label here; the raw object is fetched behind an explicit logged call.
export interface EvidenceRef {
  id: string;
  check_id?: string;
  kind: string; // e.g. 'selfie', 'id_document', 'liveness_video'
  label?: string;
  access_logged: true; // always true — surfaced in AK13.
}

export interface KycCaseDetail {
  session: VerificationSession;
  checks: VerificationCheck[];
  evidence_refs: EvidenceRef[];
}

// Review queue row — a NEEDS_REVIEW session enriched with its worst/failing check
// so the queue is triageable without opening every case.
export interface KycReviewItem {
  session: VerificationSession;
  failing_check_type?: CheckType | null;
  provider?: string | null;
  confidence?: number | null;
  submitted_at?: string | null;
  priority?: number | null; // higher = triage sooner.
}

export interface KycRoutingRule {
  check_type: CheckType;
  ordered_providers: string[]; // primary → fallback order.
  threshold: number; // pass/review cut-off (0–100).
  enabled: boolean;
}

// Webhook / event monitor row (AK11).
export interface KycEvent {
  id: string;
  provider: string;
  event_type: string;
  status: 'delivered' | 'retried' | 'deduped' | 'signature_failed' | string;
  attempts?: number;
  session_id?: string | null;
  received_at: string;
  signature_valid?: boolean;
}

export const CHECK_TYPES: CheckType[] = ['ID_NUMBER', 'ID_FACIAL', 'LIVENESS', 'DOCUMENT', 'AML'];

export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  ID_NUMBER: 'ID Number',
  ID_FACIAL: 'ID Facial Match',
  LIVENESS: 'Liveness',
  DOCUMENT: 'Document',
  AML: 'AML / PEP Screening',
};

export const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 (₦50k/day)',
  2: 'Tier 2 (₦200k/day)',
  3: 'Tier 3 (Unlimited)',
};
