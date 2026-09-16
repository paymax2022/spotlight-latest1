// ── Admin — Paymax Insurance (MyCover.ai distribution) types ─────────────────
//
// These mirror the INTERNAL CONTRACT for `/api/insurance/admin/*` (snake_case
// over the wire, `{ data: … }` envelope on success, `{ error: {code,message} }`
// on failure).
//
// MONEY: every `*_kobo` field is an INTEGER in minor units. MyCover's own API
// speaks naira decimal strings ("6000.0000"); the Go adapter converts naira→kobo
// exactly once at the adapter boundary. The admin console must NEVER re-convert
// and must never do float arithmetic on these — format at the render boundary
// only (see `formatNaira` in the service).
//
// RATES: a percentage product carries a RATE, not an amount. `is_percentage`
// products expose `rate_bps` (basis points: 0.5% → 50) and `base_price_kobo` is
// null for them. Rendering "₦0.50" for a 0.5% rate is a money bug.
//
// OPTIONALITY IS DELIBERATE: almost every analytic field is `?: T | null`.
// The console must be able to tell "the backend reported zero" apart from "the
// backend did not report this at all", and render the latter as "not reported"
// rather than inventing a 0. Do not tighten these to non-optional to make a
// component simpler — that is how fixtures creep back in.

// ── Failure surface ──────────────────────────────────────────────────────────
// Classification of *why* a live call failed, so pages can explain themselves to
// an operator instead of printing "Error: [object Object]".
export type FailureKind =
  | 'unauthorized' // 401 — backend did not accept the admin session
  | 'forbidden' // 403 — session accepted, RBAC permission missing
  | 'not_implemented' // 404 — the endpoint does not exist on the backend yet
  | 'bad_request' // 4xx other
  | 'server' // 5xx
  | 'network' // could not reach the API at all
  | 'malformed'; // 2xx with a body we cannot read

// ── Catalog ──────────────────────────────────────────────────────────────────
export type Aggregator = 'mycover' | 'octamile' | string;

/** MyCover categories seen live: Life, Auto, Health, Content, Gadget, Package, Travel. */
export type ProductLine = string;

/**
 * How a product's commission split is expressed. `commission_from` matters a
 * great deal: the same percentage applied to `original_premium` vs
 * `final_premium` is a materially different naira figure once discounts or
 * add-ons move the final premium, so the console shows the basis next to the
 * rate rather than the rate alone.
 */
export interface SharingFormula {
  /** PAYMAX's revenue share, percent (0–25 across the live catalog). */
  distributor_commission_pct: number | null;
  /** MyCover's own take, percent. */
  mca_commission_pct: number | null;
  /** The underwriter's share, percent. */
  provider_commission_pct: number | null;
  /** Basis the provider share is computed from. */
  provider_commission_from: 'original_premium' | 'final_premium' | null;
  /** Basis the distributor share is computed from. */
  distributor_commission_from: 'original_premium' | 'final_premium' | null;
  /** Band bounds when a product has multiple formulas (0/0 = single band). */
  min?: number | null;
  max?: number | null;
  band_key?: string | null;
}

export interface InsuranceProduct {
  code: string;
  name: string;
  description?: string | null;
  product_line: ProductLine;
  category?: string | null;

  underwriter: string;
  underwriter_logo_url?: string | null;
  aggregator: Aggregator;
  /** The aggregator's own identifier for this product. */
  provider_product_code?: string | null;
  /** Purchase route, where one is stored. v2 uses a single shared buy endpoint. */
  provider_buy_path?: string | null;
  buy_path_verified?: boolean | null;

