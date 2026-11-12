// ── Pre-consult intake — live payload → wizard-shape mapping ────────────────
// The patient wizard (M2–M16) was written against `api/preconsult.mock.ts`, which
// hands back an already-assembled `ApptIntakeBundle`. The Go service
// (backend/internal/health/preconsult) answers a different shape: an
// `{ success, data }` (or `{ success, intake }`) envelope, a FLAT field list keyed
// by storage `name`, an INTEGER consent version, and draft answers under `draft`
// rather than `intake.answers`. Field ids, step grouping, question labels and
// option labels all ride in the schema row's per-field `ui` block — see
// supabase/migrations/20271408000000_preconsult_intake_schema_ui.sql — because the
// server contract is `{name,type,required,options}` and intake.validate ignores `ui`.
//
// Everything here is read straight off the server payload or derived
// deterministically from it. The one exception is `ATTACHMENTS_STEP` (M12), which
// the server keeps OUTSIDE the schema by design (presign + record flow) and so no
// schema row can describe.
//
// Field NAMES, not labels, are the contract: `toServerAnswers` only ever sends
// names the active schema declares, because intake.validate rejects an unknown key
// outright — one client-only field would 400 the whole submit.

import type {
  ApptIntakeBundle,
  HealthProfile,
  HealthProfileEntry,
  IntakeAttachment,
  IntakeField,
  IntakeFieldType,
  IntakeOption,
  IntakeResponseValues,
  IntakeStep,
  PreConsultIntake,
  PreConsultIntakeSchema,
  RedFlagResult,
  SubmitIntakeResult,
} from './types';

// ── Server shapes (handler.go + repository.go + service.go JSON tags) ────────

/** healthintake.Field. `ui` is presentation only — never read by intake.validate. */
interface ServerFieldUI {
  step?: { id?: string; title?: string; description?: string; prdScreen?: string };
  type?: string;
  label?: string;
  help?: string;
  placeholder?: string;
  options?: IntakeOption[];
  min?: number;
  max?: number;
  integer?: boolean;
  patientReported?: boolean;
  noneValue?: string;
  accept?: string;
  critical?: boolean;
}

export interface ServerField {
  name?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  ui?: ServerFieldUI;
}

interface ServerSchema {
  id?: string;
  slug?: string;
  version?: number;
  fields?: ServerField[];
}

interface ServerConsent {
  version?: number;
  locale?: string;
  body?: string;
}

interface ServerIntake {
  appointment_id?: string;
  schema_id?: string;
  status?: string;
  consent_version?: number | null;
  consent_at?: string | null;
  submitted_at?: string | null;
  updated_at?: string;
  /** `[{kind, storage_key, content_type}]` — written by the record step, never by answers. */
  attachments?: unknown;
}

