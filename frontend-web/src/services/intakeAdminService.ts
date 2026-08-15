import { env } from '@/config/env';
import type {
  IntakeSchema,
  IntakeSchemaField,
  RedFlagRule,
  VocabEntry,
  VocabKind,
  ConsentVersion,
  IntakeConfig,
  MonitoringRow,
  IntakeRecord,
  AccessLogRow,
  RedFlagQueueRow,
  IntakeAnalytics,
} from '@/types/intakeAdmin';

// The Go health intake admin routes hang off the /api prefix (same convention
// as onboardingService / nutritionAdminService): env.apiBaseUrl ends with
// /api/v1 and admin routes live under /api/health/admin/intake/...
function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Mock by default; flip with NEXT_PUBLIC_INTAKE_ADMIN_USE_MOCK=false once the
// live Go admin endpoints (/api/health/admin/intake/*) are deployed. Matches the
// onboarding/nutrition/mobility admin-service convention.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_INTAKE_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/health/admin/intake';

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const schemaFixture: IntakeSchema = {
  version: 4,
  status: 'PUBLISHED',
  updated_at: '2026-06-22T09:30:00Z',
  updated_by: 'clinical.admin@paymax.ng',
  fields: [
    { key: 'reason_for_visit', label: 'Reason for visit', type: 'textarea', required: true, order: 1, help_text: 'Short chief complaint.' },
    { key: 'complaint_category', label: 'Complaint category', type: 'select', required: false, order: 2, options: ['General', 'Respiratory', 'Cardiac', 'Skin', 'Mental health', 'Other'] },
    { key: 'symptom_onset', label: 'Onset / duration', type: 'text', required: true, order: 3, conditional_on: 'reason_for_visit' },
    { key: 'symptom_severity', label: 'Severity (1–10)', type: 'slider', required: true, order: 4, conditional_on: 'reason_for_visit' },
    { key: 'current_medications', label: 'Current medications', type: 'multiselect', required: true, order: 5, help_text: 'May be "none". Pre-filled from last intake.' },
    { key: 'allergies', label: 'Allergies', type: 'multiselect', required: true, order: 6, help_text: 'Safety-critical (§5). May be "none".' },
    { key: 'chronic_conditions', label: 'Chronic conditions', type: 'multiselect', required: true, order: 7 },
    { key: 'pregnancy_status', label: 'Pregnancy / breastfeeding', type: 'select', required: false, order: 8, conditional_on: 'allergies', options: ['Not applicable', 'Pregnant', 'Breastfeeding', 'Both'] },
    { key: 'lifestyle', label: 'Lifestyle (smoking / alcohol)', type: 'text', required: false, order: 9 },
    { key: 'vitals', label: 'Self-reported vitals', type: 'text', required: false, order: 10, help_text: 'Temp, BP, weight/height, pulse if available.' },
    { key: 'attachments', label: 'Attachments', type: 'attachment', required: false, order: 11 },
  ],
};

const rulesFixture: RedFlagRule[] = [
  { code: 'CHEST_PAIN', label: 'Chest pain / pressure', match_json: '{"field":"reason_for_visit","contains":["chest pain","chest pressure"]}', level: 5, severity: 'emergency', routing: 'EMERGENCY', guidance_key: 'guidance.emergency.cardiac', active: true, version: 3 },
  { code: 'BREATHING_DIFFICULTY', label: 'Difficulty breathing', match_json: '{"field":"reason_for_visit","contains":["can\'t breathe","shortness of breath"]}', level: 5, severity: 'emergency', routing: 'EMERGENCY', guidance_key: 'guidance.emergency.respiratory', active: true, version: 2 },
  { code: 'STROKE_SIGNS', label: 'Stroke signs (FAST)', match_json: '{"field":"reason_for_visit","contains":["face droop","slurred speech","arm weakness"]}', level: 5, severity: 'emergency', routing: 'EMERGENCY', guidance_key: 'guidance.emergency.stroke', active: true, version: 1 },
  { code: 'SEVERE_BLEEDING', label: 'Severe bleeding', match_json: '{"field":"reason_for_visit","contains":["heavy bleeding","won\'t stop bleeding"]}', level: 4, severity: 'urgent', routing: 'URGENT_CARE', guidance_key: 'guidance.urgent.bleeding', active: true, version: 1 },
  { code: 'SELF_HARM', label: 'Self-harm / suicidal ideation', match_json: '{"field":"reason_for_visit","contains":["self harm","suicidal","end my life"]}', level: 5, severity: 'urgent', routing: 'CRISIS', guidance_key: 'guidance.crisis.support', active: true, version: 4 },
  { code: 'HIGH_FEVER_INFANT', label: 'High fever in infant', match_json: '{"field":"reason_for_visit","contains":["fever"],"age_under_months":3}', level: 4, severity: 'urgent', routing: 'URGENT_CARE', guidance_key: 'guidance.urgent.infant_fever', active: false, version: 1 },
];