  /**
   * PROVIDER CAPABILITY — deliberately separate from `active`.
   *
   * `active` is our decision ("do we offer this?"). `purchasable` is MyCover's
   * ("can this be bought at all?"). Seven products are broken on the provider's
   * side: four have no purchase config and return an empty field schema, and
   * three have no sharing formula, meaning Paymax would earn nothing even if
   * pricing were fixed. A product can be active and unpurchasable, which is the
   * combination worth showing loudly.
   *
   * status: ok | broken | schema_unavailable | unknown
   */
  purchasable?: boolean | null;
  provider_config_status?: string | null;
  /** The provider's own verbatim explanation. Never a credential, never PII. */
  provider_config_error?: string | null;

  /** Flat premium in KOBO. Null when `is_percentage`. */
  base_price_kobo?: number | null;
  is_percentage: boolean;
  /** Basis points when `is_percentage` (0.5% → 50). Null otherwise. */
  rate_bps?: number | null;
  sum_insured_kobo?: number | null;
  cover_period_days?: number | null;
  currency?: string | null;

  is_renewable?: boolean | null;
  is_claimable?: boolean | null;
  is_certificateable?: boolean | null;
  is_inspectable?: boolean | null;

  active: boolean;

  /** Commission split bands. Empty/absent = the backend did not report it. */
  sharing_formula?: SharingFormula[] | null;

  key_benefits_html?: string | null;
  full_benefits_html?: string | null;
  how_it_works_html?: string | null;
  how_to_claim_html?: string | null;

  /** Live policy count attributed to this product, when the backend reports it. */
  policies_active?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
}

/** Sync bookkeeping returned alongside the catalog. */
export interface CatalogSyncStatus {
  last_synced_at?: string | null;
  /** Products currently stored locally. */
  local_count?: number | null;
  /** Products the provider reports. */
  provider_count?: number | null;
  /** Codes present at the provider but not locally. */
  missing_locally?: string[] | null;
  /** Codes stored locally that the provider no longer lists. */
  stale_locally?: string[] | null;
  last_sync_error?: string | null;
}

export interface CatalogResponse {
  products: InsuranceProduct[];
  sync: CatalogSyncStatus | null;
}

export interface CatalogSyncResult {
  synced?: number | null;
  created?: number | null;
  updated?: number | null;
  deactivated?: number | null;
  failed?: number | null;
  with_schema?: number | null;
  status?: string | null;
  error_text?: string | null;
  synced_at?: string | null;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export interface DashboardBreakdown {
  /** Category name, underwriter name, … depending on which list this is in. */
  key: string;
  policies?: number | null;
  gross_premium_kobo?: number | null;
  commission_kobo?: number | null;
  claims?: number | null;
  claims_paid_kobo?: number | null;
}

export interface InsuranceDashboard {
  policies_total?: number | null;
  policies_active?: number | null;
  policies_lapsed?: number | null;
  policies_expired?: number | null;
  policies_cancelled?: number | null;
  policies_pending?: number | null;

  /** Gross written premium, kobo. */
  gross_premium_kobo?: number | null;
  /** PAYMAX's distributor share, kobo. Our revenue, not the underwriter's. */
  commission_kobo?: number | null;

  claims_count?: number | null;
  claims_open?: number | null;
  claims_paid_kobo?: number | null;
  /** Incurred claims ÷ earned premium, 0..1. Undefined while premium is zero. */
  loss_ratio?: number | null;

  by_category?: DashboardBreakdown[] | null;
  by_underwriter?: DashboardBreakdown[] | null;

  catalog?: {
    products_total?: number | null;
    products_active?: number | null;
    last_synced_at?: string | null;
  } | null;