/** GET /intake/appointments/:id → `{"success":true,"data":PatientView}`. */
export interface ServerBundle {
  intake?: ServerIntake;
  schema?: ServerSchema;
  prefill?: Record<string, unknown>;
  consent?: ServerConsent;
  draft?: Record<string, unknown> | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const optNum = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** The storage type's natural renderer, used when a field carries no `ui.type`. */
const DEFAULT_RENDER_TYPE: Record<string, IntakeFieldType> = {
  text: 'long_text',
  number: 'number',
  bool: 'boolean',
  select: 'single_select',
};

const RENDER_TYPES: string[] = [
  'short_text', 'long_text', 'number', 'single_select', 'multi_select',
  'boolean', 'date', 'scale', 'med_list', 'attachment',
];

/** 'reason_for_visit' → 'Reason for visit' — keeps an unseeded schema row askable. */
function humanizeName(name: string): string {
  if (!name) return '';
  const words = name.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function mapField(f: ServerField): IntakeField | null {
  const id = str(f.name);
  if (!id) return null;
  const ui = f.ui ?? {};
  const field: IntakeField = {
    id,
    type: RENDER_TYPES.includes(str(ui.type))
      ? (ui.type as IntakeFieldType)
      : DEFAULT_RENDER_TYPE[str(f.type)] ?? 'long_text',
    label: str(ui.label) || humanizeName(id),
  };
  if (ui.help) field.help = str(ui.help);
  if (ui.placeholder) field.placeholder = str(ui.placeholder);
  if (f.required === true) field.required = true;
  if (optNum(ui.min) !== undefined) field.min = ui.min;
  if (optNum(ui.max) !== undefined) field.max = ui.max;
  if (ui.integer === true) field.integer = true;
  if (ui.patientReported === true) field.patientReported = true;
  if (ui.critical === true) field.critical = true;
  if (ui.noneValue) field.noneValue = str(ui.noneValue);
  if (ui.accept) field.accept = str(ui.accept);

  // Option VALUES come from the storage contract — that is what the server accepts —
  // and only their LABELS come from ui. A ui option for a value the row does not
  // allow is dropped rather than offered, since picking it would 400 the submit.
  const allowed = Array.isArray(f.options) ? f.options.filter((o) => typeof o === 'string') : [];
  if (allowed.length > 0) {
    const labelled = new Map<string, string>(
      (Array.isArray(ui.options) ? ui.options : [])
        .filter((o) => o && allowed.includes(str(o.value)))
        .map((o) => [str(o.value), str(o.label)]),
    );
    field.options = allowed.map((value) => ({
      value,
      label: labelled.get(value) || humanizeName(value),
    }));
  }
  return field;
}

/**
 * Group the flat server field list into the wizard's ordered steps, keyed by
 * `ui.step.id` and preserving first-seen order. A field with no `ui.step` falls
 * into a trailing `details` step rather than vanishing from the questionnaire.
 */
export function stepsFromServerFields(fields: ServerField[] | undefined): IntakeStep[] {
  const order: string[] = [];
  const byId = new Map<string, IntakeStep>();
  for (const raw of fields ?? []) {
    const field = mapField(raw);
    if (!field) continue;
    const meta = raw.ui?.step ?? {};
    const id = str(meta.id) || 'details';
    let step = byId.get(id);
    if (!step) {
      step = { id, title: str(meta.title) || humanizeName(id), fields: [] };
      byId.set(id, step);
      order.push(id);
    }
    // Only the leading field of a step repeats the step copy in the seed, but a
    // later one may still be the first to carry it — fill whatever is missing.
    if (!step.description && meta.description) step.description = str(meta.description);
    if (!step.prdScreen && meta.prdScreen) step.prdScreen = str(meta.prdScreen);
    step.fields.push(field);
  }
  return order.map((id) => byId.get(id) as IntakeStep);
}

/**
 * M12 — attachments. OUTSIDE the schema on the server (see the PreConsultFields
 * comment in preconsult/service.go), so the wizard owns the step. Its field id is
 * deliberately not a schema name: `toServerAnswers` drops it and the files reach
 * the server through the presign→PUT→record path instead.
 */
/** The M12 field id the wizard keys its attachment rows by (never an answer key). */
export const ATTACHMENT_FIELD_ID = 'attachments_list';

export const ATTACHMENTS_STEP: IntakeStep = {
  id: 'attachments',
  title: 'Attachments',
  description: 'Optional — photos, lab results, or prior prescriptions.',
  prdScreen: 'M12',
  fields: [
    {
      id: ATTACHMENT_FIELD_ID,
      type: 'attachment',
      label: 'Add photos or documents',
      help: 'e.g. a photo of a rash, a lab report, or a previous prescription.',
      accept: '.jpg,.jpeg,.png,.pdf,.webp',
    },
  ],
};

/**
 * The server restricts attachment metadata to one of four kinds
 * (`attachmentKinds` in preconsult/repository.go). Images are photos; anything
 * else it accepts (a PDF) is reported as `other` rather than guessing that a
 * document is a lab result or a prescription.
 */
export function attachmentKindFor(mimeType: string): string {
  return mimeType.startsWith('image/') ? 'photo' : 'other';
}

/** The names the active schema declares — the only keys the server will accept. */
export function serverFieldNames(fields: ServerField[] | undefined): string[] {
  return (fields ?? []).map((f) => str(f.name)).filter(Boolean);
}

/** Field ids the wizard owns and the schema does not declare (M12 only). */
const CLIENT_ONLY_FIELD_IDS = new Set(ATTACHMENTS_STEP.fields.map((f) => f.id));

/**
 * The answer keys a bundle's steps may send to the server. Derived from the mapped
 * steps rather than a hardcoded list, so a schema change cannot desynchronise it.
 */
export function schemaAnswerNames(steps: IntakeStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    for (const field of step.fields) {
      if (!CLIENT_ONLY_FIELD_IDS.has(field.id)) ids.push(field.id);
    }
  }
  return ids;
}

export type ServerAnswer = string | number | boolean;

/**
 * Answers as the server wants them: schema names only, and blanks dropped.
 * intake.validate 400s on an unknown key and on `''` in a select or a number, and
 * treats absent/null as "not answered" — which is exactly what a cleared optional
 * field means. Array values (multi_select has no server counterpart) are dropped
 * for the same reason: storing them would fail the whole submit.
 */
export function toServerAnswers(
  values: IntakeResponseValues,
  allowedNames: string[],
): Record<string, ServerAnswer> {
  const allowed = new Set(allowedNames);
  const out: Record<string, ServerAnswer> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') out[key] = trimmed;
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** `consent_version` (integer|null) ↔ the client's stringly-typed version. */
const clientConsentVersion = (v: number | null | undefined): string | undefined =>
  optNum(v) === undefined ? undefined : String(v);

/**
 * The wire form of a consent version: an integer, or `undefined` so an autosave
 * sends no `consent_version` key at all and cannot wipe a recorded agreement.
 */
export function serverConsentVersion(v: string | number | undefined): number | undefined {
  if (typeof v === 'number') return Number.isInteger(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isInteger(n) ? n : undefined;
  }
  return undefined;
}

function mapIntake(
  it: ServerIntake | undefined,
  answers: IntakeResponseValues,
  schemaVersion: number,
): PreConsultIntake {
  const out: PreConsultIntake = {
    appointmentId: str(it?.appointment_id),
    schemaId: str(it?.schema_id),
    schemaVersion,
    status: it?.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT',
    answers,
  };
  const accepted = clientConsentVersion(it?.consent_version);
  if (accepted !== undefined) out.consentVersion = accepted;
  if (it?.consent_at) out.consentAcceptedAt = str(it.consent_at);
  if (it?.submitted_at) out.submittedAt = str(it.submitted_at);
  if (it?.updated_at) out.updatedAt = str(it.updated_at);
  const stored = mapStoredAttachments(it?.attachments, ATTACHMENT_FIELD_ID);
  if (stored.length > 0) out.attachments = stored;
  return out;
}

/**
 * `[{kind, storage_key, content_type}]` → the wizard's attachment rows. The server
 * stores keys only (never the original file name), so the key's last segment is the
 * only name that can honestly be shown.
 */
export function mapStoredAttachments(raw: unknown, fieldId: string): IntakeAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeAttachment[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    const storageKey = str(a?.storage_key);
    if (!storageKey) continue;
    out.push({
      id: storageKey,
      fieldId,
      fileName: storageKey.split('/').pop() as string,
      mimeType: str(a?.content_type),
      storageKey,
    });
  }
  return out;
}

/** Submit's `red_flag` `{severity, routing, guidance}` → the M13 interstitial. */
export function mapRedFlag(raw: unknown): RedFlagResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const severity = str(r.severity);
  const routing = str(r.routing);
  const guidance = r.guidance as Record<string, unknown> | null;
  if (!severity || !routing || !guidance || typeof guidance !== 'object') return undefined;
  return {
    severity: severity === 'urgent' ? 'urgent' : 'emergency',
    routing: routing === 'CRISIS' || routing === 'URGENT_CARE' ? routing : 'EMERGENCY',
    guidance: {
      title: str(guidance.title),
      body: str(guidance.body),
      crisis_line: str(guidance.crisis_line) || undefined,
      show_emergency_number: guidance.show_emergency_number === true,
    },
  };
}

