// ── Admin — Paymax Health · AI Symptom Checker (Triage) clinical console ────────
// Mock by default (mirrors healthVetAdminService / healthVetVerificationService).
// Flip with NEXT_PUBLIC_HEALTH_USE_MOCK=false to hit the live Go backend at
// /api/health/triage/admin/*. RBAC: review surfaces gate on health.triage.review,
// governance surfaces on health.triage.admin (wired on the sidebar + pages).
//
// Request building / auth / errors mirror the existing health admin services:
//  • adminBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/health/triage/admin
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson unwrap { data } and throw on non-2xx
//
// SAFETY (PRD §11): triage + navigation only — NEVER a diagnosis (SC-1). The
// deterministic red-flag layer can only RAISE urgency (SC-2). Content + rules need
// licensed-clinician sign-off before publish (SC-6). Optimise EMERGENCY
// SENSITIVITY first (SC-3). Every state change writes an immutable audit (SC-12).

import { env } from '@/config/env';
import type {
  TriageSession,
  TriageSessionStats,
  EscalationCase,
  EscalationActionResult,
  ClinicalContentItem,
  ClinicalContentInput,
  GovernanceAction,
  GovernanceResult,
  RedFlagRule,
  RedFlagRuleInput,
  ValidationRun,
  Vignette,
  LanguagePack,
  GovernanceState,
} from '@/types/healthTriageAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_HEALTH_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/health/triage/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real, RBAC-gated live endpoint (verified against
// backend/internal/health/triage/{care,governance}/handler.go) so fixture mode
// has nothing to add and refuses loudly instead of reporting a write it did
// not perform. Two of them (acknowledgeEscalation, resolveEscalation) used to
// go further and fabricate compliance language — "Written to immutable audit
// (SC-12)" — about an audit entry that was never written; that class of claim
// is exactly what docs/audit/ADMIN_SIMULATED_WRITES.md calls "the most
// dangerous strings in this codebase," and it wasn't caught by
// scripts/ci/check-simulated-writes.py's claim-pattern check because the
// wording ("Written to" vs. the pattern's "Recorded to") didn't match.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_HEALTH_USE_MOCK=false to make this change against the live backend.';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// Disposition-level display labels (NEVER use "diagnosis" — SC-1).
export const DISPOSITION_LABELS: Record<string, string> = {
  emergency_ambulance: 'Emergency · ambulance',
  emergency_urgent: 'Emergency · urgent',
  consult_24h: 'Consult · within 24h',
  consult_routine: 'Consult · routine',
  self_care: 'Self-care',
};
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', pcm: 'Pidgin', hau: 'Hausa', yor: 'Yoruba', ibo: 'Igbo',
};
export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ════════════════════════════════════════════════════════════════════════════
// A · Triage sessions monitor + disposition stats
// ════════════════════════════════════════════════════════════════════════════
const SESSIONS: TriageSession[] = [
  { id: 'tsx_9001', state: 'escalated', disposition_level: 'emergency_ambulance', channel: 'whatsapp', language: 'pcm', red_flag: true, profile_kind: 'self', consent_on_file: true, age_band: '30-39', top_condition_count: 3, created_at: iso(0.3) },
  { id: 'tsx_9002', state: 'disposition_given', disposition_level: 'consult_24h', channel: 'app', language: 'en', red_flag: false, profile_kind: 'self', consent_on_file: true, age_band: '20-29', top_condition_count: 3, created_at: iso(0.6) },
  { id: 'tsx_9003', state: 'referred', disposition_level: 'self_care', channel: 'app', language: 'en', red_flag: false, profile_kind: 'self', consent_on_file: true, age_band: '40-49', top_condition_count: 2, created_at: iso(1.1) },
  { id: 'tsx_9004', state: 'escalated', disposition_level: 'emergency_urgent', channel: 'ussd', language: 'hau', red_flag: true, profile_kind: 'child', consent_on_file: true, age_band: '0-4', top_condition_count: 2, created_at: iso(1.8) },
  { id: 'tsx_9005', state: 'disposition_given', disposition_level: 'consult_routine', channel: 'whatsapp', language: 'pcm', red_flag: false, profile_kind: 'self', consent_on_file: true, age_band: '50-59', top_condition_count: 3, created_at: iso(2.4) },
  { id: 'tsx_9006', state: 'abandoned', disposition_level: null, channel: 'sms', language: 'yor', red_flag: false, profile_kind: 'self', consent_on_file: false, age_band: '20-29', top_condition_count: 0, created_at: iso(3.0) },
  { id: 'tsx_9007', state: 'referred', disposition_level: 'consult_24h', channel: 'app', language: 'en', red_flag: false, profile_kind: 'dependant', consent_on_file: true, age_band: '60+', top_condition_count: 3, created_at: iso(3.7) },
  { id: 'tsx_9008', state: 'escalated', disposition_level: 'emergency_ambulance', channel: 'app', language: 'en', red_flag: true, profile_kind: 'self', consent_on_file: true, age_band: '40-49', top_condition_count: 1, created_at: iso(4.5) },
  { id: 'tsx_9009', state: 'disposition_given', disposition_level: 'self_care', channel: 'whatsapp', language: 'pcm', red_flag: false, profile_kind: 'self', consent_on_file: true, age_band: '10-19', top_condition_count: 2, created_at: iso(5.2) },
  { id: 'tsx_9010', state: 'interviewing', disposition_level: null, channel: 'app', language: 'en', red_flag: false, profile_kind: 'self', consent_on_file: true, age_band: '30-39', top_condition_count: 0, created_at: iso(0.1) },
  { id: 'tsx_9011', state: 'referred', disposition_level: 'consult_routine', channel: 'agent', language: 'ibo', red_flag: false, profile_kind: 'self', consent_on_file: true, age_band: '30-39', top_condition_count: 3, created_at: iso(6.4) },
  { id: 'tsx_9012', state: 'disposition_given', disposition_level: 'consult_24h', channel: 'ussd', language: 'hau', red_flag: false, profile_kind: 'child', consent_on_file: true, age_band: '5-9', top_condition_count: 2, created_at: iso(7.1) },
];