  generated_at?: string | null;
}

// ── Policies ─────────────────────────────────────────────────────────────────
export type PolicyStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'lapsed'
  | string;

export interface PolicySummary {
  id: string;
  policy_ref?: string | null;
  provider_policy_ref?: string | null;
  product_code: string;
  product_name?: string | null;
  underwriter?: string | null;
  aggregator?: Aggregator | null;
  status: PolicyStatus;
  premium_kobo?: number | null;
  sum_insured_kobo?: number | null;
  commission_kobo?: number | null;
  currency?: string | null;
  policyholder_masked?: string | null;
  policyholder_user_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at?: string | null;
}

export interface PolicyTimelineEntry {
  at: string;
  status: string;
  actor?: string | null;
  note?: string | null;
}

export interface PolicyDetail extends PolicySummary {
  certificate_url?: string | null;
  quote_ref?: string | null;
  inputs?: Record<string, unknown> | null;
  timeline?: PolicyTimelineEntry[] | null;
  claims?: ClaimSummary[] | null;
}

// ── Claims ───────────────────────────────────────────────────────────────────
export type ClaimStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'paid'
  | string;

export interface ClaimSummary {
  id: string;
  claim_ref?: string | null;
  provider_claim_ref?: string | null;
  policy_id: string;
  product_name?: string | null;
  underwriter?: string | null;
  claimant_masked?: string | null;
  status: ClaimStatus;
  claimed_amount_kobo?: number | null;
  approved_amount_kobo?: number | null;
  loss_event_at?: string | null;
  created_at?: string | null;
}

export interface ClaimEvidence {
  id: string;
  kind?: string | null;
  label?: string | null;
  /** Access-controlled pointer, never a raw provider URL. */
  ref?: string | null;
  uploaded_at?: string | null;
}

export interface ClaimDetail extends ClaimSummary {
  description?: string | null;
  evidence?: ClaimEvidence[] | null;
  timeline?: PolicyTimelineEntry[] | null;
  payout_ledger_ref?: string | null;
}

// ── Pagination ───────────────────────────────────────────────────────────────
export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  /** Null when the backend does not report a total. */
  total: number | null;
  has_more: boolean;
}

// ── Commission ───────────────────────────────────────────────────────────────
/**
 * One row of realised distributor commission. `basis_pct` + `basis` together
 * explain how `commission_kobo` was derived — an operator reconciling against a
 * MyCover statement needs both, because the same rate on `original_premium` vs
 * `final_premium` produces different money.
 */
export interface CommissionEntry {
  id: string;
  policy_id?: string | null;
  product_code?: string | null;
  product_name?: string | null;
  underwriter?: string | null;
  premium_kobo?: number | null;
  commission_kobo?: number | null;
  basis_pct?: number | null;
  basis?: 'original_premium' | 'final_premium' | string | null;
  ledger_ref?: string | null;
  reconciled?: boolean | null;
  created_at?: string | null;
}

export interface CommissionSummary {
  entries: CommissionEntry[];
  total_commission_kobo?: number | null;
  total_premium_kobo?: number | null;
  period_from?: string | null;
  period_to?: string | null;
}

// ── Providers ────────────────────────────────────────────────────────────────
export interface ProviderWebhookStatus {
  url?: string | null;
  /** Whether signature verification is switched on at all. */
  verification_enabled?: boolean | null;
  /** The backend's own explanation of the verification posture. */
  note?: string | null;
  /** FALSE when the shared secret is unset — signature verification cannot pass. */
  secret_configured?: boolean | null;
  signature_scheme?: string | null;
  last_received_at?: string | null;
  last_verified_at?: string | null;
  received_24h?: number | null;
  rejected_24h?: number | null;
}

/**
 * The PREFUNDED DISTRIBUTOR FLOAT — modelled as an OBSERVED CIRCUIT BREAKER,
 * not as a balance.
 *
 * MyCover settles binds from a wallet Paymax funds in advance, and its
 * `/wallet/balance` returns 403 for our credential. We therefore cannot read the
 * balance at all, and the backend deliberately does not pretend to: it records
 * what the provider was OBSERVED to do. The first bind refused for
 * "Insufficient wallet fund" trips `state: exhausted`, and every later bind is
 * refused BEFORE the member is debited. An operator tops the wallet up at the
 * provider and resets the breaker.
 *
 * This is the right model for the constraint, and the console renders it as
 * such. `balance_kobo` stays here only for the day the balance becomes
 * readable; it is expected to be null, and null must never render as ₦0.00.
 */
