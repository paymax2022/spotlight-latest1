export type KycStatus = 'unverified' | 'pending' | 'verified' | 'failed' | 'suspended';
export type KycTier = 0 | 1 | 2 | 3;
export type DocumentType = 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';

export interface KycProfile {
  kyc_tier: KycTier;
  kyc_status: KycStatus;
  phone_verified: boolean;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  document_type: DocumentType | null;
}

export interface InitiateKycInput {
  document_type: DocumentType;
  /** Raw document number — hashed before storage; never persisted as-is. */
  document_number: string;
  phone?: string;
}

/** Daily wallet limit in kobo per tier (docs/prd.md § EPIC 2) */
export const TIER_WALLET_LIMIT_KOBO: Record<KycTier, number | null> = {
  0: 0,           // wallet disabled
  1: 5_000_000,   // ₦50,000
  2: 20_000_000,  // ₦200,000
  3: null,        // unlimited
};

/** Daily paid-vote cap per tier */
export const TIER_VOTE_LIMIT: Record<KycTier, number | null> = {
  0: null,   // existing free-vote limit only (wallet off)
  1: 500,
  2: 2000,
  3: null,   // unlimited
};

/**
 * Valid KYC status transitions.
 * Any transition NOT listed here is illegal and must throw.
 */
export const VALID_TRANSITIONS: Record<KycStatus, KycStatus[]> = {
  unverified: ['pending'],
  pending:    ['verified', 'failed'],
  failed:     ['pending'],              // retry allowed
  verified:   ['suspended'],
  suspended:  [],                       // manual DB intervention required
};
