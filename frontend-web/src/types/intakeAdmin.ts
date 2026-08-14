// Types for the admin "Pre-Consultation Intake" console (screens A1–A13).
// Backed by the Go health admin route group (/health/admin/intake/*),
// RBAC permission `health.admin.intake`. See
// docs/prd/health/Paymax-Telemedicine-PreConsult-Intake.md §8.

// ─── A1 · Intake Form Builder ────────────────────────────────────────────────

export type IntakeFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'number'
  | 'slider'
  | 'boolean'
  | 'date'
  | 'attachment';

export interface IntakeSchemaField {
  key: string;
  label: string;
  type: IntakeFieldType;
  required: boolean;
  order: number;
  // Optional conditional gate: render only when another field has a value.
  conditional_on?: string | null;
  help_text?: string;
  options?: string[];
}

export interface IntakeSchema {
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
  updated_at: string;
  updated_by?: string;
  fields: IntakeSchemaField[];
}

// ─── A2 · Red-flag Rules ─────────────────────────────────────────────────────

export type RedFlagSeverity = 'emergency' | 'urgent';
export type RedFlagRouting = 'EMERGENCY' | 'URGENT_CARE' | 'CRISIS';

export interface RedFlagRule {
  code: string;
  label: string;
  // Match expression (kept as JSON for guardrails — e.g. answers that trigger).
  match_json: string;
  level: number; // 1–5 acuity
  severity: RedFlagSeverity;
  routing: RedFlagRouting;
  guidance_key: string;
  active: boolean;
  version: number;
}

// ─── A3 · Clinical Vocabularies ──────────────────────────────────────────────

export type VocabKind = 'condition' | 'allergen' | 'medication';

export interface VocabEntry {
  kind: VocabKind;
  code: string;
  label: string;
  active: boolean;
}

// ─── A4 · Consent Versions ───────────────────────────────────────────────────

export interface ConsentVersion {
  consent_key: string;
  version: number;
  locale: string;
  body: string;
  active: boolean;
}

// ─── A5–A7 · Config (reminder / summary / guidance / localization) ───────────

// Config value is opaque JSON keyed by config_key. The console renders a
// structured editor per known key but stores/sends the raw value object.
export interface IntakeConfig {
  config_key: string;
  value: Record<string, unknown>;
}

export interface ReminderConfigValue {
  offsets_hours: number[];
  channels: string[];
  enabled: boolean;
}

export interface SummaryTemplateValue {
  section_order: string[];
  highlight_sections: string[];
}

export interface ContentLocalizationValue {
  locale: string;
  questions: Record<string, string>;
  urgent_care_copy: string;
  crisis_copy: string;
  guidance: Record<string, string>;
}

// ─── A8 · Intake Monitoring ──────────────────────────────────────────────────

export type IntakeStatus = 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED';

export interface MonitoringRow {
  appointment_id: string;
  patient: string;
  provider: string;
  intake_status: IntakeStatus;
  appointment_at: string;
  incomplete_near_appt: boolean;
}

// ─── A9 · Intake Record Viewer ───────────────────────────────────────────────

export interface IntakeRecordSection {
  key: string;
  label: string;
  // Patient-reported, decision-support only — never an assessment.
  values: Array<{ label: string; value: string }>;
  highlight?: boolean;
}

export interface IntakeRecord {
  appointment_id: string;
  intake_id: string;
  patient: string;
  provider: string;
  intake_status: IntakeStatus;
  submitted_at: string | null;
  consent_version: number | null;
  schema_version: number;
  sections: IntakeRecordSection[];
  // The viewer access itself is audit-logged server-side; the API echoes it.
  access_logged: boolean;
}

// ─── A10 · Access & Audit Log ────────────────────────────────────────────────

export type AccessLogEventType =
  | 'RECORD_VIEW'
  | 'CONSENT_ACCEPTED'
  | 'RED_FLAG_TRIGGERED'
  | 'SCHEMA_PUBLISHED'
  | 'RULE_TOGGLED';

export interface AccessLogRow {
  id: string;
  event_type: AccessLogEventType;
  actor: string;
  appointment_id: string | null;
  intake_id: string | null;
  detail: string;
  created_at: string;
}

// ─── A11 · Red-flag Queue ────────────────────────────────────────────────────

export type RedFlagDisposition =
  | 'OPEN'
  | 'ROUTED'
  | 'CONTACTED'
  | 'RESOLVED';

export interface RedFlagQueueRow {
  intake_id: string;
  appointment_id: string;
  severity: RedFlagSeverity;
  routing: RedFlagRouting;
  rule_codes: string[];
  created_at: string;
  disposition: RedFlagDisposition;
}

// ─── A12–A13 · Analytics ─────────────────────────────────────────────────────

export interface StepDropoff {
  step: string;
  reached: number;
  completed: number;
}

export interface LabelledCount {
  label: string;
  count: number;
}

export interface IntakeAnalytics {
  completion_rate: number; // 0–1
  per_step_dropoff: StepDropoff[];
  avg_time_to_complete_sec: number;
  top_complaints: LabelledCount[];
  top_conditions: LabelledCount[];
  red_flag_trigger_rate: number; // 0–1
}