export interface ProviderFloat {
  provider: string;
  /** ok | exhausted | unknown */
  state: string;
  /** TRUE means: do not take the member's money — binds cannot be issued. */
  binding_paused: boolean | null;
  consecutive_failures?: number | null;
  last_failure_at?: string | null;
  last_failure_text?: string | null;
  last_success_at?: string | null;
  /** An operator's human record of a top-up. NOT an authority on the balance. */
  last_topup_note?: string | null;
  last_reset_at?: string | null;
  updated_at?: string | null;
  /** Null today: the provider will not tell us. See the note above. */
  balance_kobo?: number | null;
}

/** One catalog sync run, as recorded by the backend. */
export interface CatalogSyncRun {
  sync_id?: string | null;
  provider?: string | null;
  status?: string | null;
  products_seen?: number | null;
  products_upserted?: number | null;
  products_failed?: number | null;
  products_with_schema?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  error_text?: string | null;
  skipped_codes?: string[] | null;
}

/**
 * The whole `/providers` payload. Adapter health, float breakers, and the last
 * catalog sync arrive together, plus a top-level `binding_paused` that is the
 * launch gate: when it is true, no policy can be issued no matter how healthy
 * every other indicator looks.
 */
export interface ProvidersReport {
  adapters: ProviderStatus[];
  floats: ProviderFloat[];
  binding_paused: boolean | null;
  binding_paused_reason: string | null;
  last_sync: CatalogSyncRun | null;
}

export interface ProviderStatus {
  provider: Aggregator;
  display_name?: string | null;
  base_url?: string | null;
  /**
   * 'test' | 'live'. The backend does not currently report this — the
   * environment is determined by the API-KEY PREFIX (MCASECK_T… is staging),
   * which the API deliberately never exposes. Expect null and render "unknown"
   * rather than assuming test, since assuming test on a live key is the
   * dangerous direction of that guess.
   */
  mode?: 'test' | 'live' | 'unknown' | string | null;
  api_key_configured?: boolean | null;
  /** How many purchase families the adapter has routes for. */
  purchase_families?: number | null;
  reachable?: boolean | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error?: string | null;
  latency_ms?: number | null;
  products_synced?: number | null;
  webhook?: ProviderWebhookStatus | null;
  float?: ProviderFloat | null;
  updated_at?: string | null;
}

// ── Reconciliation ───────────────────────────────────────────────────────────
export type DriftKind =
  | 'missing_locally' // provider has a policy we have no record of
  | 'missing_at_provider' // we recorded a policy the provider does not list
  | 'status_mismatch'
  | 'premium_mismatch'
  | string;

export interface ReconciliationDrift {
  id: string;
  kind: DriftKind;
  policy_id?: string | null;
  provider_policy_ref?: string | null;
  product_code?: string | null;
  local_status?: string | null;
  provider_status?: string | null;
  local_premium_kobo?: number | null;
  provider_premium_kobo?: number | null;
  delta_kobo?: number | null;
  detail?: string | null;
  detected_at?: string | null;
}

export interface ReconciliationReport {
  drifts: ReconciliationDrift[];
  local_policy_count?: number | null;
  provider_policy_count?: number | null;
  matched_count?: number | null;
  /**
   * Float reconciliation: what the provider actually debited from our prefunded
   * wallet against what our own records say we bound. A gap here means either a
   * bind we were charged for and never recorded, or one we recorded and were
   * never charged for — both are money.
   */
  float_balance_kobo?: number | null;
  float_debited_kobo?: number | null;
  bound_premium_kobo?: number | null;
  bound_policy_count?: number | null;
  float_delta_kobo?: number | null;
  /** Absolute premium delta across all drifts, kobo. */
  total_delta_kobo?: number | null;
  ran_at?: string | null;
}
