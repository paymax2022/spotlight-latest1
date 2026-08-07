// ── Insurance — live-response normalisation ──────────────────────────────────
// The Go catalog surface returns a `{ "data": [...] }` envelope of snake_case,
// routing-oriented rows. Screens only ever consume the normalised camelCase
// `InsuranceProduct` (PRD §7 — provider/back-end JSON never leaks past api.ts).
// This module is the single mapping boundary; keep it presentation-only.
//
// Money stays in kobo (minor units) end to end — no conversions here.

import type {
  BindingMode,
  FieldSchema,
  InsuranceProduct,
  KycTier,
  PremiumModel,
  ProductLine,
  Provider,
} from './types';

// ── Envelope ─────────────────────────────────────────────────────────────────
/** Unwrap `{ data: T }` (Go handler envelope) or accept a bare payload. */
export function unwrapList<T = unknown>(body: unknown): T[] {
  const inner = isEnvelope(body) ? body.data : body;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** Unwrap a single `{ data: T }` object, or accept a bare object. */
export function unwrapOne<T = unknown>(body: unknown): T {
  return (isEnvelope(body) ? body.data : body) as T;
}

function isEnvelope(b: unknown): b is { data: unknown } {
  return typeof b === 'object' && b !== null && 'data' in b;
}

// ── Enum coercions (lenient — unknown values fall back, never throw) ─────────
function toProvider(raw: unknown): Provider {
  return String(raw ?? '').toLowerCase() === 'octamile' ? 'OCTAMILE' : 'MYCOVER';
}

function aggregatorLabel(provider: Provider): string {
  return provider === 'OCTAMILE' ? 'Octamile' : 'MyCover.ai';
}

function toBindingMode(raw: unknown): BindingMode {
  return String(raw ?? '').toLowerCase() === 'embedded' ? 'EMBEDDED' : 'VOLUNTARY';
}

function toPremiumModel(raw: unknown): PremiumModel {
  switch (String(raw ?? '').toLowerCase()) {
    case 'flat': return 'FLAT';
    case 'per_shipment': return 'PER_SHIPMENT';
    case 'usage': return 'USAGE';
    default: return 'TIERED'; // tiered / declared_value / unknown
  }
}

function toTier(raw: unknown): KycTier {
  const n = Number(raw ?? 0);
  return (['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'][n] ?? 'TIER_0') as KycTier;
}

const CADENCES: InsuranceProduct['premiumCadence'][] = [
  'one-off', 'monthly', 'annual', 'per-shipment', 'per-trip',
];
function toCadence(raw: unknown): InsuranceProduct['premiumCadence'] {
  const v = String(raw ?? '').toLowerCase() as InsuranceProduct['premiumCadence'];
  return CADENCES.includes(v) ? v : 'annual';
}

// ── Presentation lookups (pure display, kept inline so this stays hermetic and
// unit-testable under plain Node). Mirrors PRODUCT_LINES in insurance.constants;
// the catalog never carries icon/description — they are line-level presentation.
const LINE_ICON: Record<string, string> = {
  HEALTH: 'HeartPulse',
  PERSONAL_ACCIDENT: 'ShieldPlus',
  DEVICE: 'Smartphone',
  SME: 'Building2',
  MOTOR: 'Car',
  GOODS_IN_TRANSIT: 'Truck',
};
const LINE_DESC: Record<string, string> = {
  HEALTH: 'Micro-health and hospital cover',
  PERSONAL_ACCIDENT: 'Income & injury protection',
  DEVICE: 'Phone, laptop & gadget cover',
  SME: 'Cover for your small business',
  MOTOR: 'Third-party & comprehensive',
  GOODS_IN_TRANSIT: 'Protect parcels & freight',
};

/** "fullName" / "device_value" → "Full Name" / "Device Value". */
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const FIELD_TYPES: Record<string, FieldSchema['type']> = {
  string: 'text', text: 'text', number: 'number', integer: 'number',
  date: 'date', select: 'select', currency: 'currency',
};

function toFieldsSchema(raw: unknown): FieldSchema[] {
  const fields = (raw as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => {
    const name = String((f as { name?: unknown }).name ?? '');
    return {
      key: name,
      label: humanize(name),
      type: FIELD_TYPES[String((f as { type?: unknown }).type ?? 'string').toLowerCase()] ?? 'text',
      required: Boolean((f as { required?: unknown }).required),
    };
  });
}

function toSumInsuredRules(raw: unknown): InsuranceProduct['sumInsuredRules'] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const basis = String(r.basis ?? 'fixed') === 'declared_value' ? 'declared_value' : 'fixed';
  return { min: Number(r.min ?? 0), max: Number(r.max ?? 0), basis };
}

// ── The mapping ──────────────────────────────────────────────────────────────
/** Map one raw Go catalog row → normalised InsuranceProduct. */
export function mapCatalogProduct(raw: any): InsuranceProduct {
  const provider = toProvider(raw?.provider);
  const productLine = String(raw?.product_line ?? 'GENERAL') as ProductLine;
  return {
    code: String(raw?.code ?? ''),
    displayName: String(raw?.display_name ?? raw?.code ?? 'Cover'),
    shortDescription: LINE_DESC[productLine] ?? '',
    productLine,
    provider,
    bindingMode: toBindingMode(raw?.binding_mode),
    premiumModel: toPremiumModel(raw?.premium_model),
    fromPremiumKobo: Number(raw?.indicative_premium_kobo ?? 0),
    premiumCadence: toCadence(raw?.premium_cadence),
    requiredKycTier: toTier(raw?.required_kyc_tier),
    disclosure: {
      underwriter: String(raw?.underwriter_display ?? ''),
      aggregator: aggregatorLabel(provider),
    },
    sumInsuredRules: toSumInsuredRules(raw?.sum_insured_rules),
    // Benefits/exclusions are surfaced at quote time by the provider, not the
    // catalog — the detail screen fills them from the Quote.
    benefits: [],
    exclusions: [],
    icon: LINE_ICON[productLine] ?? 'ShieldCheck',
    fieldsSchema: toFieldsSchema(raw?.required_fields_schema_ref),
    active: Boolean(raw?.active),
  };
}

/** Map a raw catalog list payload (envelope or array) → products. */
export function mapCatalogList(body: unknown): InsuranceProduct[] {
  return unwrapList(body).map(mapCatalogProduct);
}
