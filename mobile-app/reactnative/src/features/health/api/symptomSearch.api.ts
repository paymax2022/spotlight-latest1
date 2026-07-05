// ── Paymax Health — Pharmacy symptom-based medication search (addon) ─────────
// Typed client for POST /pharmacy/symptom-search + GET /pharmacy/classes/{id}/skus
// (contracts/openapi.yaml is the source of truth for these shapes).
//
// POSITIONING (PRD §0): symptom-guided product DISCOVERY with professional
// review — NOT diagnosis, NOT prescribing. Copy discipline (PRD §5.6): always
// "options for your symptoms", never "treatment for your condition". No dosing
// advice beyond "use as directed on pack / by your pharmacist".
//
// Mock-first (shared USE_MOCK flag), mirroring pharmacy/api.ts. Money in kobo.

import { api } from '@/api/client';
import { getSecureItem, setSecureItem } from '@/lib/secureStorage';
import { USE_MOCK, HEALTH_API_BASE } from '../constants/health.constants';

const PHARMACY_API = `${HEALTH_API_BASE}/pharmacy`;
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// ── Feature flag ──────────────────────────────────────────────────────────────
// Follows the EXPO_PUBLIC_HEALTH_* convention (see PHARMACY_BNPL_ENABLED).
// Server-side twin: FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED.
export const PHARMACY_SYMPTOM_SEARCH_ENABLED =
  (process.env.EXPO_PUBLIC_HEALTH_PHARMACY_SYMPTOM_SEARCH ?? 'true') === 'true';

// ── Types (mirror openapi.yaml SymptomSearchResult & friends) ────────────────
export type TriageTier = 'T1' | 'T2' | 'T3' | 'T4';

export type SymptomWho = 'ADULT' | 'CHILD_6_12' | 'CHILD_UNDER_6' | 'PREGNANT_OR_BF';
export type SymptomDuration = 'TODAY' | 'D2_3' | 'GT_3D';

export interface SymptomRefiners {
  who?: SymptomWho;
  duration?: SymptomDuration;
}

export interface SymptomSearchInput {
  /** Raw symptom terms as typed/tapped (1–5, any supported language). */
  terms: string[];
  refiners?: SymptomRefiners;
}

export interface SymptomClusterMatch {
  id: string;
  name: string;
  triage_tier: TriageTier;
  /** Canonical concept names the user's terms resolved to. */
  matched_concepts: string[];
}

export interface SymptomClassGroup {
  class_id: string;
  /** e.g. "Pain & fever relief (Paracetamol-based)". */
  name: string;
  rank: number;
  /** Label-level guidance only, e.g. "not on an empty stomach". Never dosing advice. */
  usage_note?: string;
  /** Link to /pharmacy/classes/{id}/skus for live stock. */
  skus_url?: string;
}

// NOTE: UPLOAD_RX is NOT in the openapi enum (PHARMACIST_CHAT | TELEHEALTH_CONSULT |
// EMERGENCY_GUIDANCE | NEAREST_FACILITY) — kept here for forward-compat; unknown
// types are rendered as plain links routed by `target`.
export type EscalationActionType =
  | 'PHARMACIST_CHAT'
  | 'TELEHEALTH_CONSULT'
  | 'EMERGENCY_GUIDANCE'
  | 'NEAREST_FACILITY'
  | 'UPLOAD_RX';

export interface SymptomEscalationAction {
  type: EscalationActionType;
  label: string;
  /** Deep link / route into the existing intake or MapService surface. */
  target?: string;
}

/** Returned for T3/T4 — explains what was flagged and routes to care; no products. */
export interface SymptomEscalationCard {
  severity: 'CONSULT' | 'EMERGENCY';
  /** Human-readable reasons, e.g. "fever for more than 3 days". */
  flagged: string[];
  actions: SymptomEscalationAction[];
}