const vocabFixture: VocabEntry[] = [
  { kind: 'condition', code: 'COND_DIABETES', label: 'Diabetes', active: true },
  { kind: 'condition', code: 'COND_HTN', label: 'Hypertension', active: true },
  { kind: 'condition', code: 'COND_ASTHMA', label: 'Asthma', active: true },
  { kind: 'condition', code: 'COND_SICKLE', label: 'Sickle cell disease', active: true },
  { kind: 'condition', code: 'COND_EPILEPSY', label: 'Epilepsy', active: false },
  { kind: 'allergen', code: 'ALG_PENICILLIN', label: 'Penicillin', active: true },
  { kind: 'allergen', code: 'ALG_SULFA', label: 'Sulfa drugs', active: true },
  { kind: 'allergen', code: 'ALG_PEANUT', label: 'Peanut', active: true },
  { kind: 'allergen', code: 'ALG_SHELLFISH', label: 'Shellfish', active: true },
  { kind: 'medication', code: 'MED_METFORMIN', label: 'Metformin', active: true },
  { kind: 'medication', code: 'MED_AMLODIPINE', label: 'Amlodipine', active: true },
  { kind: 'medication', code: 'MED_SALBUTAMOL', label: 'Salbutamol (inhaler)', active: true },
];

const consentFixture: ConsentVersion[] = [
  { consent_key: 'intake_share', version: 3, locale: 'en', body: 'Your health intake is shared with the doctor assigned to this appointment so they can provide your care. It is stored privately against your record and is never shared beyond your care relationship.', active: true },
  { consent_key: 'intake_share', version: 2, locale: 'en', body: 'Your intake details are shared with your assigned doctor to provide care.', active: false },
  { consent_key: 'intake_share', version: 1, locale: 'en', body: 'Your intake is shared with your doctor.', active: false },
];

const configFixtures: Record<string, IntakeConfig> = {
  reminder: {
    config_key: 'reminder',
    value: { offsets_hours: [24, 4, 1], channels: ['push', 'sms'], enabled: true },
  },
  summary_template: {
    config_key: 'summary_template',
    value: {
      section_order: ['chief_complaint', 'symptom_detail', 'allergies_meds', 'chronic_conditions', 'pregnancy', 'vitals', 'attachments'],
      highlight_sections: ['allergies_meds'],
    },
  },
  content_localization: {
    config_key: 'content_localization',
    value: {
      locale: 'en',
      questions: {
        reason_for_visit: 'What brings you in today?',
        allergies: 'Do you have any drug or food allergies?',
        current_medications: 'What medications are you currently taking?',
      },
      urgent_care_copy: 'Based on what you shared, it is best to be seen urgently. We can help you find the nearest urgent-care option now.',
      crisis_copy: 'You are not alone, and support is available right now. We can connect you with someone who can help. If you are in immediate danger, please contact local emergency services.',
      guidance: {
        'guidance.emergency.cardiac': 'These symptoms can be serious. Please seek emergency care right away.',
        'guidance.crisis.support': 'Reaching out is a strong first step. A trained counsellor is available to talk with you now.',
      },
    },
  },
};

const monitoringFixture: MonitoringRow[] = [
  { appointment_id: 'APT-90211', patient: 'A. Okeke', provider: 'Dr. Bello', intake_status: 'SUBMITTED', appointment_at: '2026-06-29T15:00:00Z', incomplete_near_appt: false },
  { appointment_id: 'APT-90212', patient: 'C. Adeyemi', provider: 'Dr. Ola', intake_status: 'DRAFT', appointment_at: '2026-06-29T13:30:00Z', incomplete_near_appt: true },
  { appointment_id: 'APT-90213', patient: 'M. Ibrahim', provider: 'Dr. Bello', intake_status: 'NOT_STARTED', appointment_at: '2026-06-29T14:15:00Z', incomplete_near_appt: true },
  { appointment_id: 'APT-90214', patient: 'T. Nwosu', provider: 'Dr. Eze', intake_status: 'SUBMITTED', appointment_at: '2026-06-30T09:00:00Z', incomplete_near_appt: false },
  { appointment_id: 'APT-90215', patient: 'F. Bassey', provider: 'Dr. Ola', intake_status: 'DRAFT', appointment_at: '2026-07-01T11:00:00Z', incomplete_near_appt: false },
];

