// ── Insurance (live) — domain types ─────────────────────────────────────────
// These mirror `SCRATCHPAD/INTERNAL-CONTRACT.md` one-for-one. The wire format is
// snake_case; `live/normalize.ts` is the ONLY place that translates. Screens see
// nothing but the camelCase shapes below.
//
// IRON RULE: every monetary field is an INTEGER in kobo (minor units) and its
// name ends in `Kobo`. No floats, no decimal strings, no client-side arithmetic
// on a premium — the server computes it, we render it.
//
// This file is import-free on purpose so the pure layer (normalize/formEngine/
// money/catalog/html) loads under plain `node --test` with no alias resolver.

/** The seven real MyCover categories, lowercased as the contract sends them. */
export type ProductLine =
  | 'health'
  | 'auto'
  | 'travel'
  | 'gadget'
  | 'life'
  | 'content'
  | 'package';

export const PRODUCT_LINES: ProductLine[] = [
  'health', 'auto', 'life', 'gadget', 'content', 'package', 'travel',
];

/** Every field type the dynamic form renderer can draw. */
export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'money'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'file'
  | 'image'
  | 'nin'
  | 'address';

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * One field of a product's bespoke purchase schema.
 *
 * MyCover exposes a *different* required-field set per product (68 products, 68
 * schemas), so nothing here may ever be hardcoded into a screen. `dependsOn`
 * drives dependent dropdowns (e.g. LGA depends on state).
 */
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Numeric bounds (`number` / `money`). For `money` these are KOBO. */
  min?: number;
  max?: number;
  /** String length bounds — e.g. NIN is exactly 11 (`minLength = maxLength = 11`). */
  minLength?: number;
  maxLength?: number;
  options?: FieldOption[];
  help?: string;
  placeholder?: string;
  /** Render/validate this field only while `field` equals `equals`. */
  dependsOn?: { field: string; equals: string };
  /** Optional grouping hint from the backend; the renderer chunks by it. */
  group?: string;

  /**
   * Unit of `min`/`max` on a `money` field. Defaults to `kobo`, which is what
   * the internal contract requires. It exists because the PROVIDER states some
   * minimums in naira (`device_value >= 50000` means ₦50,000, not ₦500), and a
   * schema that passes that number through unscaled would validate a ₦500 phone
   * as acceptable. Whoever emits the schema declares which unit they meant.
   */
  unit?: 'kobo' | 'naira';

  /**
   * Date bounds as ISO `YYYY-MM-DD`, or the sentinel `'today'`. `date_of_birth`
   * carries `maxDate: 'today'` because the provider rejects a future birth date.
   */
  minDate?: string;
  maxDate?: string;

  /**
   * A value the APP supplies, not the user — `product_id` is the UUID of the
   * plan they picked upstream. Hidden fields are never rendered, never
   * validated against user input, and always submitted.
   */
  hidden?: boolean;
}

export interface FormSchema {
  fields: Field[];
}

/** A value held by the dynamic form. Arrays back multiselect + file/image lists. */
export type FieldValue = string | string[];
export type FormValues = Record<string, FieldValue>;

export interface Product {
  code: string;
  name: string;
  description: string;
  productLine: ProductLine;
  category: string;
  underwriter: string;
  underwriterLogoUrl: string | null;
  /** Always "mycover" today; kept so a second aggregator can be added. */
  aggregator: string;

  /**
   * FLAT products: `basePriceKobo` is the actual premium.
   * PERCENTAGE products: `basePriceKobo` is meaningless — use `rateBps`.
   * These two MUST render differently ("₦6,000/yr" vs "from 0.5% of value").
   */
  basePriceKobo: number;
  isPercentage: boolean;
  /** Rate in basis points when `isPercentage` (0.5% → 50). */
  rateBps: number;

  sumInsuredKobo: number;
  coverPeriodDays: number;

  isRenewable: boolean;
  isClaimable: boolean;
  isCertificateable: boolean;

  keyBenefitsHtml: string;
  fullBenefitsHtml: string;
  howItWorksHtml: string;
  howToClaimHtml: string;

  active: boolean;
  /** Present on GET /products/:code; absent on the list payload. */
  formSchema: FormSchema | null;

  /**
   * MyCover's buy endpoints are per product FAMILY, not per product: one
   * `POST /products/bastion/buy-medisure` serves FlexiCare, FlexiCare Mini,
   * PrimeCare, Seniors and ZenCare, and the body's `product_id` picks which.
   *
   * So a "product" in the catalog is really a PLAN, and plans that share a
   * family share one form schema. The buy flow is therefore: choose plan →
   * fill the family's form once. `familyCode` groups them; falls back to the
   * product's own code when the backend has not grouped it.
   */
  familyCode: string;
  /** Human name of the family, for the plan-picker heading. */
  familyName: string;
  /**
   * The aggregator's own product UUID, submitted as `product_id`. The user
   * never types this — the form injects it from the plan they chose.
   */
  providerProductId: string | null;
}

export interface Quote {
  quoteRef: string;
  productCode: string;
  premiumKobo: number;
  sumInsuredKobo: number;
  commissionKobo: number;
  currency: 'NGN';
  underwriter: string;
  expiresAt: string | null;
  terms: string;
}

export type PolicyStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'lapsed';

export interface Policy {
  id: string;
  policyRef: string;
  providerPolicyRef: string | null;
  productCode: string;
  productName: string;
  underwriter: string;
  status: PolicyStatus;
  premiumKobo: number;
  sumInsuredKobo: number;
  currency: 'NGN';
  startsAt: string | null;
  endsAt: string | null;
  certificateUrl: string | null;
  createdAt: string | null;
}

export type ClaimStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'paid';

export interface ClaimEvidence {
  id: string;
  name: string;
  url: string;
  uploadedAt: string | null;
}

export interface Claim {
  id: string;
  claimRef: string;
  providerClaimRef: string | null;
  policyId: string;
  status: ClaimStatus;
  claimedAmountKobo: number;
  approvedAmountKobo: number | null;
  lossEventAt: string | null;
  description: string;
  evidence: ClaimEvidence[];
  createdAt: string | null;
}

/**
 * A normalised failure from the insurance surface. Screens render `message`;
 * `fieldErrors` is fed straight back into the dynamic form so a provider-side
 * rejection lands on the field that caused it instead of a generic banner.
 */
export interface InsuranceError {
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
  /** HTTP status, when the failure came back from the server at all. */
  status: number | null;
}