/**
 * PatientView → `ApptIntakeBundle`. `extraSteps` defaults to the M12 step the
 * server cannot describe; pass `[]` to render only what the schema row declares.
 */
export function mapIntakeBundle(
  view: ServerBundle | null | undefined,
  extraSteps: IntakeStep[] = [ATTACHMENTS_STEP],
): ApptIntakeBundle {
  const serverFields = view?.schema?.fields ?? [];
  const schemaVersion = optNum(view?.schema?.version) ?? 0;
  const version = clientConsentVersion(optNum(view?.consent?.version)) ?? '';
  const body = str(view?.consent?.body);

  const schema: PreConsultIntakeSchema = {
    id: str(view?.schema?.id),
    version: schemaVersion,
    // The bundle carries no wizard title or intro; every screen in the flow already
    // renders its own header, and no live consumer reads these two fields.
    title: 'Health intake',
    description: str(view?.schema?.slug),
    consentVersion: version,
    consentBody: body,
    steps: [...stepsFromServerFields(serverFields), ...extraSteps],
  };

  const consent: ApptIntakeBundle['consent'] = { version, body };
  const accepted = clientConsentVersion(view?.intake?.consent_version);
  if (accepted !== undefined) consent.acceptedVersion = accepted;

  return {
    // No doctor name in this payload (it belongs to the appointment), so M15's
    // "ready for {doctorName}" falls back to "your doctor".
    intake: mapIntake(view?.intake, (view?.draft ?? {}) as IntakeResponseValues, schemaVersion),
    schema,
    prefill: (view?.prefill ?? {}) as IntakeResponseValues,
    consent,
  };
}