function recordFixture(appointmentId: string): IntakeRecord {
  return {
    appointment_id: appointmentId,
    intake_id: `INT-${appointmentId.replace('APT-', '')}`,
    patient: 'A. Okeke',
    provider: 'Dr. Bello',
    intake_status: 'SUBMITTED',
    submitted_at: '2026-06-28T18:42:00Z',
    consent_version: 3,
    schema_version: 4,
    access_logged: true,
    sections: [
      { key: 'chief_complaint', label: 'Chief complaint', values: [{ label: 'Reason', value: 'Persistent cough for 5 days, mild fever (patient-reported).' }, { label: 'Category', value: 'Respiratory' }] },
      { key: 'symptom_detail', label: 'Symptom detail', values: [{ label: 'Onset', value: '5 days ago' }, { label: 'Severity', value: '4 / 10' }, { label: 'Better/worse', value: 'Worse at night' }] },
      { key: 'allergies_meds', label: 'Allergies & current medications', highlight: true, values: [{ label: 'Allergies', value: 'Penicillin (patient-reported)' }, { label: 'Medications', value: 'Salbutamol inhaler, as needed' }] },
      { key: 'chronic_conditions', label: 'Chronic conditions', values: [{ label: 'Conditions', value: 'Asthma' }] },
      { key: 'pregnancy', label: 'Pregnancy status', values: [{ label: 'Status', value: 'Not applicable' }] },
      { key: 'vitals', label: 'Self-reported vitals', values: [{ label: 'Temp', value: '37.8°C' }, { label: 'BP', value: 'not provided' }] },
      { key: 'attachments', label: 'Attachments', values: [{ label: 'Files', value: '1 photo' }] },
    ],
  };
}

const accessLogFixture: AccessLogRow[] = [
  { id: 'AL-5001', event_type: 'RECORD_VIEW', actor: 'support.agent@paymax.ng', appointment_id: 'APT-90211', intake_id: 'INT-90211', detail: 'Viewed intake record for support follow-up.', created_at: '2026-06-29T10:05:00Z' },
  { id: 'AL-5002', event_type: 'RED_FLAG_TRIGGERED', actor: 'system', appointment_id: 'APT-90220', intake_id: 'INT-90220', detail: 'Rule SELF_HARM triggered at submit; routed to CRISIS support.', created_at: '2026-06-29T09:48:00Z' },
  { id: 'AL-5003', event_type: 'CONSENT_ACCEPTED', actor: 'patient', appointment_id: 'APT-90214', intake_id: 'INT-90214', detail: 'Consent intake_share v3 accepted.', created_at: '2026-06-28T20:11:00Z' },
  { id: 'AL-5004', event_type: 'SCHEMA_PUBLISHED', actor: 'clinical.admin@paymax.ng', appointment_id: null, intake_id: null, detail: 'Intake schema published v4.', created_at: '2026-06-22T09:30:00Z' },
  { id: 'AL-5005', event_type: 'RULE_TOGGLED', actor: 'clinical.admin@paymax.ng', appointment_id: null, intake_id: null, detail: 'Rule HIGH_FEVER_INFANT set inactive.', created_at: '2026-06-21T14:02:00Z' },
];

const redFlagQueueFixture: RedFlagQueueRow[] = [
  { intake_id: 'INT-90220', appointment_id: 'APT-90220', severity: 'urgent', routing: 'CRISIS', rule_codes: ['SELF_HARM'], created_at: '2026-06-29T09:48:00Z', disposition: 'CONTACTED' },
  { intake_id: 'INT-90221', appointment_id: 'APT-90221', severity: 'emergency', routing: 'EMERGENCY', rule_codes: ['CHEST_PAIN'], created_at: '2026-06-29T08:30:00Z', disposition: 'ROUTED' },
  { intake_id: 'INT-90222', appointment_id: 'APT-90222', severity: 'urgent', routing: 'URGENT_CARE', rule_codes: ['SEVERE_BLEEDING'], created_at: '2026-06-28T22:10:00Z', disposition: 'RESOLVED' },
  { intake_id: 'INT-90223', appointment_id: 'APT-90223', severity: 'emergency', routing: 'EMERGENCY', rule_codes: ['BREATHING_DIFFICULTY'], created_at: '2026-06-29T11:02:00Z', disposition: 'OPEN' },
];

const analyticsFixture: IntakeAnalytics = {
  completion_rate: 0.78,
  per_step_dropoff: [
    { step: 'Reason for visit', reached: 1000, completed: 970 },
    { step: 'Symptom detail', reached: 970, completed: 905 },
    { step: 'Medications', reached: 905, completed: 870 },
    { step: 'Allergies', reached: 870, completed: 845 },
    { step: 'Chronic conditions', reached: 845, completed: 820 },
    { step: 'Vitals (optional)', reached: 820, completed: 800 },
    { step: 'Review & submit', reached: 800, completed: 780 },
  ],
  avg_time_to_complete_sec: 312,
  top_complaints: [
    { label: 'Cough / cold', count: 184 },
    { label: 'Fever', count: 142 },
    { label: 'Headache', count: 118 },
    { label: 'Abdominal pain', count: 97 },
    { label: 'Skin rash', count: 76 },
  ],
  top_conditions: [
    { label: 'Hypertension', count: 96 },
    { label: 'Asthma', count: 71 },
    { label: 'Diabetes', count: 64 },
    { label: 'Sickle cell', count: 22 },
  ],
  red_flag_trigger_rate: 0.031,
};