const STATS: TriageSessionStats = {
  generated_at: iso(0.05),
  total_sessions: 18_420,
  sessions_today: 642,
  red_flag_rate: 0.071, // SC-2 — share where a deterministic red-flag rule fired
  emergency_share: 0.092, // share routed to an emergency level (conservative, SC-3)
  completion_rate: 0.883, // reached DISPOSITION_GIVEN (not abandoned)
  open_escalations: 3, // RAISED/NOTIFIED/ACKNOWLEDGED (human-in-loop, SC-5)
  by_level: [
    { level: 'emergency_ambulance', count: 540, share_pct: 0.029 },
    { level: 'emergency_urgent', count: 1_160, share_pct: 0.063 },
    { level: 'consult_24h', count: 4_980, share_pct: 0.270 },
    { level: 'consult_routine', count: 5_460, share_pct: 0.296 },
    { level: 'self_care', count: 6_280, share_pct: 0.341 },
  ],
  by_channel: [
    { channel: 'app', count: 7_920, share_pct: 0.430 },
    { channel: 'whatsapp', count: 6_080, share_pct: 0.330 },
    { channel: 'ussd', count: 2_390, share_pct: 0.130 },
    { channel: 'sms', count: 1_290, share_pct: 0.070 },
    { channel: 'agent', count: 740, share_pct: 0.040 },
  ],
};

export async function getTriageStats(): Promise<TriageSessionStats> {
  if (USE_MOCK) { await delay(); return { ...STATS, by_level: [...STATS.by_level], by_channel: [...STATS.by_channel] }; }
  return getJson<TriageSessionStats>('/sessions/stats');
}

