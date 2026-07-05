// ── Insurance / "Protection" — Domain types ──────────────────────────────────
// Normalised, provider-agnostic shapes (PRD §7/§9). Provider-specific JSON never
// leaks past the api layer — screens only ever see these models.
// IRON RULE: all monetary amounts are integers in minor units (kobo).

export type Provider = 'MYCOVER' | 'OCTAMILE';

export type ProductLine =
  | 'HEALTH'
  | 'PERSONAL_ACCIDENT'
  | 'DEVICE'
  | 'SME'
  | 'WALLET'
  | 'GENERAL'
  | 'MOTOR'
  | 'GOODS_IN_TRANSIT';

export type BindingMode =
  | 'VOLUNTARY'
  | 'EMBEDDED'
  | 'EMBEDDED_PER_TRIP'
  | 'EMBEDDED_PER_SHIPMENT';

export type PremiumModel = 'FLAT' | 'TIERED' | 'PER_SHIPMENT' | 'USAGE';

export type KycTier = 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';

/** Policy lifecycle (PRD §10.1). */
export type PolicyState =
  | 'QUOTED'
  | 'PENDING_PAYMENT'
  | 'BINDING'
  | 'ACTIVE'
  | 'RENEWAL_DUE'
  | 'LAPSED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'BIND_FAILED'
  | 'VOID';

export type RefundState =
  | 'NONE'
  | 'PENDING'
  | 'PROCESSING'
  | 'REFUNDED'
  | 'FAILED';

/** Disclosure block — surfaced from the provider, never hard-coded in screens. */
export interface Disclosure {
  underwriter: string;   // NAICOM-licensed insurer
  aggregator: string;    // MyCover.ai / Octamile
}

/** A field in a product's schema-driven quote form (PRD §8 required_fields_schema). */
export interface FieldSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'currency';
  required: boolean;
  placeholder?: string;
  helper?: string;
  options?: { value: string; label: string }[];
  /** Pulled from KYC when available (PRD §6.1 — never re-collect). */
  kycKey?: keyof KycProfile;
  min?: number;
  max?: number;
}

export interface InsuranceProduct {
  code: string;
  displayName: string;
  shortDescription: string;
  productLine: ProductLine;
  provider: Provider;
  bindingMode: BindingMode;
  premiumModel: PremiumModel;
  /** Indicative premium for browse cards (kobo). Real premium comes from quote. */
  fromPremiumKobo: number;
  premiumCadence: 'one-off' | 'monthly' | 'annual' | 'per-shipment' | 'per-trip';
  requiredKycTier: KycTier;
  disclosure: Disclosure;
  sumInsuredRules: { min: number; max: number; basis: 'fixed' | 'declared_value' };
  /** Headline benefits for the detail screen. */
  benefits: string[];
  exclusions: string[];
  icon: string;          // lucide icon name
  fieldsSchema: FieldSchema[];
  active: boolean;
}

export interface ProductLineGroup {
  line: ProductLine;
  label: string;
  description: string;
  icon: string;
  provider: Provider;
}

/** KYC profile mock used to prefill the schema-driven quote form. */
export interface KycProfile {
  tier: KycTier;
  fullName: string;
  dateOfBirth: string;   // ISO
  phone: string;
  email: string;
  address: string;
  bvnLinked: boolean;
  ninLinked: boolean;
}

export interface QuoteInput {
  productCode: string;
  inputs: Record<string, string>;
}

export interface Quote {
  id: string;
  productCode: string;
  productName: string;
  provider: Provider;
  disclosure: Disclosure;
  premiumKobo: number;
  premiumCadence: InsuranceProduct['premiumCadence'];
  sumInsuredKobo: number;
  /** Quote TTL — when this quote expires (PRD §10.1 QUOTED→EXPIRED). */
  expiresAt: string;
  /** Echo of the inputs that produced this quote. */
  inputs: Record<string, string>;
  benefits: string[];
  exclusions: string[];
  termsRef: string;
}

export interface Beneficiary {
  id: string;
  fullName: string;
  relationship: string;
  phone?: string;
  sharePercent: number;
}

export interface Policy {
  id: string;
  productCode: string;
  productName: string;
  productLine: ProductLine;
  provider: Provider;
  disclosure: Disclosure;
  state: PolicyState;
  bindingMode: BindingMode;
  sumInsuredKobo: number;
  premiumKobo: number;
  premiumCadence: InsuranceProduct['premiumCadence'];
  currency: 'NGN';
  effectiveAt: string;
  expiresAt: string;
  certificateRef: string | null;   // signed-url placeholder
  beneficiaries: Beneficiary[];
  icon: string;
  /** Lifecycle helpers. */
  renewalDueAt?: string;
  refundState?: RefundState;
  refundKobo?: number;
  createdAt: string;
}

/** Result of a bind attempt (debit→bind saga; PRD §11). */
export interface BindResult {
  ok: boolean;
  policy?: Policy;
  /** On failure the premium debit is auto-reversed to wallet. */
  errorCode?:
    | 'BIND_REJECTED_BY_UNDERWRITER'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'DUPLICATE_REQUEST';
  errorMessage?: string;
  autoRefundKobo?: number;
}

/** My-cover summary for the Protection hub. */
export interface CoverSummary {
  activePolicies: number;
  totalSumInsuredKobo: number;
  monthlyPremiumKobo: number;
  renewalsDue: number;
}

/** NDPA consent record (PRD §18). */
export interface ConsentPayload {
  productCode: string;
  version: string;
  fields: string[];          // minimised PII fields shared with provider
  acceptedAt: string;
}
