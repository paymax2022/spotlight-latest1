// ── Paymax Health — Shared types (Phase 0) ───────────────────────────────────
// The shared health platform every vertical (pharmacy/lab/vet) reuses.
// IRON RULE: all monetary amounts are integers in minor units (kobo).
// NDPA (HL-8): health data is sensitive — consent-gated, access-logged, signed-URL docs.

export type Vertical = 'pharmacy' | 'lab' | 'vet';

// ── Records vault (HL-8) ─────────────────────────────────────────────────────
// A record subject is either the patient (the consumer identity) or one of their pets.
export type SubjectType = 'patient' | 'pet';

export interface RecordSubject {
  id: string;
  type: SubjectType;
  name: string;
  /** patient: dob; pet: species/breed line for the chart header */
  detail: string;
  avatarColor?: string; // design-token key resolved by the UI
}

export type RecordKind =
  | 'prescription'
  | 'lab_result'
  | 'consult_note'
  | 'vaccination'
  | 'imaging'
  | 'document';

export type RecordSource = Vertical | 'self';

export interface HealthRecordDoc {
  id: string;
  label: string;
  mimeType: string;
  /** Signed-URL is fetched on demand (HL-8); never stored long-lived in client state. */
  signedUrlExpiresAt?: string;
}

export interface HealthRecord {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectType: SubjectType;
  kind: RecordKind;
  title: string;
  summary: string;
  source: RecordSource;
  providerId?: string;
  providerName?: string;
  /** ISO date the record was issued/created. */
  issuedAt: string;
  /** Abnormal/critical flag surfaces escalation context (HL-7) on lab results. */
  flagged?: boolean;
  docs: HealthRecordDoc[];
  /** Body fields for the detail view (key/value clinical summary). */
  fields?: { label: string; value: string }[];
}

// ── Consent & data-sharing (HL-8) ────────────────────────────────────────────
export type ConsentScope = RecordKind | 'all';
export type ConsentStatus = 'active' | 'revoked' | 'expired';

export interface ConsentGrant {
  id: string;
  subjectId: string;
  subjectName: string;
  /** Who receives access (a provider or another vertical). */
  granteeId: string;
  granteeName: string;
  granteeVertical: Vertical;
  scopes: ConsentScope[];
  status: ConsentStatus;
  grantedAt: string;
  /** Optional auto-expiry (NDPA data minimisation). */
  expiresAt?: string;
  /** Last time the grantee actually read data under this grant (access log, HL-8). */
  lastAccessedAt?: string;
}

export interface ConsentGrantInput {
  subjectId: string;
  granteeId: string;
  granteeVertical: Vertical;
  scopes: ConsentScope[];
  expiresAt?: string;
}

// ── Schema-driven intake (reused by all verticals) ───────────────────────────
export type IntakeFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'single_select'
  | 'multi_select'
  | 'boolean'
  | 'date'
  // ── Pre-Consult intake extensions ──────────────────────────────────────────
  | 'scale' // 1–10 severity chip selector (no slider lib)
  | 'med_list' // repeatable medication list: [{name, dose}] (M6), stored as JSON
  | 'attachment'; // photo / lab result / prescription upload (M12)

export interface IntakeOption {
  value: string;
  label: string;
}

export interface IntakeField {
  id: string;
  type: IntakeFieldType;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  options?: IntakeOption[]; // for select fields
  min?: number;
  max?: number;
  /**
   * Patient-reported safety flag — surfaces the "patient-reported, not assessed"
   * label on the field (§5.3, never present intake as diagnosis).
   */
  patientReported?: boolean;
  /**
   * "None" escape hatch for safety-critical list fields (meds/allergies, M6/M7):
   * the option value that means "nothing to report" and clears the rest.
   */
  noneValue?: string;
  /**
   * accept hint for attachment fields, forwarded to the file picker
   * (e.g. ".jpg,.png,.pdf").
   */
  accept?: string;
}

// ── Conditional intake steps (Pre-Consult wizard, M4–M12) ─────────────────────
// A step renders only when its `when` predicate (if any) is satisfied by the
// current answers — symptom detail only if symptomatic, pregnancy only if
// applicable (§7).
export type IntakeStepCondition =
  | { fieldId: string; equals: IntakeValue }
  | { fieldId: string; truthy: true }
  | { fieldId: string; includes: string };

export interface IntakeStep {
  id: string;
  title: string;
  description?: string;
  fields: IntakeField[];
  /** Render this step only when the predicate matches the live answers. */
  when?: IntakeStepCondition;
  /** Optional — purely informational mapping to the PRD screen number (M4…). */
  prdScreen?: string;
}

export interface IntakeSection {
  id: string;
  title: string;
  description?: string;
  fields: IntakeField[];
}

export interface IntakeSchema {
  id: string;
  /** Versioned (HEALTH-BUILD §3 — versioned questionnaires). */
  version: number;
  title: string;
  description: string;
  vertical: Vertical;
  sections: IntakeSection[];
}

export type IntakeValue = string | number | boolean | string[] | null;
export type IntakeResponseValues = Record<string, IntakeValue>;

export interface IntakeResponse {
  schemaId: string;
  schemaVersion: number;
  subjectId?: string;
  values: IntakeResponseValues;
  submittedAt?: string;
}