export async function listSessions(opts?: { state?: string; level?: string; channel?: string; red_flag?: string; q?: string }): Promise<TriageSession[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...SESSIONS];
    if (opts?.state) rows = rows.filter((r) => r.state === opts.state);
    if (opts?.level) rows = rows.filter((r) => r.disposition_level === opts.level);
    if (opts?.channel) rows = rows.filter((r) => r.channel === opts.channel);
    if (opts?.red_flag === 'yes') rows = rows.filter((r) => r.red_flag);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.id.includes(q) || r.language.includes(q) || r.channel.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.level) qs.set('level', opts.level);
  if (opts?.channel) qs.set('channel', opts.channel);
  if (opts?.red_flag) qs.set('red_flag', opts.red_flag);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<TriageSession[]>(`/sessions${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// B · Escalation queue (EscalationCase; human-in-loop, SC-5)
//  RAISED → NOTIFIED → ACKNOWLEDGED → RESOLVED
// ════════════════════════════════════════════════════════════════════════════
const ESCALATIONS: EscalationCase[] = [
  { id: 'esc_4401', session_id: 'tsx_9001', state: 'raised', disposition_level: 'emergency_ambulance', red_flag_rule_id: 'rfr_2201', red_flag_summary: 'Chest pain with sweating + breathlessness — deterministic red-flag fired; routed to nearest ER + ambulance (SC-2).', channel: 'whatsapp', language: 'pcm', profile_kind: 'self', patient_masked: 'pt •••821', acknowledged_by: null, handoff_note: null, raised_at: iso(0.3), notified_at: null, acknowledged_at: null, resolved_at: null },
  { id: 'esc_4402', session_id: 'tsx_9004', state: 'notified', disposition_level: 'emergency_urgent', red_flag_rule_id: 'rfr_2204', red_flag_summary: 'Infant <3mo with high fever — paediatric red-flag fired; caregiver + clinician notified (SC-9).', channel: 'ussd', language: 'hau', profile_kind: 'child', patient_masked: 'pt •••144', acknowledged_by: null, handoff_note: null, raised_at: iso(1.8), notified_at: iso(1.7), acknowledged_at: null, resolved_at: null },
  { id: 'esc_4403', session_id: 'tsx_9008', state: 'acknowledged', disposition_level: 'emergency_ambulance', red_flag_rule_id: 'rfr_2201', red_flag_summary: 'Sudden one-sided weakness + slurred speech (stroke pattern) — red-flag fired; ER routing.', channel: 'app', language: 'en', profile_kind: 'self', patient_masked: 'pt •••507', acknowledged_by: 'dr_clin_2', handoff_note: 'Patient contacted; ambulance dispatched via emergency directory. Awaiting facility confirmation.', raised_at: iso(4.5), notified_at: iso(4.4), acknowledged_at: iso(4.2), resolved_at: null },
  { id: 'esc_4404', session_id: 'tsx_8990', state: 'resolved', disposition_level: 'emergency_urgent', red_flag_rule_id: 'rfr_2203', red_flag_summary: 'Severe dehydration signs in adult — urgent facility referral.', channel: 'whatsapp', language: 'pcm', profile_kind: 'self', patient_masked: 'pt •••330', acknowledged_by: 'dr_clin_1', handoff_note: 'Patient reached urgent-care facility; confirmed seen. Case closed.', raised_at: iso(26), notified_at: iso(25.9), acknowledged_at: iso(25.5), resolved_at: iso(22) },
];

export async function listEscalations(opts?: { state?: string; q?: string }): Promise<EscalationCase[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...ESCALATIONS];
    if (opts?.state) rows = rows.filter((r) => r.state === opts.state);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.id.includes(q) || r.session_id.includes(q) || r.red_flag_summary.toLowerCase().includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EscalationCase[]>(`/escalations${qs.toString() ? `?${qs}` : ''}`);
}

export async function acknowledgeEscalation(id: string, handoffNote?: string): Promise<EscalationActionResult> {
  if (USE_MOCK) throw new Error(`Acknowledging an escalation ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<EscalationActionResult>('POST', `/escalations/${id}/ack`, { handoff_note: handoffNote });
}

