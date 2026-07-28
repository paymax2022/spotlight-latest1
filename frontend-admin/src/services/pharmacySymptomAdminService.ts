// ── Admin — Paymax Health · Pharmacy Symptom-Based Medication Search ──────────
// Pharmacist console service for the symptom-search addon (PRD
// docs/health/Pharmacy_Symptom_Search_Addon_PRD.md §4 suggest-approve, §8
// console screens, §9 SLA). Mirrors healthPharmacyAdminService: mock by
// default, flip with NEXT_PUBLIC_HEALTH_USE_MOCK=false to hit the live Go
// backend. Every mutation sends an Idempotency-Key (contracts/openapi.yaml
// /admin/pharmacy/* ~5262-5342). RBAC: health.pharmacy.symptom.* wired on the
// sidebar; server enforcement is authoritative.
//
// Suggest-approve gravity: nothing AI_SUGGESTED is user-visible until a
// licensed pharmacist approves it here — approvals go live immediately.

import { env } from '@/config/env';

// ── URL constants (single place to fix if backend paths differ) ──────────────
// Base mirrors healthPharmacyAdminService: env.apiBaseUrl ends with /api/v1 and
// pharmacy admin routes hang off /api/health/pharmacy/admin/*.
const ADMIN_BASE_SUFFIX = '/api/health/pharmacy/admin';
export const URL_REVIEW_QUEUE = '/symptom/reviews'; // GET ?state=&tier=
export const URL_REVIEW_CASE = (id: string) => `/symptom/reviews/${encodeURIComponent(id)}`; // GET detail
export const URL_REVIEW_DECISION = (id: string) => `/symptom/reviews/${encodeURIComponent(id)}/decision`; // POST {decision, note}
export const URL_MAPPINGS = '/symptom/mappings'; // GET ?entity=term|cluster · POST {entity, action, payload}
export const URL_METRICS = '/symptom/metrics'; // GET — safety-KPI strip (PRD §9)

const USE_MOCK = (process.env.NEXT_PUBLIC_HEALTH_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, ADMIN_BASE_SUFFIX);
}
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json', ...(extra ?? {}) };
  if (typeof window === 'undefined') return base;
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}
function idempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Defensive GET: the backend is being built in parallel — a 404/503 (route not
// deployed yet) degrades to an empty list instead of a hard error.
async function getJsonOr<T>(path: string, emptyFallback: T): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { cache: 'no-store', headers: authHeaders() });
  if (res.status === 404 || res.status === 503) return emptyFallback;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json().catch(() => null);
  return ((j?.data ?? j) ?? emptyFallback) as T;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Idempotency-Key': idempotencyKey() }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json().catch(() => null);
  return (j?.data ?? j) as T;
}

// ── Types (match contracts/openapi.yaml components — PharmacyReviewCase et al.) ──

export type TriageTier = 'T1' | 'T2' | 'T3' | 'T4';
export type ReviewState = 'SUBMITTED' | 'AUTO_CLEARED' | 'PHARMACIST_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED';
export type ReviewDecision = 'APPROVE' | 'REJECT' | 'NEEDS_INFO';

export interface PharmacyReviewCase {
  id: string;
  order_id: string;
  tier: TriageTier;
  state: ReviewState;
  pharmacist_id: string | null;
  decision_note: string | null;
  sla_deadline: string; // ISO — PRD §9: median review <10 min, 08:00–22:00 WAT
  created_at: string;
  updated_at: string;
}

export interface ReviewCartLine {
  product_name: string;
  nafdac_reg_no: string | null;
  classification: 'OTC' | 'PHARMACY_ONLY' | 'POM';
  qty: number;
  unit_price_kobo: number;
  line_total_kobo: number;
}

export interface ReviewStateEvent {
  state: ReviewState;
  actor: string; // masked / 'system'
  note: string | null;
  at: string;
}