/** PUT …/draft → `{success, intake}`. Draft answers are not echoed in this envelope. */
export function mapDraftEnvelope(body: unknown): PreConsultIntake {
  const b = body as { intake?: ServerIntake } | null;
  return mapIntake(b?.intake, {}, 0);
}

/** POST …/submit → `{success, data:{status, red_flag?, intake, response_id}}`. */
export function mapSubmitEnvelope(body: unknown): SubmitIntakeResult {
  const d = (body as { data?: Record<string, unknown> } | null)?.data;
  const out: SubmitIntakeResult = {
    status: str(d?.status) === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT',
    intake: mapIntake(d?.intake as ServerIntake | undefined, {}, 0),
  };
  const red = mapRedFlag(d?.red_flag);
  if (red) out.red_flag = red;
  return out;
}

/**
 * POST …/attachments/presign → `{success, data:{upload_url, storage_key,
 * content_type, bucket, expires_in, method}}`.
 */
export function mapPresignEnvelope(body: unknown): {
  uploadUrl: string;
  storageKey: string;
  contentType: string;
} {
  const d = (body as { data?: Record<string, unknown> } | null)?.data ?? {};
  return {
    uploadUrl: str(d.upload_url),
    storageKey: str(d.storage_key),
    contentType: str(d.content_type),
  };
}

/**
 * M17 — GET /intake/health-profile → `{success, profile}`.
 * service.go's HealthProfile hands back the RAW answer values of the patient's
 * latest prior response under the schema field names, so nothing here is a
 * wizard entry until it is split. Newline and ';' are the only separators
 * because the seeded schema teaches those ("One per line"; "penicillin — rash;
 * codeine — nausea") while a condition name may itself contain a comma.
 */
export function mapHealthProfileEnvelope(body: unknown): HealthProfile {
  const p = (body as { profile?: Record<string, unknown> } | null)?.profile ?? {};
  return {
    allergies: profileItems(p.allergies).map((item) => ({ label: item, value: 'Reported', critical: true })),
    medications: profileItems(p.current_medications).map((item) => ({ label: item, value: 'Current', critical: true })),
    conditions: [...profileItems(p.chronic_conditions), ...profileItems(p.chronic_other)]
      .map((item) => ({ label: item, value: 'Ongoing' })),
    updatedAt: str(p.last_updated) || undefined,
  };
}

/** One answer cell → the lines a patient actually wrote. */
function profileItems(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw)) return raw.map((v) => str(v).trim()).filter(Boolean);
  return [];
}