export interface SymptomSearchResult {
  tier: TriageTier;
  clusters?: SymptomClusterMatch[];
  /** Present for T1/T2 only. Cohort-excluded classes are SUPPRESSED, never disabled. */
  class_groups?: SymptomClassGroup[];
  escalation_card?: SymptomEscalationCard;
  /** true for every T2 result — add-to-cart is blocked until a pharmacist confirms. */
  pharmacist_confirmation_required?: boolean;
  /** Versioned copy — always "options for your symptoms". */
  disclaimer: string;
  /**
   * Server-logged symptom-search event id (uuid). Pass through as top-level
   * `search_event_id` on POST /pharmacy/orders so the order links back to this
   * symptom context (T1 orders auto-clear; T2+ open a pharmacist review case).
   */
  search_event_id?: string | null;
}

export interface PharmacySkuOption {
  id: string;
  /** pharmacy_products.id */
  product_id: string;
  name: string;
  brand: string;
  pack_size: string;
  price_kobo: number;
  nafdac_reg_no: string;
  /** POM / BLOCKED_ONLINE never appear on this surface. */
  classification: 'OTC' | 'PHARMACY_ONLY';
  therapeutic_class_id: string;
  in_stock: boolean;
  /** Rolling-window abuse cap; null = uncapped. */
  max_qty_per_window: number | null;
}

// ── Copy (PRD §5.6 — versioned, "options" never "treatment") ─────────────────
export const SYMPTOM_DISCLAIMER_COPY =
  'These are general options for your symptoms, not a diagnosis.';
export const SYMPTOM_PHARMACIST_LINK_COPY = 'Speak to a pharmacist free — tap here.';
export const NO_DOSING_COPY = 'Use as directed on pack / by your pharmacist.';

export const SYMPTOM_CHIPS = [
  'Headache',
  'Fever',
  'Cough',
  'Catarrh',
  'Body pain',
  'Stomach upset',
  'Allergy',
  'Menstrual pain',
] as const;

export const WHO_OPTIONS: { value: SymptomWho; label: string }[] = [
  { value: 'ADULT', label: 'Adult' },
  { value: 'CHILD_6_12', label: 'Child 6–12' },
  { value: 'CHILD_UNDER_6', label: 'Child under 6' },
  { value: 'PREGNANT_OR_BF', label: 'Pregnant or breastfeeding' },
];

export const DURATION_OPTIONS: { value: SymptomDuration; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'D2_3', label: '2–3 days' },
  { value: 'GT_3D', label: 'More than 3 days' },
];

// ── "No term matched" (contract: 404, logged server-side for curation) ───────
export class SymptomNotMatchedError extends Error {
  readonly code = 'SYMPTOM_NOT_MATCHED';
  constructor() {
    super('No symptom term matched');
  }
}

export function isNotMatched(err: unknown): boolean {
  if (err instanceof SymptomNotMatchedError) return true;
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 404;
}

// ── Mock taxonomy (term → concept → cluster → class), PRD §4 shape ────────────
type Concept =
  | 'headache'
  | 'fever'
  | 'cough'
  | 'catarrh'
  | 'body_pain'
  | 'stomach_upset'
  | 'allergy'
  | 'menstrual_pain';

const TERM_TO_CONCEPT: [RegExp, Concept][] = [
  [/head\s?ache|migraine|my head/i, 'headache'],
  [/fever|temperature|hot body|body (dey )?hot/i, 'fever'],
  [/cough/i, 'cough'],
  [/catarrh|runny nose|blocked nose|cold/i, 'catarrh'],
  [/body (dey )?pain|body pain|aches?|myalgia|pain me/i, 'body_pain'],
  [/stomach|belle|belly|indigestion|heartburn|diarrh|purg/i, 'stomach_upset'],
  [/allerg|itch|sneez|hives|rash/i, 'allergy'],
  [/menstrual|period pain|cramps?|dysmenorrh/i, 'menstrual_pain'],
];

// Red-flag phrasing → straight to T4 (PRD Journey C).
const EMERGENCY_RE =
  /chest pain|breathless|can'?t breathe|difficulty breathing|convuls|seizure|unconscious|collaps|severe bleeding|stiff neck|slurred/i;

const CLS = {
  para: 'cls_paracetamol',
  ibu: 'cls_ibuprofen',
  cold: 'cls_cough_cold',
  antacid: 'cls_stomach',
  allergy: 'cls_antihistamine',
  mens: 'cls_menstrual',
} as const;