// ─── Read endpoints ──────────────────────────────────────────────────────────

async function getJson<T>(path: string, fallback: T): Promise<T> {
  if (USE_FIXTURES) return delay(fallback);
  const res = await fetch(`${adminApiBase()}${BASE}${path}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const data = await res.json().catch(() => null);
  return (data ?? fallback) as T;
}

export function getSchema(): Promise<IntakeSchema> {
  return getJson('/schema', schemaFixture);
}

export function listRules(): Promise<RedFlagRule[]> {
  return getJson('/rules', rulesFixture);
}

export function listVocab(): Promise<VocabEntry[]> {
  return getJson('/vocab', vocabFixture);
}

export function listConsentVersions(): Promise<ConsentVersion[]> {
  return getJson('/consent-versions', consentFixture);
}

export function getConfig(key: string): Promise<IntakeConfig> {
  return getJson(`/config/${encodeURIComponent(key)}`, configFixtures[key] ?? { config_key: key, value: {} });
}

export function listMonitoring(): Promise<MonitoringRow[]> {
  return getJson('/monitoring', monitoringFixture);
}

export function getRecord(appointmentId: string): Promise<IntakeRecord> {
  return getJson(`/records/${encodeURIComponent(appointmentId)}`, recordFixture(appointmentId));
}

export function listAccessLog(): Promise<AccessLogRow[]> {
  return getJson('/access-log', accessLogFixture);
}

export function listRedFlagQueue(): Promise<RedFlagQueueRow[]> {
  return getJson('/red-flag-queue', redFlagQueueFixture);
}

export function getAnalytics(): Promise<IntakeAnalytics> {
  return getJson('/analytics', analyticsFixture);
}

// ─── Write funnel ────────────────────────────────────────────────────────────
// All mutating actions route through one funnel (mirrors onboardingService
// postAction): fixtures echo the payload after a small latency; live mode POSTs
// to the matching admin endpoint. Server RBAC (health.admin.intake) is
// authoritative; the UI gates are convenience only.

type IntakeAction =
  | { kind: 'publish-schema'; body: { fields: IntakeSchemaField[] } }
  | { kind: 'upsert-rule'; body: RedFlagRule }
  | { kind: 'toggle-rule'; code: string }
  | { kind: 'add-vocab'; body: VocabEntry }
  | { kind: 'add-consent'; body: ConsentVersion }
  | { kind: 'save-config'; key: string; body: Record<string, unknown> };

async function postAction(action: IntakeAction): Promise<{ ok: true }> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  }
  let path = '';
  let payload: unknown = {};
  switch (action.kind) {
    case 'publish-schema':
      path = '/schema';
      payload = action.body;
      break;
    case 'upsert-rule':
      path = '/rules';
      payload = action.body;
      break;
    case 'toggle-rule':
      path = `/rules/${encodeURIComponent(action.code)}/toggle`;
      break;
    case 'add-vocab':
      path = '/vocab';
      payload = action.body;
      break;
    case 'add-consent':
      path = '/consent-versions';
      payload = action.body;
      break;
    case 'save-config':
      path = `/config/${encodeURIComponent(action.key)}`;
      payload = action.body;
      break;
  }
  const res = await fetch(`${adminApiBase()}${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return { ok: true };
}

export function publishSchema(fields: IntakeSchemaField[]): Promise<{ ok: true }> {
  return postAction({ kind: 'publish-schema', body: { fields } });
}

export function upsertRule(rule: RedFlagRule): Promise<{ ok: true }> {
  return postAction({ kind: 'upsert-rule', body: rule });
}

export function toggleRule(code: string): Promise<{ ok: true }> {
  return postAction({ kind: 'toggle-rule', code });
}

export function addVocab(entry: VocabEntry): Promise<{ ok: true }> {
  return postAction({ kind: 'add-vocab', body: entry });
}

export function addConsentVersion(entry: ConsentVersion): Promise<{ ok: true }> {
  return postAction({ kind: 'add-consent', body: entry });
}

export function saveConfig(key: string, value: Record<string, unknown>): Promise<{ ok: true }> {
  return postAction({ kind: 'save-config', key, body: value });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function ageFromNow(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function toLocal(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}
