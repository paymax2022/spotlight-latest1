// ── Paymax Invest · Onboarding / KYC / Suitability / Agreements — Type Contract ─
// The compliance gate every user clears before they can trade crypto or stocks.
// Mirrors the crypto/fx type contracts: this file is the source of truth the
// onboarding screens code against (Backend role owns it). Maps to the Paymax
// /api/v1/invest/* and /api/v1/suitability/* endpoints (docs/crypto/api.md).
//
// Education-first, plain-language module: no money math lives here — onboarding
// gathers identity, suitability and consent so trading can be unlocked.

// ─── KYC status (mirrors fx VerificationStatus; drives the status screen) ──────

/** Where the user's identity verification stands. */
export type KycStatus = 'unstarted' | 'pending' | 'approved' | 'rejected' | 'review';

/** Government ID document types accepted for verification (NG-first). */
export type IdDocType = 'nin' | 'passport' | 'drivers_license' | 'voters_card';

/** Personal vs business onboarding path. */
export type AccountType = 'individual' | 'business';

// ─── KYC draft (in-flight onboarding form state) ──────────────────────────────

/** The identity details collected across the KYC steps. */
export interface KycPersonal {
  firstName: string;
  lastName: string;
  dob: string;            // ISO-ish date string 'YYYY-MM-DD'
  bvn: string;            // Bank Verification Number (NG)
  nin: string;            // National Identification Number (NG)
}

/**
 * The mutable draft the multi-step KYC flow reads/writes as the user progresses.
 * Document/selfie capture is mocked as boolean "uploaded" flags (no real files).
 */
export interface KycDraft {
  accountType: AccountType;
  personal: KycPersonal;
  idDocType: IdDocType;
  idFrontUploaded: boolean;
  idBackUploaded: boolean;
  selfieUploaded: boolean;
}

// ─── Suitability questionnaire (drives risk profiling) ────────────────────────

/** The user's answers to the suitability questionnaire (one value per question). */
export interface SuitabilityAnswers {
  experience: string;
  riskTolerance: string;
  lossTolerance: string;
  objective: string;
  timeHorizon: string;
  cryptoKnowledge: string;
  stockKnowledge: string;
}

/** The four risk buckets a scored questionnaire resolves to. */
export type RiskCategory = 'conservative' | 'balanced' | 'growth' | 'aggressive';

/** The server-authoritative outcome of scoring the questionnaire. */
export interface SuitabilityResult {
  riskCategory: RiskCategory;
  score: number;                 // raw total, for transparency / debugging
  eligibleProducts: string[];    // product ids the profile is cleared for
  summary: string;               // plain-language description of the profile
  expiresAt: string;             // ISO — profiles are re-assessed periodically
}

// ─── Agreements / consents (legal gate) ───────────────────────────────────────

/** A single legal agreement the user must read + accept. */
export interface Agreement {
  id: string;
  title: string;
  version: string;
  required: boolean;
  summary: string;       // one-line plain-language summary
  body: string;          // full agreement text (rendered in the consent row)
}

/** A user's recorded acceptance of an agreement. */
export interface AgreementAcceptance {
  id: string;
  version: string;
  acceptedAt: string;
}

// ─── Eligibility gate (region / residency check) ──────────────────────────────

/** Why onboarding might be blocked, or which step resolves it next. */
export type EligibilityState =
  | 'eligible'
  | 'kyc_required'
  | 'kyc_pending'
  | 'suitability_required'
  | 'agreements_required'
  | 'restricted'
  | 'product_unavailable';

export interface EligibilityResult {
  state: EligibilityState;
  region: string;            // detected/declared region label
  residency: string;         // declared residency label
  investEnabled: boolean;    // server product flag for this user/region
  message: string;
  ctaRoute?: string;         // where the resolve-CTA sends the user
}

// ─── Aggregate onboarding state (overview / status surfaces) ──────────────────

export interface OnboardingState {
  kycStatus: KycStatus;
  suitabilityComplete: boolean;
  agreementsComplete: boolean;
  riskCategory?: RiskCategory;
}