const CLASS_META: Record<string, { name: string; usage_note?: string }> = {
  [CLS.para]: { name: 'Pain & fever relief (Paracetamol-based)' },
  [CLS.ibu]: { name: 'Pain & fever relief (Ibuprofen-based)', usage_note: 'Not on an empty stomach.' },
  [CLS.cold]: { name: 'Cough & catarrh relief', usage_note: 'Some options may cause drowsiness.' },
  [CLS.antacid]: { name: 'Stomach upset relief (antacids & rehydration)', usage_note: 'Drink plenty of clean water.' },
  [CLS.allergy]: { name: 'Allergy relief (antihistamines)', usage_note: 'Non-drowsy options available.' },
  [CLS.mens]: { name: 'Menstrual pain relief', usage_note: 'Not on an empty stomach.' },
};

const MOCK_CLASS_SKUS: Record<string, PharmacySkuOption[]> = {
  [CLS.para]: [
    { id: 'sku_para_mb', product_id: 'prod_para', name: 'Paracetamol', brand: 'M&B', pack_size: '500mg · 24 tablets', price_kobo: 65000, nafdac_reg_no: 'A4-0991', classification: 'OTC', therapeutic_class_id: CLS.para, in_stock: true, max_qty_per_window: 3 },
    { id: 'sku_para_emzor', product_id: 'prod_para_emzor', name: 'Paracetamol', brand: 'Emzor', pack_size: '500mg · 96 tablets', price_kobo: 120000, nafdac_reg_no: 'A4-1002', classification: 'OTC', therapeutic_class_id: CLS.para, in_stock: true, max_qty_per_window: 2 },
    { id: 'sku_panadol_x', product_id: 'prod_panadol_x', name: 'Panadol Extra', brand: 'GSK', pack_size: '500mg/65mg · 24 caplets', price_kobo: 185000, nafdac_reg_no: 'A4-3355', classification: 'OTC', therapeutic_class_id: CLS.para, in_stock: false, max_qty_per_window: 2 },
  ],
  [CLS.ibu]: [
    { id: 'sku_ibu_advil', product_id: 'prod_ibu_advil', name: 'Ibuprofen', brand: 'Advil', pack_size: '200mg · 24 tablets', price_kobo: 145000, nafdac_reg_no: 'A4-2210', classification: 'OTC', therapeutic_class_id: CLS.ibu, in_stock: true, max_qty_per_window: 2 },
    { id: 'sku_ibucap', product_id: 'prod_ibucap', name: 'Ibucap', brand: 'Fidson', pack_size: '200mg/325mg · 20 capsules', price_kobo: 98000, nafdac_reg_no: 'A4-4471', classification: 'OTC', therapeutic_class_id: CLS.ibu, in_stock: true, max_qty_per_window: 2 },
  ],
  [CLS.cold]: [
    { id: 'sku_procold', product_id: 'prod_procold', name: 'Procold', brand: 'Afrab-Chem', pack_size: '10 tablets', price_kobo: 55000, nafdac_reg_no: 'A4-5120', classification: 'OTC', therapeutic_class_id: CLS.cold, in_stock: true, max_qty_per_window: 2 },
    { id: 'sku_tuxil', product_id: 'prod_tuxil', name: 'Tuxil-D Syrup', brand: 'Dana Pharma', pack_size: '100ml', price_kobo: 130000, nafdac_reg_no: 'A4-6019', classification: 'PHARMACY_ONLY', therapeutic_class_id: CLS.cold, in_stock: true, max_qty_per_window: 1 },
  ],
  [CLS.antacid]: [
    { id: 'sku_gestid', product_id: 'prod_gestid', name: 'Gestid Suspension', brand: 'Ranbaxy', pack_size: '200ml', price_kobo: 165000, nafdac_reg_no: 'A4-7712', classification: 'OTC', therapeutic_class_id: CLS.antacid, in_stock: true, max_qty_per_window: 2 },
    { id: 'sku_ors', product_id: 'prod_oral', name: 'ORS Sachets', brand: 'Emzor', pack_size: '10 sachets', price_kobo: 90000, nafdac_reg_no: 'A4-3310', classification: 'OTC', therapeutic_class_id: CLS.antacid, in_stock: true, max_qty_per_window: null },
  ],
  [CLS.allergy]: [
    { id: 'sku_lora', product_id: 'prod_lora', name: 'Loratadine', brand: 'Emzor', pack_size: '10mg · 10 tablets', price_kobo: 60000, nafdac_reg_no: 'A4-8823', classification: 'OTC', therapeutic_class_id: CLS.allergy, in_stock: true, max_qty_per_window: 2 },
    { id: 'sku_cetri', product_id: 'prod_cetri', name: 'Cetirizine', brand: 'M&B', pack_size: '10mg · 10 tablets', price_kobo: 52000, nafdac_reg_no: 'A4-9034', classification: 'OTC', therapeutic_class_id: CLS.allergy, in_stock: true, max_qty_per_window: 2 },
  ],
  [CLS.mens]: [
    { id: 'sku_buscopan', product_id: 'prod_buscopan', name: 'Buscopan', brand: 'Sanofi', pack_size: '10mg · 20 tablets', price_kobo: 210000, nafdac_reg_no: 'A4-1140', classification: 'PHARMACY_ONLY', therapeutic_class_id: CLS.mens, in_stock: true, max_qty_per_window: 1 },
    { id: 'sku_felvin', product_id: 'prod_felvin', name: 'Felvin', brand: 'Fidson', pack_size: '20mg · 10 capsules', price_kobo: 115000, nafdac_reg_no: 'A4-2288', classification: 'OTC', therapeutic_class_id: CLS.mens, in_stock: true, max_qty_per_window: 2 },
  ],
};