export async function resolveEscalation(id: string, handoffNote?: string): Promise<EscalationActionResult> {
  if (USE_MOCK) throw new Error(`Resolving an escalation ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<EscalationActionResult>('POST', `/escalations/${id}/resolve`, { handoff_note: handoffNote });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Clinical content governance (DRAFT→CLINICAL_REVIEW→APPROVED→PUBLISHED→DEPRECATED)
//  Publish requires a licensed-clinician sign-off (reviewer) — SC-6.
// ════════════════════════════════════════════════════════════════════════════
const CONTENT: ClinicalContentItem[] = [
  { id: 'cnt_7001', title: 'Malaria — possible causes & guidance (EN)', kind: 'condition_library', language: 'en', state: 'published', version: 3, body_preview: 'Malaria is common in this region. This is guidance, not a diagnosis (SC-1). If you have fever with chills, a test can confirm…', reviewer_id: 'dr_clin_1', signed_off_at: iso(120), author_id: 'editor_a', updated_at: iso(118) },
  { id: 'cnt_7002', title: 'Malaria — possible causes & guidance (Pidgin)', kind: 'condition_library', language: 'pcm', state: 'clinical_review', version: 1, body_preview: 'Malaria dey common for here. Dis na guidance, no be diagnosis. If you get fever wey dey shake your body…', reviewer_id: null, signed_off_at: null, author_id: 'editor_b', updated_at: iso(20) },
  { id: 'cnt_7003', title: '"Not a diagnosis" disclaimer (EN)', kind: 'disclaimer', language: 'en', state: 'published', version: 5, body_preview: 'This tool gives possible causes and guidance only — it is not a diagnosis and not a substitute for a clinician (SC-1/SC-8).', reviewer_id: 'dr_clin_2', signed_off_at: iso(400), author_id: 'editor_a', updated_at: iso(398) },
  { id: 'cnt_7004', title: 'Typhoid self-care guidance (Pidgin)', kind: 'care_guidance', language: 'pcm', state: 'approved', version: 2, body_preview: 'Make you drink plenty clean water, rest well. If di sickness no better for 48 hours, go see clinician…', reviewer_id: 'dr_clin_1', signed_off_at: iso(40), author_id: 'editor_b', updated_at: iso(38) },
  { id: 'cnt_7005', title: 'USSD emergency notice (EN)', kind: 'channel_notice', language: 'en', state: 'draft', version: 1, body_preview: 'If this is an emergency, hang up and call your local emergency line now. This service is guidance only.', reviewer_id: null, signed_off_at: null, author_id: 'editor_c', updated_at: iso(4) },
  { id: 'cnt_7006', title: 'Sickle-cell crisis guidance (EN) — v1', kind: 'condition_library', language: 'en', state: 'deprecated', version: 1, body_preview: 'Superseded by v2 with updated red-flag cross-references. Retained for audit.', reviewer_id: 'dr_clin_2', signed_off_at: iso(900), author_id: 'editor_a', updated_at: iso(300) },
];

export async function listContent(opts?: { state?: string; kind?: string; language?: string; q?: string }): Promise<ClinicalContentItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CONTENT];
    if (opts?.state) rows = rows.filter((r) => r.state === opts.state);
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.language) rows = rows.filter((r) => r.language === opts.language);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.language) qs.set('language', opts.language);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ClinicalContentItem[]>(`/content${qs.toString() ? `?${qs}` : ''}`);
}

export async function createContent(input: ClinicalContentInput): Promise<ClinicalContentItem> {
  if (USE_MOCK) throw new Error(`Creating clinical content ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<ClinicalContentItem>('POST', '/content', input);
}

// Lifecycle transition for a content item. PUBLISH is fail-closed without a
// clinician sign-off (SC-6): the mock blocks publish unless the item is APPROVED
// (i.e. a reviewer has signed off in CLINICAL_REVIEW → APPROVED).
export async function governContent(id: string, action: GovernanceAction): Promise<GovernanceResult> {
  if (USE_MOCK) throw new Error(`Governing clinical content ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<GovernanceResult>('POST', `/content/${id}/${action}`, {});
}

// ════════════════════════════════════════════════════════════════════════════
// D · Red-flag rule governance (same lifecycle; rules can only RAISE urgency, SC-2)
// ════════════════════════════════════════════════════════════════════════════
const RULES: RedFlagRule[] = [
  { id: 'rfr_2201', name: 'Cardiac/stroke red-flag', state: 'published', version: 4, escalate_to: 'emergency_ambulance', condition: { any_of: ['chest_pain_radiating', 'face_arm_speech_deficit'], with: ['acute_onset'] }, rationale: 'Time-critical emergencies — must always route to ambulance regardless of engine probability (SC-2/SC-3).', reviewer_id: 'dr_clin_1', signed_off_at: iso(500), author_id: 'editor_a', updated_at: iso(498) },
  { id: 'rfr_2203', name: 'Severe dehydration (adult)', state: 'published', version: 2, escalate_to: 'emergency_urgent', condition: { all_of: ['no_urine_8h', 'dizzy_on_standing'], age_band_min: 18 }, rationale: 'Raises urgency to urgent facility referral; never lowers a higher engine level (SC-2).', reviewer_id: 'dr_clin_2', signed_off_at: iso(300), author_id: 'editor_a', updated_at: iso(298) },
  { id: 'rfr_2204', name: 'Febrile infant <3 months', state: 'approved', version: 1, escalate_to: 'emergency_urgent', condition: { all_of: ['fever_ge_38'], age_months_max: 3 }, rationale: 'Paediatric caution (SC-9): young infants with fever need urgent in-person assessment.', reviewer_id: 'dr_clin_1', signed_off_at: iso(30), author_id: 'editor_b', updated_at: iso(28) },
  { id: 'rfr_2205', name: 'Pregnancy bleeding red-flag', state: 'clinical_review', version: 1, escalate_to: 'emergency_urgent', condition: { all_of: ['vaginal_bleeding', 'pregnant'] }, rationale: 'Maternal caution (SC-9): vaginal bleeding in pregnancy escalates urgency.', reviewer_id: null, signed_off_at: null, author_id: 'editor_c', updated_at: iso(10) },
  { id: 'rfr_2206', name: 'Sickle-cell pain crisis', state: 'draft', version: 1, escalate_to: 'consult_24h', condition: { all_of: ['known_sickle_cell', 'severe_pain'] }, rationale: 'Local epidemiology: raises to a same-day consult; clinician review pending.', reviewer_id: null, signed_off_at: null, author_id: 'editor_b', updated_at: iso(3) },
];

export async function listRedFlagRules(opts?: { state?: string; q?: string }): Promise<RedFlagRule[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...RULES];
    if (opts?.state) rows = rows.filter((r) => r.state === opts.state);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q) || r.rationale.toLowerCase().includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.q) qs.set('q', opts.q);
  // backend: GET /rules (governance.Handler.ListRules) — the OLD /red-flag-rules
  // path here matched no route; fixed to the real one.
  return getJson<RedFlagRule[]>(`/rules${qs.toString() ? `?${qs}` : ''}`);
}

export async function createRedFlagRule(input: RedFlagRuleInput): Promise<RedFlagRule> {
  if (USE_MOCK) throw new Error(`Creating a red-flag rule ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<RedFlagRule>('POST', '/rules', input);
}

export async function governRedFlagRule(id: string, action: GovernanceAction): Promise<GovernanceResult> {
  if (USE_MOCK) throw new Error(`Governing a red-flag rule ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /rules/:id/:action (governance.Handler.RuleLifecycle) — the OLD
  // /red-flag-rules/:id/:action path here matched no route; fixed to the real one.
  return sendJson<GovernanceResult>('POST', `/rules/${id}/${action}`, {});
}

// ════════════════════════════════════════════════════════════════════════════
// E · Validation / accuracy harness (emergency-sensitivity-first; SC-3)
// ════════════════════════════════════════════════════════════════════════════
const VIGNETTES: Vignette[] = [
  { id: 'vig_001', title: 'Adult — chest pain radiating to arm', language: 'en', expected_level: 'emergency_ambulance', is_emergency: true, category: 'cardiac', last_eval_level: 'emergency_ambulance' },
  { id: 'vig_002', title: 'Pikin wey get fever + dey shake (infant)', language: 'pcm', expected_level: 'emergency_urgent', is_emergency: true, category: 'paediatric-febrile', last_eval_level: 'emergency_urgent' },
  { id: 'vig_003', title: 'Adult — fever + chills, malaria-endemic area', language: 'en', expected_level: 'consult_24h', is_emergency: false, category: 'malaria', last_eval_level: 'consult_24h' },
  { id: 'vig_004', title: 'Malaria-pattern fever (Pidgin narration)', language: 'pcm', expected_level: 'consult_24h', is_emergency: false, category: 'malaria', last_eval_level: 'consult_routine' },
  { id: 'vig_005', title: 'Mild sore throat, no red flags', language: 'en', expected_level: 'self_care', is_emergency: false, category: 'uri', last_eval_level: 'self_care' },
  { id: 'vig_006', title: 'Pregnant — vaginal bleeding', language: 'en', expected_level: 'emergency_urgent', is_emergency: true, category: 'maternal', last_eval_level: 'emergency_urgent' },
  { id: 'vig_007', title: 'Known sickle-cell, severe pain crisis', language: 'en', expected_level: 'consult_24h', is_emergency: false, category: 'sickle-cell', last_eval_level: 'consult_24h' },
  { id: 'vig_008', title: 'Belle pain wey serious + no fit pass urine (Pidgin)', language: 'pcm', expected_level: 'emergency_urgent', is_emergency: true, category: 'abdominal', last_eval_level: 'emergency_urgent' },
];

const VALIDATION: ValidationRun = {
  run_id: 'val_20260628_01',
  ran_at: iso(0.4),
  vignette_count: 240,
  emergency_sensitivity: 0.991, // headline — ~0 missed emergencies (SC-3)
  over_triage: 0.184, // controlled over-referral (acceptable, safety-first)
  under_triage: 0.009, // release blocker if not ~0 — currently near-zero
  level_accuracy: 0.742, // exact 5-level agreement with clinician panel
  by_language: {
    en: { emergency_sensitivity: 0.994, level_accuracy: 0.761, over_triage: 0.176, under_triage: 0.006 },
    pcm: { emergency_sensitivity: 0.988, level_accuracy: 0.723, over_triage: 0.192, under_triage: 0.012 },
  },
  shadow_mode: true, // shadow-eval vs clinicians before any real patient
  notes: 'Shadow-mode run against the African clinical-vignette panel. Emergency sensitivity is the gate; cross-language parity (en vs pcm) within tolerance. Level accuracy is secondary to never missing an emergency.',
};

export async function runValidation(): Promise<ValidationRun> {
  if (USE_MOCK) throw new Error(`Running the validation harness ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<ValidationRun>('POST', '/validation/run', {});
}

export async function listVignettes(): Promise<Vignette[]> {
  if (USE_MOCK) { await delay(); return VIGNETTES.map((v) => ({ ...v })); }
  return getJson<Vignette[]>('/vignettes');
}

// ════════════════════════════════════════════════════════════════════════════
// F · Language packs (voice-first / parity; PRD §3 / SC-3)
// ════════════════════════════════════════════════════════════════════════════
const LANGUAGE_PACKS: LanguagePack[] = [
  { code: 'en', label: 'English', voice_supported: true, coverage_pct: 1.0, content_published: 42, content_pending: 0, parity_ok: true },
  { code: 'pcm', label: 'Pidgin', voice_supported: true, coverage_pct: 0.86, content_published: 31, content_pending: 5, parity_ok: true },
  { code: 'hau', label: 'Hausa', voice_supported: true, coverage_pct: 0.41, content_published: 12, content_pending: 9, parity_ok: false },
  { code: 'yor', label: 'Yoruba', voice_supported: false, coverage_pct: 0.33, content_published: 9, content_pending: 7, parity_ok: false },
  { code: 'ibo', label: 'Igbo', voice_supported: false, coverage_pct: 0.28, content_published: 7, content_pending: 6, parity_ok: false },
];

export async function listLanguagePacks(): Promise<LanguagePack[]> {
  if (USE_MOCK) { await delay(); return LANGUAGE_PACKS.map((p) => ({ ...p })); }
  return getJson<LanguagePack[]>('/language-packs');
}
