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
  | 'address'
  | 'boolean'
  /** A nested block of fields (`policy_holder` — on ~65 of 69 products). */
  | 'object'
  /** A repeating group; `children` is the row shape (`office_items[]`, `beneficiaries[]`). */
  | 'array';

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
  /**
   * Dependency on another field.
   *  · `equals`     — render/validate this field only while the parent has that value
   *  · `queryParam` — this field's OPTIONS depend on the parent: the options
   *                   endpoint is called with the parent's value as `query`.
   *
   * The second form is not optional polish. `vehicle_model` returns an EMPTY
   * list when called without its parent make, so a renderer that fetches
   * eagerly shows a dropdown that can never be opened successfully. Options are
   * therefore not fetched at all until the parent is answered.
   */
  dependsOn?: { field: string; equals?: string; queryParam?: boolean };

  /**
   * The field's options come from a server-side lookup rather than a literal
   * enum (vehicle makes: 109 entries; colours: 121; nationalities: 193). The
   * client asks OUR backend for them by product + field name — it never
   * receives or follows a provider URL, so nothing here can be pointed at an
   * arbitrary host.
   */
  remoteOptions?: boolean;

  /** Regex the provider enforces (e.g. NIN `^[0-9]{11}$`). */
  pattern?: string;

  /** Row/nested shape for `object` and `array` fields. */
  children?: Field[];
  /** Bounds on the number of rows in an `array` field. */
  minRows?: number;
  maxRows?: number;
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

/**
 * A value held by the dynamic form.
 *  · string    — every scalar control, including booleans ('true' / 'false')
 *  · string[]  — multiselect
 *  · FormValues        — an `object` field's nested answers
 *  · FormValues[]      — an `array` field's repeating rows
 */
export type FieldValue = string | string[] | FormValues | FormValues[];
export interface FormValues {
  [name: string]: FieldValue | undefined;
}

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

  /**
   * Whether this plan can actually be sold today.
   *
   * Seven of the 69 products are broken on MyCover's side — four have no
   * purchase config (and return an empty schema), three have no sharing
   * formula. `compute-price` refuses all seven. They are listed so a person can
   * see the plan exists, but the buy path is closed rather than leading to a
   * dead end at the last step.
   */
  purchasable: boolean;
  /** Why, when `purchasable` is false — surfaced as an explanation, not a code. */
  providerConfigStatus: string | null;

  /** Present on GET /products/:code; absent on the list payload. */
  formSchema: FormSchema | null;

  /**
   * Sibling plans. MyCover sells several tiers of one thing under separate
   * product ids (FlexiCare / FlexiCare Mini / PrimeCare / Seniors / ZenCare all
   * come from Bastion), and a person choosing health cover wants to compare
   * those side by side rather than meet them as five unrelated rows in a list.
   * `familyCode` is what groups them on the detail screen's plan picker; it
   * falls back to the product's own code, i.e. a family of one.
   */
  familyCode: string;
  /** Human name of the family, for the plan-picker heading. */
  familyName: string;
  /**
   * The aggregator's own product UUID. It is submitted as `product_id` — the
   * one field on every schema that identifies WHICH plan is being bought. The
   * user never types it; the form injects it from the plan they chose.
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

  /**
   * MyCover has NO claim-filing REST endpoint (`POST /v2/claims` is a 404). It
   * runs claims through a hosted flow and hands the distributor a per-policy
   * link on the purchase webhook. So filing a claim means opening this link,
   * and progress comes back over webhooks — not a form we post.
   */
  claimUrl: string | null;
  /** Hosted vehicle/gadget inspection flow, same mechanism. */
  inspectionUrl: string | null;
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