const CONCEPT_TO_CLASSES: Record<Concept, string[]> = {
  headache: [CLS.para, CLS.ibu],
  fever: [CLS.para, CLS.ibu],
  body_pain: [CLS.para, CLS.ibu],
  cough: [CLS.cold],
  catarrh: [CLS.cold],
  stomach_upset: [CLS.antacid],
  allergy: [CLS.allergy],
  menstrual_pain: [CLS.mens, CLS.para],
};

const MOCK_DISCLAIMER =
  'These are general options for your symptoms, not a diagnosis. A licensed pharmacist is available free of charge.';

/** Plausible uuid v4 for the mock's search_event_id (backend issues the real one). */
function mockUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Mock resolution engine — mirrors the tier rules in PRD §4 for demo purposes. */
function mockResolve(input: SymptomSearchInput): SymptomSearchResult {
  const raw = input.terms.map((t) => t.trim()).filter(Boolean);
  const refiners = input.refiners ?? {};
  const search_event_id = mockUuid();

  // T4 — red-flag phrasing → emergency guidance, no commerce UI.
  if (raw.some((t) => EMERGENCY_RE.test(t))) {
    return {
      tier: 'T4',
      clusters: [{ id: 'clu_emergency', name: 'Red-flag presentation', triage_tier: 'T4', matched_concepts: [] }],
      escalation_card: {
        severity: 'EMERGENCY',
        flagged: ['What you described can signal a serious condition that needs in-person emergency care now.'],
        actions: [
          { type: 'EMERGENCY_GUIDANCE', label: 'See emergency guidance' },
          { type: 'NEAREST_FACILITY', label: 'Find the nearest facility', target: '/health/triage/emergency' },
          { type: 'PHARMACIST_CHAT', label: 'Chat with a pharmacist', target: '/health/pharmacy/pharmacist-consult' },
        ],
      },
      disclaimer: MOCK_DISCLAIMER,
      search_event_id,
    };
  }

  const concepts = [...new Set(raw.flatMap((t) => TERM_TO_CONCEPT.filter(([re]) => re.test(t)).map(([, c]) => c)))];
  if (concepts.length === 0) throw new SymptomNotMatchedError();

  const hasFever = concepts.includes('fever');

  // T3 — consult required (fever >3 days, or fever in a child under 6).
  const flagged: string[] = [];
  if (hasFever && refiners.duration === 'GT_3D') flagged.push('Fever for more than 3 days needs a professional assessment.');
  if (hasFever && refiners.who === 'CHILD_UNDER_6') flagged.push('Fever in a child under 6 should be assessed by a professional.');
  if (flagged.length > 0) {
    return {
      tier: 'T3',
      clusters: [{ id: 'clu_fever_escalate', name: 'Fever — assessment needed', triage_tier: 'T3', matched_concepts: concepts }],
      escalation_card: {
        severity: 'CONSULT',
        flagged,
        actions: [
          { type: 'PHARMACIST_CHAT', label: 'Start free pharmacist chat', target: '/health/pharmacy/pharmacist-consult' },
          { type: 'TELEHEALTH_CONSULT', label: 'Book a telehealth consult', target: '/services/telemedicine' },
        ],
      },
      disclaimer: MOCK_DISCLAIMER,
      search_event_id,
    };
  }

  // Class groups; cohort exclusions SUPPRESS a group entirely (Journey B).
  let classIds = [...new Set(concepts.flatMap((c) => CONCEPT_TO_CLASSES[c]))];
  const pregnant = refiners.who === 'PREGNANT_OR_BF';
  const childUnder6 = refiners.who === 'CHILD_UNDER_6';
  if (pregnant || childUnder6) classIds = classIds.filter((id) => id !== CLS.ibu && id !== CLS.mens);

  // T2 — OTC possible but judgment needed (pregnancy, infant, long duration).
  const tier: TriageTier = pregnant || childUnder6 || refiners.duration === 'GT_3D' ? 'T2' : 'T1';

  return {
    tier,
    clusters: [
      { id: 'clu_minor', name: 'Minor, self-limiting symptoms', triage_tier: tier, matched_concepts: concepts },
    ],
    class_groups: classIds.map((id, i) => ({
      class_id: id,
      name: CLASS_META[id].name,
      rank: i + 1,
      usage_note: CLASS_META[id].usage_note,
      skus_url: `/pharmacy/classes/${id}/skus`,
    })),
    pharmacist_confirmation_required: tier === 'T2',
    disclaimer: MOCK_DISCLAIMER,
    search_event_id,
  };
}