export interface PharmacyReviewCaseDetail extends PharmacyReviewCase {
  symptom_terms: string[]; // raw terms as typed/tapped (sensitive health data — NDPR)
  matched_concepts: string[]; // canonical concepts the terms resolved to
  cluster_name: string | null;
  cohort_flags: string[]; // e.g. PREGNANT_OR_BF, CHILD_UNDER_6, DURATION_GT_3D
  cart_lines: ReviewCartLine[];
  history: ReviewStateEvent[];
}

export type SymptomLanguage = 'en' | 'pcm' | 'ha' | 'yo' | 'ig';
export type MappingStatus = 'AI_SUGGESTED' | 'APPROVED' | 'RETIRED';

export interface SymptomTermMapping {
  id: string;
  term: string;
  language: SymptomLanguage;
  concept_id: string;
  concept_name: string; // proposed canonical concept (diff view for AI_SUGGESTED)
  status: MappingStatus;
  source: 'CURATED' | 'AI_SUGGESTED';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface ClusterRule {
  id: string;
  expression: string; // versioned combination logic, rendered read-only
  priority: number;
  effect: string; // e.g. "escalate → T3", "emergency → T4"
}

// NOTE: the cluster_class_map join table has no surrogate key and NO approval
// lifecycle of its own — the backend sets id = therapeutic_class_id and
// projects status/approved_* from the therapeutic CLASS row. Approving a row
// here therefore approves the CLASS entity (live in EVERY cluster mapping it);
// retiring removes just this cluster's mapping row.
export interface ClusterClassMap {
  id: string; // = therapeutic_class_id (see NOTE above)
  therapeutic_class_id: string;
  class_name: string;
  rank: number;
  status: MappingStatus;
  approved_by: string | null;
  approved_at: string | null;
}

export interface ConditionClusterMapping {
  id: string;
  name: string;
  triage_tier: TriageTier;
  rule_version: number;
  rules: ClusterRule[]; // read-only on this surface
  class_maps: ClusterClassMap[];
}

export interface MutationResult {
  ok: true;
  message: string;
}

// Safety-KPI strip (PRD §9 — dashboard-pinned, reviewed weekly with the
// superintendent pharmacist). Contract: GET {admin base}/symptom/metrics →
// {"data":{"by_state":{...},"by_tier":{...},"open_overdue":n,
//   "median_decision_seconds":number|null,"searches_24h":n,
//   "gated_share_7d":number|null}}
export interface SymptomSafetyMetrics {
  by_state: Partial<Record<ReviewState, number>>;
  by_tier: Partial<Record<TriageTier, number>>;
  open_overdue: number;
  median_decision_seconds: number | null; // null until enough decided cases
  searches_24h: number;
  gated_share_7d: number | null; // 0..1 share of searches landing T2+; null = no searches
}

// ── Display helper: kobo → ₦ (money is integer minor units, never floats) ────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const isoIn = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
const isoAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

// ── Fixtures (mock mode) ──────────────────────────────────────────────────────

const REVIEW_CASES: PharmacyReviewCase[] = [
  { id: 'prc_9001', order_id: 'ord_8814', tier: 'T2', state: 'PHARMACIST_REVIEW', pharmacist_id: null, decision_note: null, sla_deadline: isoAgo(14), created_at: isoAgo(38), updated_at: isoAgo(38) },
  { id: 'prc_9002', order_id: 'ord_8821', tier: 'T2', state: 'PHARMACIST_REVIEW', pharmacist_id: 'phm_112', decision_note: null, sla_deadline: isoIn(4), created_at: isoAgo(6), updated_at: isoAgo(5) },
  { id: 'prc_9003', order_id: 'ord_8822', tier: 'T2', state: 'SUBMITTED', pharmacist_id: null, decision_note: null, sla_deadline: isoIn(8), created_at: isoAgo(2), updated_at: isoAgo(2) },
  { id: 'prc_9004', order_id: 'ord_8825', tier: 'T2', state: 'NEEDS_INFO', pharmacist_id: 'phm_112', decision_note: 'Confirm current medications — possible NSAID duplication.', sla_deadline: isoIn(42), created_at: isoAgo(65), updated_at: isoAgo(20) },
  { id: 'prc_9005', order_id: 'ord_8809', tier: 'T1', state: 'AUTO_CLEARED', pharmacist_id: null, decision_note: null, sla_deadline: isoAgo(120), created_at: isoAgo(130), updated_at: isoAgo(128) },
  { id: 'prc_9006', order_id: 'ord_8801', tier: 'T2', state: 'APPROVED', pharmacist_id: 'phm_104', decision_note: 'Paracetamol group confirmed safe for pregnancy cohort.', sla_deadline: isoAgo(200), created_at: isoAgo(220), updated_at: isoAgo(205) },
  { id: 'prc_9007', order_id: 'ord_8799', tier: 'T3', state: 'REJECTED', pharmacist_id: 'phm_104', decision_note: 'POM territory — routed to telehealth consult; order refunded via ledger reversal.', sla_deadline: isoAgo(300), created_at: isoAgo(330), updated_at: isoAgo(295) },
  { id: 'prc_9008', order_id: 'ord_8830', tier: 'T2', state: 'PHARMACIST_REVIEW', pharmacist_id: null, decision_note: null, sla_deadline: isoIn(2), created_at: isoAgo(8), updated_at: isoAgo(8) },
];

const CASE_DETAILS: Record<string, Partial<PharmacyReviewCaseDetail>> = {
  prc_9001: {
    symptom_terms: ['headache', 'body dey pain me'],
    matched_concepts: ['cephalgia (non-specific)', 'myalgia'],
    cluster_name: 'Minor aches, non-specific',
    cohort_flags: ['PREGNANT_OR_BF'],
    cart_lines: [
      { product_name: 'Paracetamol 500mg (Emzor)', nafdac_reg_no: 'A4-0100', classification: 'OTC', qty: 2, unit_price_kobo: 350_00, line_total_kobo: 700_00 },
    ],
  },
  prc_9002: {
    symptom_terms: ['catarrh', 'cough'],
    matched_concepts: ['rhinorrhea', 'cough (productive)'],
    cluster_name: 'Upper respiratory, self-limiting',
    cohort_flags: ['ADULT', 'DURATION_2_3D'],
    cart_lines: [
      { product_name: 'Saline Nasal Spray (Sterimar)', nafdac_reg_no: 'A7-3321', classification: 'OTC', qty: 1, unit_price_kobo: 2_400_00, line_total_kobo: 2_400_00 },
      { product_name: 'Cough Syrup — codeine-free (Benylin)', nafdac_reg_no: 'A4-2210', classification: 'PHARMACY_ONLY', qty: 1, unit_price_kobo: 1_850_00, line_total_kobo: 1_850_00 },
    ],
  },
  prc_9004: {
    symptom_terms: ['body pain', 'joint pain'],
    matched_concepts: ['myalgia', 'arthralgia'],
    cluster_name: 'Musculoskeletal pain, minor',
    cohort_flags: ['ADULT', 'DURATION_GT_3D'],
    cart_lines: [
      { product_name: 'Ibuprofen 400mg (Advil)', nafdac_reg_no: 'A4-1180', classification: 'PHARMACY_ONLY', qty: 1, unit_price_kobo: 1_200_00, line_total_kobo: 1_200_00 },
    ],
  },
};

function detailFor(row: PharmacyReviewCase): PharmacyReviewCaseDetail {
  const extra = CASE_DETAILS[row.id] ?? {};
  return {
    ...row,
    symptom_terms: extra.symptom_terms ?? ['fever', 'headache'],
    matched_concepts: extra.matched_concepts ?? ['pyrexia', 'cephalgia (non-specific)'],
    cluster_name: extra.cluster_name ?? 'Pain & fever, minor',
    cohort_flags: extra.cohort_flags ?? ['ADULT', 'DURATION_TODAY'],
    cart_lines: extra.cart_lines ?? [
      { product_name: 'Paracetamol 500mg (Emzor)', nafdac_reg_no: 'A4-0100', classification: 'OTC', qty: 2, unit_price_kobo: 350_00, line_total_kobo: 700_00 },
    ],
    history: [
      { state: 'SUBMITTED', actor: 'system', note: 'Order submitted — symptom-search origin; tier computed by versioned cluster rules.', at: row.created_at },
      ...(row.state === 'AUTO_CLEARED'
        ? [{ state: 'AUTO_CLEARED' as ReviewState, actor: 'system', note: 'T1 self-care — auto-cleared per approved rule set.', at: row.updated_at }]
        : [{ state: 'PHARMACIST_REVIEW' as ReviewState, actor: 'system', note: 'Gated — routed to pharmacist queue (T2/POM).', at: row.created_at }]),
      ...(row.state === 'NEEDS_INFO' || row.state === 'APPROVED' || row.state === 'REJECTED'
        ? [{ state: row.state, actor: row.pharmacist_id ? `pharmacist ${row.pharmacist_id}` : 'pharmacist', note: row.decision_note, at: row.updated_at }]
        : []),
    ],
  };
}

const TERMS: SymptomTermMapping[] = [
  { id: 'trm_301', term: 'body dey pain me', language: 'pcm', concept_id: 'con_myalgia', concept_name: 'myalgia', status: 'APPROVED', source: 'CURATED', approved_by: 'Pharm. A. Okafor', approved_at: isoAgo(40_000), created_at: isoAgo(60_000) },
  { id: 'trm_302', term: 'catarrh', language: 'en', concept_id: 'con_rhinorrhea', concept_name: 'rhinorrhea', status: 'APPROVED', source: 'CURATED', approved_by: 'Pharm. A. Okafor', approved_at: isoAgo(40_000), created_at: isoAgo(60_000) },
  { id: 'trm_303', term: 'zazzabi', language: 'ha', concept_id: 'con_pyrexia', concept_name: 'pyrexia (fever)', status: 'AI_SUGGESTED', source: 'AI_SUGGESTED', approved_by: null, approved_at: null, created_at: isoAgo(300) },
  { id: 'trm_304', term: 'ori n fo mi', language: 'yo', concept_id: 'con_cephalgia', concept_name: 'cephalgia (headache)', status: 'AI_SUGGESTED', source: 'AI_SUGGESTED', approved_by: null, approved_at: null, created_at: isoAgo(280) },
  { id: 'trm_305', term: 'isi owuwa', language: 'ig', concept_id: 'con_cephalgia', concept_name: 'cephalgia (headache)', status: 'AI_SUGGESTED', source: 'AI_SUGGESTED', approved_by: null, approved_at: null, created_at: isoAgo(260) },
  { id: 'trm_306', term: 'belle dey turn me', language: 'pcm', concept_id: 'con_nausea', concept_name: 'nausea', status: 'AI_SUGGESTED', source: 'AI_SUGGESTED', approved_by: null, approved_at: null, created_at: isoAgo(150) },
  { id: 'trm_307', term: 'runny nose', language: 'en', concept_id: 'con_rhinorrhea', concept_name: 'rhinorrhea', status: 'APPROVED', source: 'AI_SUGGESTED', approved_by: 'Pharm. C. Bello', approved_at: isoAgo(10_000), created_at: isoAgo(12_000) },
  { id: 'trm_308', term: 'hedache', language: 'en', concept_id: 'con_cephalgia', concept_name: 'cephalgia (headache)', status: 'RETIRED', source: 'AI_SUGGESTED', approved_by: 'Pharm. C. Bello', approved_at: isoAgo(9_000), created_at: isoAgo(11_000) },
];

const CLUSTERS: ConditionClusterMapping[] = [
  {
    id: 'clu_401', name: 'Minor aches, non-specific', triage_tier: 'T1', rule_version: 3,
    rules: [
      { id: 'rul_1', expression: 'myalgia AND NOT (duration > 3d)', priority: 10, effect: 'resolve → T1 self-care' },
      { id: 'rul_2', expression: 'myalgia AND cohort = PREGNANT_OR_BF', priority: 5, effect: 'gate → T2 pharmacist-guided' },
    ],
    class_maps: [
      // id = therapeutic_class_id — mirrors the backend's ClusterClassMapView.
      { id: 'cls_para', therapeutic_class_id: 'cls_para', class_name: 'Analgesic — paracetamol', rank: 1, status: 'APPROVED', approved_by: 'Pharm. A. Okafor', approved_at: isoAgo(40_000) },
      { id: 'cls_nsaid', therapeutic_class_id: 'cls_nsaid', class_name: 'Analgesic — NSAID (ibuprofen)', rank: 2, status: 'APPROVED', approved_by: 'Pharm. A. Okafor', approved_at: isoAgo(40_000) },
    ],
  },
  {
    id: 'clu_402', name: 'Fever, undifferentiated', triage_tier: 'T2', rule_version: 5,
    rules: [
      { id: 'rul_3', expression: 'pyrexia AND duration > 3d', priority: 20, effect: 'escalate → T3 consult required' },
      { id: 'rul_4', expression: 'pyrexia AND cohort = CHILD_UNDER_6', priority: 20, effect: 'escalate → T3 consult required' },
      { id: 'rul_5', expression: 'pyrexia AND duration <= 3d AND cohort = ADULT', priority: 10, effect: 'resolve → T1 self-care' },
    ],
    class_maps: [
      // Same class as in clu_401 — name/status/stamps are projections of the ONE class row.
      { id: 'cls_para', therapeutic_class_id: 'cls_para', class_name: 'Analgesic — paracetamol', rank: 1, status: 'APPROVED', approved_by: 'Pharm. A. Okafor', approved_at: isoAgo(40_000) },
      { id: 'cls_orsalts', therapeutic_class_id: 'cls_orsalts', class_name: 'Oral rehydration salts', rank: 2, status: 'AI_SUGGESTED', approved_by: null, approved_at: null },
    ],
  },
  {
    id: 'clu_403', name: 'Sudden severe headache', triage_tier: 'T4', rule_version: 2,
    rules: [
      { id: 'rul_6', expression: 'cephalgia AND onset = sudden/severe', priority: 30, effect: 'emergency → T4 (no commerce UI)' },
    ],
    class_maps: [],
  },
];

// ── Safety-KPI metrics (PRD §9) ───────────────────────────────────────────────

const OPEN_STATES: ReviewState[] = ['SUBMITTED', 'PHARMACIST_REVIEW', 'NEEDS_INFO'];

// Mock: derived from the live REVIEW_CASES fixtures so the strip always agrees
// with the queue table underneath it (decisions in mock mode update both).
function mockMetrics(): SymptomSafetyMetrics {
  const by_state: Partial<Record<ReviewState, number>> = {};
  const by_tier: Partial<Record<TriageTier, number>> = {};
  let open_overdue = 0;
  const now = Date.now();
  for (const r of REVIEW_CASES) {
    by_state[r.state] = (by_state[r.state] ?? 0) + 1;
    by_tier[r.tier] = (by_tier[r.tier] ?? 0) + 1;
    if (OPEN_STATES.includes(r.state) && new Date(r.sla_deadline).getTime() < now) open_overdue++;
  }
  return {
    by_state,
    by_tier,
    open_overdue,
    median_decision_seconds: 412, // ~6.9 min — inside the <10 min PRD target
    searches_24h: 186,
    gated_share_7d: 0.23,
  };
}

// Defensive by design: the backend endpoint is being built in parallel. null ⇒
// "metrics unavailable" (404/503/network/shape mismatch) — the UI renders an
// em-dash skeleton instead of erroring, and the queue keeps working.
export async function getSafetyMetrics(): Promise<SymptomSafetyMetrics | null> {
  if (USE_MOCK) {
    await delay();
    return mockMetrics();
  }
  try {
    const m = await getJsonOr<SymptomSafetyMetrics | null>(URL_METRICS, null);
    if (!m || typeof m !== 'object' || typeof (m as SymptomSafetyMetrics).by_state !== 'object') return null;
    return m;
  } catch {
    return null;
  }
}

// ── Review queue ──────────────────────────────────────────────────────────────

export async function listReviewCases(opts?: { state?: ReviewState | ''; tier?: TriageTier | '' }): Promise<PharmacyReviewCase[]> {
  let rows: PharmacyReviewCase[];
  if (USE_MOCK) {
    await delay();
    rows = REVIEW_CASES.map((r) => ({ ...r }));
  } else {
    const qs = new URLSearchParams();
    if (opts?.state) qs.set('state', opts.state);
    if (opts?.tier) qs.set('tier', opts.tier);
    rows = await getJsonOr<PharmacyReviewCase[]>(`${URL_REVIEW_QUEUE}${qs.toString() ? `?${qs}` : ''}`, []);
    if (!Array.isArray(rows)) rows = [];
  }
  if (opts?.state) rows = rows.filter((r) => r.state === opts.state);
  if (opts?.tier) rows = rows.filter((r) => r.tier === opts.tier);
  // SLA-sorted: soonest deadline first (overdue floats to the top).
  return rows.sort((a, b) => new Date(a.sla_deadline).getTime() - new Date(b.sla_deadline).getTime());
}

export async function getReviewCase(id: string): Promise<PharmacyReviewCaseDetail> {
  if (USE_MOCK) {
    await delay();
    const row = REVIEW_CASES.find((r) => r.id === id) ?? REVIEW_CASES[0];
    return detailFor(row);
  }
  return getJsonOr<PharmacyReviewCaseDetail>(URL_REVIEW_CASE(id), null as unknown as PharmacyReviewCaseDetail);
}

// Guarded transition: PHARMACIST_REVIEW → APPROVED | REJECTED | NEEDS_INFO.
// note is REQUIRED for REJECT / NEEDS_INFO (fail-closed client-side too).
export async function decideReviewCase(id: string, decision: ReviewDecision, note: string): Promise<PharmacyReviewCase> {
  const trimmed = (note ?? '').trim();
  if ((decision === 'REJECT' || decision === 'NEEDS_INFO') && !trimmed) {
    throw new Error(`A note is required for ${decision.replace('_', ' ')}.`);
  }
  if (USE_MOCK) {
    await delay(320);
    const row = REVIEW_CASES.find((r) => r.id === id);
    if (!row) throw new Error('Case not found');
    if (row.state !== 'PHARMACIST_REVIEW' && row.state !== 'SUBMITTED' && row.state !== 'NEEDS_INFO') {
      throw new Error(`Illegal transition from ${row.state} (guarded state machine).`);
    }
    const next: ReviewState = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'NEEDS_INFO';
    row.state = next;
    row.decision_note = trimmed || row.decision_note;
    row.updated_at = new Date().toISOString();
    return { ...row };
  }
  return postJson<PharmacyReviewCase>(URL_REVIEW_DECISION(id), { decision, note: trimmed || undefined });
}

// ── Mapping workbench (suggest-approve) ───────────────────────────────────────

export async function listSymptomTerms(opts?: { status?: MappingStatus | ''; language?: SymptomLanguage | '' }): Promise<SymptomTermMapping[]> {
  let rows: SymptomTermMapping[];
  if (USE_MOCK) {
    await delay();
    rows = TERMS.map((t) => ({ ...t }));
  } else {
    const qs = new URLSearchParams({ entity: 'term' });
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.language) qs.set('language', opts.language);
    rows = await getJsonOr<SymptomTermMapping[]>(`${URL_MAPPINGS}?${qs}`, []);
    if (!Array.isArray(rows)) rows = [];
  }
  if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
  if (opts?.language) rows = rows.filter((r) => r.language === opts.language);
  // AI suggestions (needs review) first, then newest.
  return rows.sort((a, b) => {
    if ((a.status === 'AI_SUGGESTED') !== (b.status === 'AI_SUGGESTED')) return a.status === 'AI_SUGGESTED' ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export async function listClusters(): Promise<ConditionClusterMapping[]> {
  if (USE_MOCK) {
    await delay();
    return CLUSTERS.map((c) => ({ ...c, rules: [...c.rules], class_maps: c.class_maps.map((m) => ({ ...m })) }));
  }
  const rows = await getJsonOr<ConditionClusterMapping[]>(`${URL_MAPPINGS}?entity=cluster`, []);
  return Array.isArray(rows) ? rows : [];
}

// approve makes an AI_SUGGESTED mapping user-visible IMMEDIATELY; retire (never
// delete) removes it from the user surface. Both record approver + timestamp
// server-side and write to the immutable audit log.
export async function actOnTerm(id: string, action: 'approve' | 'retire'): Promise<MutationResult> {
  if (USE_MOCK) {
    await delay(320);
    const t = TERMS.find((x) => x.id === id);
    if (!t) throw new Error('Term not found');
    if (action === 'approve' && t.status === 'RETIRED') throw new Error('Illegal transition — cannot approve a retired term (409).');
    t.status = action === 'approve' ? 'APPROVED' : 'RETIRED';
    t.approved_by = 'you (pharmacist)';
    t.approved_at = new Date().toISOString();
    return { ok: true, message: action === 'approve' ? `Term "${t.term}" approved — now live in user-facing symptom search. Approver + timestamp recorded to immutable audit.` : `Term "${t.term}" retired — removed from user-facing resolution. Recorded to immutable audit.` };
  }
  await postJson(URL_MAPPINGS, { entity: 'term', action, payload: { id } });
  return { ok: true, message: `Term ${action}d.` };
}

// cluster_class_map has NO approval lifecycle (the backend 400s
// {entity: 'cluster_class_map', action: 'approve'}): status is projected from
// the therapeutic CLASS row, so approve sends the therapeutic_class entity —
// which makes the class live in EVERY cluster that maps to it. Retire stays on
// cluster_class_map: it removes this cluster's mapping row (the one taxonomy
// row that IS hard-deleted — the join carries no status column).
export async function actOnClassMap(clusterId: string, therapeuticClassId: string, action: 'approve' | 'retire'): Promise<MutationResult> {
  if (USE_MOCK) {
    await delay(320);
    const c = CLUSTERS.find((x) => x.id === clusterId);
    const m = c?.class_maps.find((x) => x.therapeutic_class_id === therapeuticClassId);
    if (!c || !m) throw new Error('Cluster→class mapping not found');
    if (action === 'retire') {
      c.class_maps = c.class_maps.filter((x) => x.therapeutic_class_id !== therapeuticClassId);
      return { ok: true, message: `"${m.class_name}" removed from this cluster — no longer in its results. The class itself is untouched. Recorded to immutable audit.` };
    }
    if (m.status === 'RETIRED') throw new Error('Illegal transition — cannot approve a retired class (409).');
    // Status is a projection of the ONE class row — approving updates every cluster mapping it.
    for (const cluster of CLUSTERS) {
      for (const map of cluster.class_maps) {
        if (map.therapeutic_class_id === therapeuticClassId) {
          map.status = 'APPROVED';
          map.approved_by = 'you (pharmacist)';
          map.approved_at = new Date().toISOString();
        }
      }
    }
    return { ok: true, message: `Therapeutic class "${m.class_name}" approved — live in every cluster that maps to it. Approver + timestamp recorded to immutable audit.` };
  }
  if (action === 'approve') {
    await postJson(URL_MAPPINGS, { entity: 'therapeutic_class', action: 'approve', payload: { id: therapeuticClassId } });
    return { ok: true, message: 'Therapeutic class approved — live in every cluster that maps to it.' };
  }
  await postJson(URL_MAPPINGS, { entity: 'cluster_class_map', action: 'retire', payload: { cluster_id: clusterId, class_id: therapeuticClassId } });
  return { ok: true, message: 'Mapping removed from this cluster.' };
}

// ── SLA helpers (PRD §9: median review <10 min) ───────────────────────────────

export function slaStatus(deadlineIso: string): { overdue: boolean; label: string } {
  const diffMs = new Date(deadlineIso).getTime() - Date.now();
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  const fmt = (m: number) => (m < 60 ? `${m}m` : m < 1_440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1_440)}d`);
  if (diffMs < 0) return { overdue: true, label: `overdue ${fmt(mins)}` };
  return { overdue: false, label: `due in ${fmt(mins)}` };
}
