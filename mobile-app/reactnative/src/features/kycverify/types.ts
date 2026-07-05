// ── Multi-provider KYC step-up — shared types ────────────────────────────────
// Mirrors the Go backend contract at /api/finance/kyc. Statuses match the
// backend enums exactly so screens can branch on them without remapping.

/** Per-check lifecycle (VerificationCheck.status). */
export type CheckStatus = 'INITIATED' | 'PENDING' | 'PASSED' | 'FAILED' | 'REVIEW';

/** Overall session lifecycle (session.status). */
export type SessionStatus =
  | 'UNVERIFIED'
  | 'TIER_PENDING'
  | 'TIER_VERIFIED'
  | 'TIER_FAILED'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

/** The kinds of checks a session can run (mirrors the check POST endpoints). */
export type CheckType = 'id-number' | 'facial' | 'liveness' | 'document' | 'aml';

/** Government ID document types accepted for id-number / facial checks. */
export type IdType = 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'VOTERS_CARD';

/** Document types for the front/back capture (Tier 3). */
export type DocType = 'PASSPORT' | 'DRIVERS_LICENSE' | 'NATIONAL_ID' | 'VOTERS_CARD';

/** KYC tiers we can step a user up to. Tier 0 = unverified. */
export type KycTier = 0 | 1 | 2 | 3;

/** A single verification check inside a session. */
export interface VerificationCheck {
  id: string;
  type: CheckType;
  status: CheckStatus;
  /** Provider-supplied reason on FAILED/REVIEW — surfaced to the user verbatim-ish. */
  reason?: string | null;
  /** Matched identity fields returned by data-match / facial checks on PASS. */
  matchedName?: string | null;
  matchedDob?: string | null;
  provider?: string | null;
  createdAt?: string | null;
}

/** A verification session targeting a specific tier. */
export interface VerificationSession {
  id: string;
  status: SessionStatus;
  targetTier: KycTier;
  checks?: VerificationCheck[];
}

/** Server-issued SDK token for provider capture flows. */
export interface SdkToken {
  token: string;
  expiresAt: string;
  provider: string;
}

/** Consent scope recorded before any check runs. */
export type ConsentScope = 'kyc-data-processing' | 'kyc-biometric' | 'kyc-address';