/** Field-level validation errors mapped by field id (HEALTH-BUILD: map field errors). */
export type IntakeErrors = Record<string, string>;

// ── Providers (HL-2 credential-gated) ────────────────────────────────────────
export type CredentialAuthority = 'VCN' | 'PCN' | 'MLSCN';
export type CredentialStatus = 'verified' | 'pending' | 'expired';

export interface ProviderCredential {
  authority: CredentialAuthority;
  licenseNo: string;
  status: CredentialStatus;
  expiresAt?: string;
}

export interface HealthProvider {
  id: string;
  name: string;
  vertical: Vertical;
  /** e.g. "Veterinary Surgeon", "Community Pharmacy", "Diagnostic Laboratory". */
  headline: string;
  bio: string;
  credential: ProviderCredential;
  rating: number;
  reviewCount: number;
  location: string;
  /** From this provider's consult/visit, in kobo. */
  baseFeeKobo: number;
  specialties: string[];
  /** Whether the provider is discoverable/active (HL-2: false until verified). */
  active: boolean;
}

// ── Tele-consult (HL-11 emergency safety) ────────────────────────────────────
export type ConsultStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type ConsultMode = 'video' | 'voice' | 'chat';

export interface ConsultChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  fromProvider: boolean;
  body: string;
  sentAt: string;
}

export interface Consult {
  id: string;
  vertical: Vertical;
  providerId: string;
  providerName: string;
  subjectId: string;
  subjectName: string;
  mode: ConsultMode;
  status: ConsultStatus;
  scheduledAt: string;
  /** When the provider is ready in the lobby (drives lobby copy). */
  providerReady: boolean;
  messages: ConsultChatMessage[];
}

// ── Pre-Consultation Health Intake (Telemedicine) ────────────────────────────
// A guarded prerequisite on a telemedicine appointment: the patient completes a
// save-as-you-go wizard before the consult can start (PRD §1, §7 — M1–M17).

export type IntakeStatus = 'DRAFT' | 'SUBMITTED';

/** Versioned, conditional schema for the Pre-Consult wizard (extends IntakeSchema). */
export interface PreConsultIntakeSchema {
  id: string;
  version: number;
  title: string;
  description: string;
  consentVersion: string;
  consentBody: string;
  /** Ordered, conditional steps (M4–M12). */
  steps: IntakeStep[];
}

export interface PreConsultIntake {
  appointmentId: string;
  schemaId: string;
  schemaVersion: number;
  status: IntakeStatus;
  /** Patient-reported answers keyed by field id. */
  answers: IntakeResponseValues;
  /** Consent version the patient accepted (M2); undefined until consented. */
  consentVersion?: string;
  consentAcceptedAt?: string;
  updatedAt?: string;
  submittedAt?: string;
  /** Doctor the details are prepared for (M15 confirmation copy). */
  doctorName?: string;
}

/** Uploaded attachment reference (M12). */
export interface IntakeAttachment {
  id: string;
  fieldId: string;
  fileName: string;
  mimeType: string;
  /** Object key / URL the server stored after the presigned PUT. */
  storageKey: string;
}

/**
 * Result of the red-flag triage that runs at submit (PRD §5). This is a
 * product-safety gate, never a diagnosis — it routes the patient to help.
 */
export interface RedFlagResult {
  severity: 'emergency' | 'urgent';
  routing: 'EMERGENCY' | 'URGENT_CARE' | 'CRISIS';
  guidance: {
    title: string;
    body: string;
    /** Crisis line shown for self-harm / CRISIS routing. */
    crisis_line?: string;
    /** Whether to surface the emergency-services call action. */
    show_emergency_number?: boolean;
  };
}

export interface SubmitIntakeResult {
  status: IntakeStatus;
  red_flag?: RedFlagResult;
  intake: PreConsultIntake;
}

/** Server response for GET intake by appointment (schema + prefill + consent). */
export interface ApptIntakeBundle {
  intake: PreConsultIntake;
  schema: PreConsultIntakeSchema;
  /** Pre-fill from the patient's profile + last intake (never re-ask, §3). */
  prefill: IntakeResponseValues;
  consent: { version: string; body: string; acceptedVersion?: string };
}

/** M17 — persistent longitudinal health profile that pre-fills future intakes. */
export interface HealthProfileEntry {
  label: string;
  value: string;
  /** Safety-critical entries (allergies/meds) render highlighted. */
  critical?: boolean;
}

export interface HealthProfile {
  subjectId: string;
  subjectName: string;
  conditions: HealthProfileEntry[];
  medications: HealthProfileEntry[];
  allergies: HealthProfileEntry[];
  updatedAt?: string;
  /** Source intakes that fed this profile (for the "from your intakes" note). */
  sourceCount: number;
}

// ── Care-loop hub summary ────────────────────────────────────────────────────
export interface ActiveOrderSummary {
  id: string;
  vertical: Vertical;
  title: string;
  statusLabel: string;
  /** route to push when tapped (vertical-owned screens). */
  href: string;
}

export interface HealthHubSummary {
  subjects: RecordSubject[];
  recentRecords: HealthRecord[];
  activeOrders: ActiveOrderSummary[];
  activeConsults: Consult[];
  pendingConsentRequests: number;
}
