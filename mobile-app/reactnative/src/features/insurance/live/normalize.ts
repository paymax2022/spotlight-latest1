// ── Insurance (live) — wire → domain normalisation ──────────────────────────
// PURE. No `@/` imports, no React — unit-tested under plain `node --test`.
//
// The ONLY place snake_case from `/api/v1/insurance/*` becomes a domain object.
// Screens never touch a raw payload.
//
// Rules this file enforces:
//  · Money stays an INTEGER in kobo. A decimal string ("6000.0000") that reaches
//    here is a backend contract violation — we coerce defensively but we never
//    multiply by 100 here. Naira→kobo conversion happens exactly once, in the
//    Go adapter, per MYCOVER-GROUND-TRUTH.md.
//  · Every coercion is lenient and total: an unknown enum falls back, a missing
//    field defaults. Normalisation must never throw, because a single odd row in
//    a 68-product catalog must not blank the whole browse screen.

import type {
  Claim,
  ClaimEvidence,
  ClaimStatus,
  Field,
  FieldOption,
  FieldType,
  FormSchema,
  InsuranceError,
  Policy,
  PolicyStatus,
  Product,
  ProductLine,
  Quote,
} from './types';

type Raw = Record<string, any>;

// ── Envelope ────────────────────────────────────────────────────────────────
/** Unwrap `{ data: T }`, or accept a bare payload. */
export function unwrap<T = unknown>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Raw)) {
    return (body as Raw).data as T;
  }
  return body as T;
}