// ── Device id (X-Device-Id) ───────────────────────────────────────────────────
// Stable per-install uuid for the backend's per-user+device symptom-search rate
// limit (the handler only ever stores a salted SHA-256 of it, never the raw id).
// Persisted via secure storage; sent ONLY on symptom-search requests. Failures
// degrade to no header — the backend then meters by client IP instead.
const DEVICE_ID_KEY = 'symptom_search_device_id';

async function getDeviceId(): Promise<string | null> {
  try {
    const existing = await getSecureItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    const id = typeof g.crypto?.randomUUID === 'function' ? g.crypto.randomUUID() : mockUuid();
    await setSecureItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * POST /pharmacy/symptom-search — resolves terms to exactly one triage tier.
 * T1/T2 → class_groups (SKUs fetched per class); T3/T4 → escalation_card only.
 * NDPR: sensitive health data — rate-limited per device, excluded from analytics.
 */
export async function symptomSearch(input: SymptomSearchInput): Promise<SymptomSearchResult> {
  if (USE_MOCK) {
    await delay(450);
    return mockResolve(input);
  }
  const deviceId = await getDeviceId();
  const { data } = await api.post<{ data: SymptomSearchResult }>(
    `${PHARMACY_API}/symptom-search`,
    input,
    deviceId ? { headers: { 'X-Device-Id': deviceId } } : undefined,
  );
  return data.data;
}

/**
 * GET /pharmacy/classes/{id}/skus — live in-stock, NAFDAC-registered SKUs for a
 * therapeutic class. Only OTC / PHARMACY_ONLY ever appear on this surface.
 */
export async function getClassSkus(
  classId: string,
  opts?: { who?: SymptomWho; region?: string },
): Promise<PharmacySkuOption[]> {
  if (USE_MOCK) {
    await delay(300);
    const skus = MOCK_CLASS_SKUS[classId];
    if (!skus) throw new Error('Unknown therapeutic class');
    return skus;
  }
  const { data } = await api.get<{ data: PharmacySkuOption[] }>(`${PHARMACY_API}/classes/${classId}/skus`, {
    params: opts,
  });
  return data.data;
}
