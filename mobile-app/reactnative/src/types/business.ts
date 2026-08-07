/**
 * Business Registry — CAC business-name verify + register.
 *
 * Mirrors the backend contract under the authed finance group
 * `/api/finance/business`. All monetary values are integers in minor units
 * (kobo) — never floats. See src/api/business.api.ts for the typed client.
 */

export type BusinessEntityType =
  | 'business_name'
  | 'company'
  | 'incorporated_trustee';

export type BusinessMode = 'verify_existing' | 'register_new';

export type BusinessStatus =
  | 'draft'
  | 'name_check'
  | 'name_reserved'
  | 'registration_submitted'
  | 'under_review'
  | 'registered'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'failed';

/** A person tied to a business (proprietor / director / trustee). */
export interface BusinessProprietor {
  fullName: string;
  role?: string;
  /** Bank Verification Number — sensitive, masked in the UI. */
  bvn?: string;
  /** National Identification Number — sensitive, masked in the UI. */
  nin?: string;
  /** Ownership share, 0–100. */
  sharePct?: number;
  phone?: string;
  email?: string;
}

/** The canonical business record returned by every endpoint. */
export interface BusinessProfile {
  id: string;
  userId: string;
  entityType: BusinessEntityType;
  mode: BusinessMode;
  legalName: string | null;
  proposedName: string | null;
  lineOfBusiness: string | null;
  status: BusinessStatus;
  rcOrBnNumber: string | null;
  cacReservationRef: string | null;
  cacRegistrationRef: string | null;
  verificationSource: string | null;
  registeredAt: string | null;
  /** CAC certificate URL — present once registered and CAC has issued the certificate. */
  certificateUrl?: string;
  /** CAC fee in kobo (minor units). */
  feeKobo: number | null;
  feeLedgerRef: string | null;
  metadata: Record<string, unknown> | null;
  proprietors: BusinessProprietor[];
  createdAt: string;
  updatedAt: string;
}

// ── Request / response payloads ──────────────────────────────────────────────

export interface NameCheckInput {
  proposedName: string;
  lineOfBusiness?: string;
  businessId?: string;
}

export interface NameCheckResult {
  business?: BusinessProfile;
  available: boolean;
  status: BusinessStatus;
  reason?: string;
  suggestions?: string[];
}

export interface VerifyExistingInput {
  rcOrBnNumber: string;
  entityType?: BusinessEntityType;
}

export interface RegisterNewInput {
  entityType: BusinessEntityType;
  proposedName: string;
  lineOfBusiness?: string;
  address?: string;
  objects?: string;
  documentRefs?: string[];
  proprietors?: BusinessProprietor[];
}