export function unwrapList<T = unknown>(body: unknown): T[] {
  const inner = unwrap(body);
  if (Array.isArray(inner)) return inner as T[];
  // Tolerate `{ data: { items: [...] } }` / `{ data: { products: [...] } }`.
  if (inner && typeof inner === 'object') {
    for (const key of ['items', 'products', 'policies', 'claims', 'results']) {
      const v = (inner as Raw)[key];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

// ── Scalar coercions ────────────────────────────────────────────────────────
function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v);
}

function strOrNull(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * Coerce a money field to an integer of minor units.
 *
 * A number arrives as an integer already; a string is parsed and TRUNCATED, not
 * rounded up, so we can never invent a kobo the server did not send. Anything
 * unparseable is 0 — a visible zero is safer than NaN leaking into a total.
 */
export function intKobo(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function int(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// ── Enums ───────────────────────────────────────────────────────────────────
const LINES = new Set<ProductLine>([
  'health', 'auto', 'travel', 'gadget', 'life', 'content', 'package',
]);

/**
 * Map whatever the backend labels a line to one of the seven real categories.
 * The aliases exist because MyCover's own category names ("Package") and the
 * older internal vocabulary ("MOTOR", "DEVICE") both show up in fixtures.
 */
const LINE_ALIASES: Record<string, ProductLine> = {
  motor: 'auto', vehicle: 'auto', car: 'auto',
  device: 'gadget', gadget_device: 'gadget',
  home: 'content', property: 'content', sme: 'content',
  goods_in_transit: 'package', git: 'package', business: 'package',
  personal_accident: 'life', creditlife: 'life', credit_life: 'life',
  hmo: 'health', medical: 'health',
};

export function toProductLine(v: unknown): ProductLine {
  const s = str(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (LINES.has(s as ProductLine)) return s as ProductLine;
  return LINE_ALIASES[s] ?? 'package';
}

const POLICY_STATUSES = new Set<PolicyStatus>([
  'pending', 'active', 'expired', 'cancelled', 'lapsed',
]);

export function toPolicyStatus(v: unknown): PolicyStatus {
  const s = str(v).trim().toLowerCase();
  if (POLICY_STATUSES.has(s as PolicyStatus)) return s as PolicyStatus;
  if (s === 'canceled') return 'cancelled';
  if (s === 'inforce' || s === 'in_force') return 'active';
  return 'pending';
}

const CLAIM_STATUSES = new Set<ClaimStatus>([
  'submitted', 'under_review', 'approved', 'rejected', 'paid',
]);

export function toClaimStatus(v: unknown): ClaimStatus {
  const s = str(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (CLAIM_STATUSES.has(s as ClaimStatus)) return s as ClaimStatus;
  if (s === 'settled') return 'paid';
  if (s === 'in_review' || s === 'assessing') return 'under_review';
  return 'submitted';
}

const FIELD_TYPES = new Set<FieldType>([
  'text', 'email', 'phone', 'number', 'money', 'date',
  'select', 'multiselect', 'file', 'image', 'nin', 'address',
  'boolean', 'object', 'array',
]);

/**
 * Coerce a wire field type. Unknown types degrade to `text` rather than being
 * dropped, because a field we cannot draw is still a field the provider will
 * reject the purchase without.
 */
export function toFieldType(v: unknown): FieldType {
  const s = str(v).trim().toLowerCase();
  if (FIELD_TYPES.has(s as FieldType)) return s as FieldType;
  switch (s) {
    case 'string': return 'text';
    case 'integer': case 'int': case 'float': case 'decimal': return 'number';
    case 'amount': case 'currency': case 'money_kobo': return 'money';
    case 'enum': case 'dropdown': return 'select';
    case 'list': case 'multi_select': return 'multiselect';
    case 'datetime': case 'dob': return 'date';
    case 'upload': case 'document': return 'file';
    case 'photo': case 'image_url': return 'image';
    case 'tel': case 'msisdn': case 'phone_number': return 'phone';
    case 'bvn': case 'nin_number': return 'nin';
    case 'bool': case 'checkbox': return 'boolean';
    case 'group': case 'nested': return 'object';
    case 'repeating': case 'repeater': return 'array';
    case 'hidden': return 'text';
    default: return 'text';
  }
}

/** "first_name" / "cargoValue" → "First name" / "Cargo value". */
export function humanizeName(name: string): string {
  const spaced = String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return '';
  const upper = spaced.toUpperCase();
  if (upper === 'NIN' || upper === 'BVN' || upper === 'LGA' || upper === 'VIN') return upper;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
    .replace(/\b(nin|bvn|lga|vin)\b/g, (m) => m.toUpperCase());
}

// ── Form schema ─────────────────────────────────────────────────────────────
function toOptions(v: unknown): FieldOption[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: FieldOption[] = [];
  for (const o of v) {
    if (o == null) continue;
    if (typeof o === 'string' || typeof o === 'number') {
      out.push({ value: String(o), label: String(o) });
      continue;
    }
    const raw = o as Raw;
    const value = str(raw.value ?? raw.id ?? raw.code ?? raw.key);
    if (!value) continue;
    out.push({ value, label: str(raw.label ?? raw.name ?? raw.title, value) });
  }
  return out.length ? out : undefined;
}

function toDependsOn(v: unknown): Field['dependsOn'] {
  if (!v || typeof v !== 'object') return undefined;
  const raw = v as Raw;
  const field = str(raw.field ?? raw.name);
  if (!field) return undefined;
  const out: NonNullable<Field['dependsOn']> = { field };
  const equals = strOrNull(raw.equals ?? raw.value);
  if (equals) out.equals = equals;
  // `query_param` marks an OPTIONS dependency, not a visibility one: the child
  // list is fetched with the parent's answer as `query`. `vehicle_model` with
  // no make returns [], which is how a naive renderer ends up with a dropdown
  // that can never be opened successfully.
  if (bool(raw.query_param ?? raw.queryParam)) out.queryParam = true;
  return out;
}

function isUrl(v: unknown): boolean {
  return /^https?:\/\//i.test(String(v ?? ''));
}

/**
 * MyCover writes small enums into `data_source` as a bracketed list —
 * `"[Male, Female]"`, `"[true, false]"`. "User input" means free text.
 */
function literalEnum(v: unknown): string[] | undefined {
  const s = String(v ?? '').trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return undefined;
  const parts = s.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return parts.length ? parts : undefined;
}

function optInt(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export function mapField(raw: Raw): Field {
  const name = str(raw?.name ?? raw?.key ?? raw?.field);
  // MyCover publishes constraints under `validation` and options under
  // `data_source`. The backend is expected to flatten those into the internal
  // contract, but we accept the provider's own shape too, because a schema that
  // arrives one layer deeper should degrade to a working form rather than a
  // form with no rules on it at all.
  const validation = (raw?.validation ?? {}) as Raw;
  const options = toOptions(raw?.options ?? validation?.enum ?? literalEnum(raw?.data_source));
  const lookup =
    !options &&
    (bool(raw?.remote_options ?? raw?.remoteOptions) ||
      isUrl(raw?.data_source) ||
      isUrl(raw?.options_url));

  // The provider's `type` describes the WIRE type, not the control: `gender`
  // arrives as `type: "string"` with its two allowed values in
  // `validation.enum`. Rendering that as a free-text box would let a person type
  // anything and be refused by the insurer for it, so a declared or fetched set
  // of options promotes the field to a picker.
  const declared = toFieldType(raw?.type ?? validation?.type);
  const type: FieldType =
    (options || lookup) && (declared === 'text' || declared === 'number')
      ? 'select'
      : declared;
  const field: Field = {
    name,
    label: str(raw?.label) || humanizeName(name),
    type,
    required: bool(raw?.required),
  };
  const min = optInt(raw?.min ?? validation?.minimum);
  const max = optInt(raw?.max ?? validation?.maximum);
  const minLength = optInt(raw?.min_length ?? raw?.minLength ?? validation?.min_length);
  const maxLength = optInt(raw?.max_length ?? raw?.maxLength ?? validation?.max_length);
  if (min !== undefined) field.min = min;
  if (max !== undefined) field.max = max;
  if (minLength !== undefined) field.minLength = minLength;
  if (maxLength !== undefined) field.maxLength = maxLength;

  if (options) field.options = options;

  // A `data_source` that is a URL means the options are fetched. The client
  // never sees or follows that URL — it asks OUR backend by product + field —
  // so all we keep is the fact that a lookup is needed.
  if (lookup) field.remoteOptions = true;

  const pattern = strOrNull(raw?.pattern ?? validation?.pattern);
  if (pattern) field.pattern = pattern;

  const children = Array.isArray(raw?.children)
    ? raw.children.map(mapField).filter((f: Field) => f.name)
    : undefined;
  if (children?.length) field.children = children;

  const minRows = optInt(raw?.min_rows ?? raw?.minRows ?? validation?.min_items);
  const maxRows = optInt(raw?.max_rows ?? raw?.maxRows ?? validation?.max_items);
  if (minRows !== undefined) field.minRows = minRows;
  if (maxRows !== undefined) field.maxRows = maxRows;

  const help = strOrNull(raw?.help ?? raw?.hint ?? raw?.description);
  if (help) field.help = help;
  const placeholder = strOrNull(raw?.placeholder);
  if (placeholder) field.placeholder = placeholder;

  const dependsOn = toDependsOn(raw?.depends_on ?? raw?.dependsOn);
  if (dependsOn) field.dependsOn = dependsOn;

  const group = strOrNull(raw?.group ?? raw?.section);
  if (group) field.group = group;

  // Money unit. Defaults to kobo (the contract), but an explicit `naira` is
  // honoured so a provider minimum stated in naira (device_value >= 50000) is
  // scaled correctly instead of being read as ₦500.
  const unit = str(raw?.unit ?? raw?.units).toLowerCase();
  if (unit === 'naira' || unit === 'kobo') field.unit = unit;

  const minDate = strOrNull(raw?.min_date ?? raw?.minDate);
  const maxDate = strOrNull(raw?.max_date ?? raw?.maxDate);
  if (minDate) field.minDate = minDate;
  if (maxDate) field.maxDate = maxDate;
  // The provider rejects a future date of birth; apply that even when the
  // schema does not spell it out, so the user is told before the 400 arrives.
  if (!field.maxDate && type === 'date' && /(^dob$|date_?of_?birth|birth_?date)/i.test(name)) {
    field.maxDate = 'today';
  }

  // `product_id` is the plan UUID the app injects — never a question for a user.
  const hidden = bool(raw?.hidden) || /^(product_id|productId)$/.test(name);
  if (hidden) field.hidden = true;

  return field;
}

/**
 * Options payload for a utility-backed dropdown.
 *
 * Utilities normally return `[{label,value}]` — except the hospital list, which
 * returns an OBJECT (`{name, hospitals:[…]}`). That one is informational, not a
 * form field, so it must never be routed through here; if it ever is, this
 * yields an empty list rather than a screenful of `[object Object]`.
 */
export function mapFieldOptions(body: unknown): FieldOption[] {
  const inner = unwrap(body);
  if (!Array.isArray(inner)) return [];
  return toOptions(inner) ?? [];
}

export function mapFormSchema(raw: unknown): FormSchema | null {
  if (!raw) return null;
  const body = unwrap<Raw>(raw);
  const fields = Array.isArray(body) ? body : body?.fields;
  if (!Array.isArray(fields)) return null;
  const mapped = fields.map(mapField).filter((f) => f.name);
  return { fields: mapped };
}

// ── Product ─────────────────────────────────────────────────────────────────
/**
 * `rate_bps` is authoritative when the backend sends it. When it does not (an
 * older payload), derive it from `base_price_kobo` — for a percentage product
 * the adapter stores the rate scaled by 100 in that field, so 0.5% arrives as
 * 50 kobo. We never re-derive a rate from a naira amount.
 */
function toRateBps(raw: Raw, isPercentage: boolean): number {
  if (!isPercentage) return 0;
  const explicit = raw?.rate_bps ?? raw?.rateBps;
  if (explicit != null && explicit !== '') return int(explicit);
  return intKobo(raw?.base_price_kobo ?? raw?.basePriceKobo);
}

/**
 * Group key for the plan picker. Prefer an explicit family from the backend;
 * fall back to the aggregator prefix (`bastion`, `mcg`, `sti`) which is exactly
 * what the buy endpoint is namespaced by, and finally to the product's own code
 * so an ungrouped product still works as a family of one.
 */
function toFamilyCode(raw: Raw, code: string): string {
  return (
    strOrNull(raw?.family_code ?? raw?.familyCode ?? raw?.family) ??
    strOrNull(raw?.prefix) ??
    code
  );
}

export function mapProduct(raw: Raw): Product {
  const isPercentage = bool(raw?.is_percentage ?? raw?.isPercentage);
  const code = str(raw?.code ?? raw?.id);
  return {
    code,
    familyCode: toFamilyCode(raw, code),
    familyName: str(raw?.family_name ?? raw?.familyName ?? raw?.underwriter ?? raw?.provider),
    providerProductId: strOrNull(
      raw?.provider_product_id ?? raw?.providerProductId ?? raw?.product_id,
    ),
    name: str(raw?.name ?? raw?.display_name, 'Cover'),
    description: str(raw?.description),
    productLine: toProductLine(raw?.product_line ?? raw?.productLine ?? raw?.category),
    category: str(raw?.category ?? raw?.product_line),
    underwriter: str(raw?.underwriter ?? raw?.provider),
    underwriterLogoUrl: strOrNull(raw?.underwriter_logo_url ?? raw?.underwriterLogoUrl),
    aggregator: str(raw?.aggregator, 'mycover'),

    basePriceKobo: intKobo(raw?.base_price_kobo ?? raw?.basePriceKobo),
    isPercentage,
    rateBps: toRateBps(raw, isPercentage),

    sumInsuredKobo: intKobo(raw?.sum_insured_kobo ?? raw?.sumInsuredKobo),
    coverPeriodDays: int(raw?.cover_period_days ?? raw?.coverPeriodDays),

    isRenewable: bool(raw?.is_renewable ?? raw?.isRenewable),
    isClaimable: bool(raw?.is_claimable ?? raw?.isClaimable),
    isCertificateable: bool(raw?.is_certificateable ?? raw?.isCertificateable),

    keyBenefitsHtml: str(raw?.key_benefits_html ?? raw?.key_benefits),
    fullBenefitsHtml: str(raw?.full_benefits_html ?? raw?.full_benefits),
    howItWorksHtml: str(raw?.how_it_works_html ?? raw?.how_it_works),
    howToClaimHtml: str(raw?.how_to_claim_html ?? raw?.how_to_claim),

    // `active` defaults TRUE when absent: a catalog the backend chose to return
    // is a catalog it means us to show. Only an explicit false hides a product.
    active: raw?.active == null ? true : bool(raw.active),
    // `purchasable` also defaults TRUE — but an explicit false closes the buy
    // path for the seven products broken on the provider's side, so nobody is
    // walked through a full application only to be refused at pricing.
    purchasable: raw?.purchasable == null ? true : bool(raw.purchasable),
    providerConfigStatus: strOrNull(raw?.provider_config_status ?? raw?.providerConfigStatus),
    formSchema: mapFormSchema(raw?.form_schema ?? raw?.formSchema),
  };
}

export function mapProducts(body: unknown): Product[] {
  return unwrapList<Raw>(body).map(mapProduct).filter((p) => p.code);
}

// ── Quote ───────────────────────────────────────────────────────────────────
export function mapQuote(body: unknown): Quote {
  const raw = unwrap<Raw>(body) ?? {};
  return {
    quoteRef: str(raw.quote_ref ?? raw.quoteRef ?? raw.id),
    productCode: str(raw.product_code ?? raw.productCode),
    premiumKobo: intKobo(raw.premium_kobo ?? raw.premiumKobo),
    sumInsuredKobo: intKobo(raw.sum_insured_kobo ?? raw.sumInsuredKobo),
    commissionKobo: intKobo(raw.commission_kobo ?? raw.commissionKobo),
    currency: 'NGN',
    underwriter: str(raw.underwriter),
    expiresAt: strOrNull(raw.expires_at ?? raw.expiresAt),
    terms: str(raw.terms),
  };
}

// ── Policy ──────────────────────────────────────────────────────────────────
export function mapPolicy(raw: Raw): Policy {
  return {
    id: str(raw?.id ?? raw?.policy_id),
    policyRef: str(raw?.policy_ref ?? raw?.policyRef ?? raw?.id),
    providerPolicyRef: strOrNull(raw?.provider_policy_ref ?? raw?.providerPolicyRef),
    productCode: str(raw?.product_code ?? raw?.productCode),
    productName: str(raw?.product_name ?? raw?.productName, 'Cover'),
    underwriter: str(raw?.underwriter),
    status: toPolicyStatus(raw?.status),
    premiumKobo: intKobo(raw?.premium_kobo ?? raw?.premiumKobo),
    sumInsuredKobo: intKobo(raw?.sum_insured_kobo ?? raw?.sumInsuredKobo),
    currency: 'NGN',
    startsAt: strOrNull(raw?.starts_at ?? raw?.startsAt),
    endsAt: strOrNull(raw?.ends_at ?? raw?.endsAt),
    certificateUrl: strOrNull(raw?.certificate_url ?? raw?.certificateUrl),
    createdAt: strOrNull(raw?.created_at ?? raw?.createdAt),
    claimUrl: strOrNull(raw?.claim_url ?? raw?.claimUrl ?? raw?.sdk?.claim_link),
    inspectionUrl: strOrNull(
      raw?.inspection_url ?? raw?.inspectionUrl ?? raw?.sdk?.inspection_link,
    ),
  };
}

export function mapPolicies(body: unknown): Policy[] {
  return unwrapList<Raw>(body).map(mapPolicy).filter((p) => p.id);
}

// ── Claim ───────────────────────────────────────────────────────────────────
function mapEvidence(raw: unknown, index: number): ClaimEvidence {
  if (typeof raw === 'string') {
    return { id: `ev-${index}`, name: fileNameFromUrl(raw), url: raw, uploadedAt: null };
  }
  const r = (raw ?? {}) as Raw;
  const url = str(r.url ?? r.uri ?? r.href);
  return {
    id: str(r.id, `ev-${index}`),
    name: str(r.name ?? r.label) || fileNameFromUrl(url),
    url,
    uploadedAt: strOrNull(r.uploaded_at ?? r.uploadedAt),
  };
}

function fileNameFromUrl(url: string): string {
  const clean = String(url ?? '').split('?')[0];
  const last = clean.split('/').pop() ?? '';
  return last || 'Attachment';
}

export function mapClaim(raw: Raw): Claim {
  const evidence = Array.isArray(raw?.evidence) ? raw.evidence : [];
  return {
    id: str(raw?.id ?? raw?.claim_id),
    claimRef: str(raw?.claim_ref ?? raw?.claimRef ?? raw?.id),
    providerClaimRef: strOrNull(raw?.provider_claim_ref ?? raw?.providerClaimRef),
    policyId: str(raw?.policy_id ?? raw?.policyId),
    status: toClaimStatus(raw?.status),
    claimedAmountKobo: intKobo(raw?.claimed_amount_kobo ?? raw?.claimedAmountKobo ?? raw?.amount_kobo),
    approvedAmountKobo:
      raw?.approved_amount_kobo == null && raw?.approvedAmountKobo == null
        ? null
        : intKobo(raw?.approved_amount_kobo ?? raw?.approvedAmountKobo),
    lossEventAt: strOrNull(raw?.loss_event_at ?? raw?.lossEventAt),
    description: str(raw?.description),
    evidence: evidence.map(mapEvidence),
    createdAt: strOrNull(raw?.created_at ?? raw?.createdAt),
  };
}

export function mapClaims(body: unknown): Claim[] {
  return unwrapList<Raw>(body).map(mapClaim).filter((c) => c.id);
}

// ── Errors ──────────────────────────────────────────────────────────────────
const FRIENDLY: Record<string, string> = {
  KYC_TIER_INSUFFICIENT: 'You need a higher verification level before you can buy this cover.',
  INSUFFICIENT_FUNDS: 'Your wallet balance is too low for this premium.',
  QUOTE_EXPIRED: 'That quote has expired. Get a fresh price and try again.',
  PROVIDER_UNAVAILABLE: 'The insurer is not responding right now. Nothing was charged — please try again shortly.',
  PROVIDER_TIMEOUT: 'The insurer did not respond in time. Nothing was charged — please try again shortly.',
  DUPLICATE_REQUEST: 'This purchase was already submitted.',
  FEATURE_DISABLED: 'Protection is not switched on for your account yet.',
  VALIDATION_FAILED: 'Some details need fixing before we can continue.',
};

/**
 * Turn any failure — axios error, error envelope, provider validation array —
 * into one shape screens can render and the dynamic form can attribute.
 *
 * MyCover returns `responseText` as an ARRAY of human strings on validation
 * failure ("first_name must be longer than 2 characters"). Where the backend
 * passes those through, we split each one back onto its field so the message
 * lands under the input that caused it rather than in a generic red banner.
 */
export function toInsuranceError(err: unknown): InsuranceError {
  const anyErr = err as Raw;
  const status: number | null = anyErr?.response?.status ?? null;
  const body = anyErr?.response?.data ?? anyErr?.data ?? null;
  const envelope = (body?.error ?? body) as Raw | null;

  const code = str(envelope?.code ?? anyErr?.code, status === 404 ? 'NOT_FOUND' : 'UNKNOWN');

  const rawMessage = envelope?.message ?? envelope?.responseText ?? anyErr?.message;
  const messages: string[] = Array.isArray(rawMessage)
    ? rawMessage.map((m) => str(m))
    : [str(rawMessage)];

  const fieldErrors: Record<string, string> = {};
  // Explicit per-field map, when the backend supplies one.
  const explicit = envelope?.fields ?? envelope?.field_errors ?? envelope?.fieldErrors;
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
    for (const [k, v] of Object.entries(explicit as Raw)) {
      fieldErrors[k] = Array.isArray(v) ? str(v[0]) : str(v);
    }
  }
  // Otherwise recover the field from the leading token of each message.
  for (const m of messages) {
    const attributed = attributeMessage(m);
    if (attributed && !fieldErrors[attributed.field]) {
      fieldErrors[attributed.field] = attributed.message;
    }
  }

  const friendly =
    FRIENDLY[code] ||
    messages.filter(Boolean).join('\n') ||
    (status === 404
      ? 'This is not available yet.'
      : 'Something went wrong. Please try again.');

  return { code, message: friendly, fieldErrors, status };
}

/**
 * "nin must be exactly 11 characters" → { field: 'nin', message: 'Nin must be…' }
 * Returns null when the message does not start with a field-shaped token.
 */
export function attributeMessage(message: string): { field: string; message: string } | null {
  const m = String(message ?? '').trim();
  if (!m) return null;
  const match = /^([a-z][a-z0-9_]{1,60})(?:\.\d+)?\s+(.+)$/i.exec(m);
  if (!match) return null;
  const field = match[1];
  // A leading capitalised English word ("Please", "Your") is prose, not a field.
  if (/^[A-Z]/.test(field) && !field.includes('_')) return null;
  const rest = match[2];
  return { field, message: rest.charAt(0).toUpperCase() + rest.slice(1) };
}
