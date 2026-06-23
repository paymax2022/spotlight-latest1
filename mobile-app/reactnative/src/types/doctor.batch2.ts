// ── Doctor (Telemedicine, provider-side) — Batch 2 Domain Types ──────────────
// Batch 2 = spec sections G, H, I, J. ADDITIVE to `@/types/doctor`,
// `@/types/doctor.phase2`, `@/types/doctor.profile`, `@/types/doctor.phase3` and
// `@/types/doctor.batch1` — those shapes are imported/reused, never duplicated.
// Money amounts are integers in minor units (kobo). Use `import type` for
// type-only imports.
//
// APPROACH IS CONSOLIDATED: action/state variants (typing/receipts, offline,
// reconnecting, drops, draft/lock, alerts) are modelled as states/data on top
// of the existing entities, not as separate entities. The Frontend renders all
// variants from the same shapes.
//
// Sections:
//   G — Patient Profile Review        (extends PatientMedicalProfile → PatientFullProfile).
//   H — Chat Consultation             (extends ChatMessage; adds presence/transcript).
//   I — Audio & Video Consultation    (extends CallSession; adds device check/feedback/dispute).
//   J — Consultation Notes & Diagnosis (extends SoapNote → ClinicalNote; adds DiagnosisCode).

import type {
  PatientSummary,
  PatientVital,
  PatientHistoryItem,
  PatientMedicalProfile,
  ChatMessage,
  ChatThread,
  ChatAuthor,
  CallSession,
  CallStatus,
  SoapNote,
  DoctorPrescription,
  LabResult,
  HmoCoverage,
} from '@/types/doctor';
import type { SpecialistReferral } from '@/types/doctor.phase2';

// Re-export the primitives Batch 2 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  PatientSummary,
  PatientVital,
  PatientHistoryItem,
  PatientMedicalProfile,
  ChatMessage,
  ChatThread,
  ChatAuthor,
  CallSession,
  CallStatus,
  SoapNote,
  DoctorPrescription,
  LabResult,
  HmoCoverage,
} from '@/types/doctor';
export type { SpecialistReferral } from '@/types/doctor.phase2';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION G — PATIENT PROFILE REVIEW (25)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `PatientMedicalProfile` ADDITIVELY via a new richer
// `PatientFullProfile` that COMPOSES the existing type (it is never modified).
// Clinical alerts (risk warning, drug-allergy, contraindication) are severity-
// toned data rows the UI renders as banners — not separate screens.

// Patient-type flag drives the demographics / dependent / elderly variants from
// one field (adult / child / elderly), plus a caregiver flag.
export type PatientType = 'adult' | 'child' | 'elderly';

// Demographics block (age band, occupation, marital status, etc.).
export interface PatientDemographics {
  dateOfBirth?:   string;          // ISO date
  patientType:    PatientType;     // adult | child | elderly
  hasCaregiver:   boolean;         // elderly/caregiver or child guardian present
  occupation?:    string;
  maritalStatus?: string;          // "Single", "Married", ...
  state?:         string;          // Nigerian state of residence
  city?:          string;
  bloodGroup?:    string;          // "O+"
  genotype?:      string;          // "AA"
  language?:      string;          // preferred language
}

// A single submitted symptom (patient intake before the consult).
export interface SubmittedSymptom {
  id:        string;
  label:     string;               // "Headache"
  severity:  'mild' | 'moderate' | 'severe';
  duration:  string;               // "3 days"
  note?:     string;
}

// An allergy entry (richer than the Phase 1 string list).
export interface AllergyEntry {
  id:        string;
  allergen:  string;               // "Penicillin"
  reaction:  string;               // "Rash, swelling"
  severity:  'mild' | 'moderate' | 'severe';
  type:      'drug' | 'food' | 'environmental' | 'other';
}

// A past surgery / procedure entry.
export interface PastSurgery {
  id:        string;
  procedure: string;               // "Appendectomy"
  year:      number;
  hospital?: string;
  note?:     string;
}

// A family medical-history entry.
export interface FamilyHistoryEntry {
  id:        string;
  relation:  string;               // "Father", "Mother", "Sibling"
  condition: string;               // "Type 2 Diabetes"
  note?:     string;
}

// One vitals reading at a point in time (timeseries — extends the Phase 1
// single-snapshot `PatientVital[]`).
export interface VitalsReading {
  recordedAt: string;              // ISO datetime
  vitals:     PatientVital[];      // reuse Phase 1 label/value pairs
}

// An uploaded medical document (lab report, discharge summary, imaging, etc.).
export type PatientDocumentKind =
  | 'lab_report'
  | 'imaging'
  | 'discharge_summary'
  | 'referral_letter'
  | 'prescription'
  | 'other';

export interface PatientDocument {
  id:         string;
  kind:       PatientDocumentKind;
  title:      string;
  fileName:   string;
  uri:        string;              // local URI now; remote URL after Phase C
  uploadedAt: string;             // ISO datetime
  source?:    string;             // "Lagoon Medical Centre"
}

// An uploaded image (photo of a rash, wound, etc.).
export interface PatientImage {
  id:       string;
  uri:      string;               // local URI now; remote URL after Phase C
  caption?: string;
  takenAt:  string;               // ISO datetime
}

// A previous consultation summary (compact row — full note lives in Section J).
export interface PreviousConsult {
  id:          string;
  date:        string;             // ISO date
  doctorName:  string;
  consultType: string;            // "video" | "audio" | "chat" (display label)
  summary:     string;
  diagnosis:   string[];          // ICD-lite labels
}

// Emergency contact for the patient.
export interface EmergencyContact {
  name:        string;
  relation:    string;             // "Spouse", "Parent"
  phone:       string;
  email?:      string;
}

// A dependent / child profile linked to the patient.
export interface DependentProfile {
  id:          string;
  name:        string;
  initials:    string;
  avatarColor: string;            // hex used for avatar circle
  relation:    string;            // "Daughter", "Son", "Ward"
  patientType: PatientType;       // typically 'child'
  ageMonths?:  number;            // for infants/children
}

// ─── Clinical alerts (severity-toned) ────────────────────────────────────────

export type ClinicalAlertSeverity = 'info' | 'warning' | 'critical';

// Generic patient risk warning (e.g. high BP, pregnancy, immunocompromised).
export interface PatientRiskWarning {
  id:        string;
  severity:  ClinicalAlertSeverity;
  title:     string;              // "High cardiovascular risk"
  detail:    string;
  riskType:  string;             // "cardiac", "pregnancy", "renal", ...
}

// Drug-allergy alert — patient has a documented allergy relevant to a drug.
export interface DrugAllergyAlert {
  id:        string;
  severity:  ClinicalAlertSeverity;
  allergen:  string;             // "Penicillin"
  drug:      string;             // the drug that would trigger it
  reaction:  string;             // documented reaction
  detail:    string;
}

// Contraindication alert — a drug/procedure clashes with a condition/medication.
export interface ContraindicationAlert {
  id:        string;
  severity:  ClinicalAlertSeverity;
  subject:   string;             // drug / procedure being flagged
  conflictsWith: string;         // condition / medication it conflicts with
  detail:    string;
}

// Aggregated clinical alerts surfaced at the top of the profile review.
export interface PatientClinicalAlerts {
  riskWarnings:       PatientRiskWarning[];
  drugAllergyAlerts:  DrugAllergyAlert[];
  contraindications:  ContraindicationAlert[];
}

// The full patient profile (Section G consolidated). COMPOSES the Phase 1
// `PatientMedicalProfile` and adds the richer review data ADDITIVELY. Reuses
// `DoctorPrescription` / `LabResult` (Phase 1) and `HmoCoverage` (Phase 1).
export interface PatientFullProfile {
  base:                 PatientMedicalProfile;   // reuse Phase 1 snapshot (blood group, allergies[], vitals snapshot, history)
  demographics:         PatientDemographics;
  chiefComplaint:       string;                  // primary reason for the visit
  submittedSymptoms:    SubmittedSymptom[];      // patient intake symptoms
  allergyHistory:       AllergyEntry[];          // richer allergy records
  pastSurgeries:        PastSurgery[];
  familyHistory:        FamilyHistoryEntry[];
  vitalsHistory:        VitalsReading[];         // timeseries of vitals
  documents:            PatientDocument[];       // uploaded medical documents
  images:               PatientImage[];          // uploaded images
  previousConsults:     PreviousConsult[];
  previousPrescriptions: DoctorPrescription[];   // reuse Phase 1 prescriptions
  previousLabResults:   LabResult[];             // reuse Phase 1 lab results
  hmoCoverage?:         HmoCoverage;             // reuse Phase 1 coverage (when HMO patient)
  emergencyContact?:    EmergencyContact;
  dependents:           DependentProfile[];      // child / dependent profiles
  alerts:               PatientClinicalAlerts;   // risk / drug-allergy / contraindication
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION H — CHAT CONSULTATION (23)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `ChatMessage` ADDITIVELY via `ChatMessageRich` (composes the
// base + kind/attachment/delivery metadata). Typing/receipts, patient-offline,
// chat-ended, secure-chat notice are STATES the UI renders from presence +
// thread status — not separate entities. Reuses Phase 1 `ChatThread`.

// What kind of payload a chat message carries (drives the bubble variant).
export type ChatMessageKind =
  | 'text'
  | 'voice'              // voice note (has voiceDurationSecs)
  | 'image'             // image attachment (annotatable)
  | 'document'          // medical document attachment
  | 'shared_prescription' // a prescription shared into the chat
  | 'shared_lab'        // a lab order/result shared into the chat
  | 'shared_summary'    // a consultation summary shared into the chat
  | 'system';           // system line (escalation, chat ended, secure notice)

// Per-message delivery state (drives the read-receipt tick variant).
export type ChatDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// Attachment metadata carried on image/document/voice messages.
export interface ChatAttachment {
  url:        string;              // local URI now; remote URL after Phase C
  name:       string;
  mimeType?:  string;              // "image/jpeg", "application/pdf"
  sizeBytes?: number;
}

// An annotation drawn/placed on an image attachment (normalised 0–1 coords).
export interface ChatImageAnnotation {
  id:    string;
  x:     number;                   // 0–1 (relative to image width)
  y:     number;                   // 0–1 (relative to image height)
  note:  string;                   // the doctor's note at this point
}

// A reference to an entity shared into the chat (rx / lab / summary). The id
// resolves to a DoctorPrescription / LabResult / ClinicalNote elsewhere.
export type SharedEntityKind = 'prescription' | 'lab' | 'summary';

export interface ChatSharedReference {
  kind:  SharedEntityKind;
  id:    string;                   // id of the shared entity
  ref:   string;                   // human ref, e.g. "RX-4F2A41"
  label: string;                   // display label
}

// The rich chat message — COMPOSES the Phase 1 `ChatMessage` and adds the
// Batch 2 metadata. The base `ChatMessage` (and `sendChatMessage`) is untouched.
export interface ChatMessageRich {
  base:              ChatMessage;       // reuse Phase 1 id/threadId/author/body/createdAt/attachment*
  kind:              ChatMessageKind;
  deliveryStatus:    ChatDeliveryStatus;
  voiceDurationSecs?: number;           // present when kind === 'voice'
  attachment?:       ChatAttachment;    // present for image/document/voice
  annotations?:      ChatImageAnnotation[]; // present for annotated images
  shared?:           ChatSharedReference;   // present for shared_* kinds
}

// Live presence for a chat participant (online / offline / typing). Typing
// indicators, patient-offline and doctor-offline warnings are all states here.
export type PresenceStatus = 'online' | 'offline' | 'typing';

export interface ChatParticipantPresence {
  threadId:    string;
  author:      ChatAuthor;          // whose presence this is (patient / doctor)
  status:      PresenceStatus;
  lastSeenAt?: string;             // ISO datetime (when offline)
}

// Whole-thread state (drives chat-ended + secure-chat notice variants).
export type ChatLifecycle = 'active' | 'ended';

export interface ChatThreadState {
  threadId:        string;
  lifecycle:       ChatLifecycle;
  endedAt?:        string;          // ISO datetime when ended
  secureNotice:    string;          // secure-chat / encryption notice copy
  patientPresence: ChatParticipantPresence;
  doctorPresence:  ChatParticipantPresence;
}

// A read-only transcript of the consultation chat (export / view transcript).
export interface ChatTranscript {
  threadId:    string;
  appointmentId: string;
  patient:     PatientSummary;
  messages:    ChatMessageRich[];
  startedAt:   string;             // ISO datetime
  endedAt?:    string;             // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION I — AUDIO & VIDEO CONSULTATION (28)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `CallSession` ADDITIVELY via `CallSessionRich` (composes the
// base + provider/device/network/participant/control state). Reconnecting,
// dropped, disconnected, poor-network, Agora-failure / VideoSDK-fallback are all
// STATES the UI renders from the call phase + provider + network fields.

// Real-time provider powering the call (with Agora → VideoSDK fallback).
export type CallProvider = 'agora' | 'videosdk';

// Network quality bucket (drives the poor-network + reconnecting warnings).
export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

// Extended call phase — ADDITIVE superset of Phase 1 `CallStatus`
// ('connecting'|'ringing'|'live'|'ended'|'failed') with the reconnect/drop
// states modelled explicitly so the UI does not need separate entities.
export type CallPhase =
  | CallStatus            // reuse the Phase 1 union
  | 'waiting_room'       // pre-join waiting room
  | 'reconnecting'       // dropped briefly, attempting to rejoin
  | 'dropped';           // call dropped (network / provider failure)

// Pre-call device check results (camera/mic test, network quality test).
export interface DeviceCheck {
  cameraOk:       boolean;
  micOk:          boolean;
  networkOk:      boolean;
  networkQuality: NetworkQuality;
  checkedAt:      string;          // ISO datetime
}

// Pre-call checklist (camera/mic test + network test + readiness flags).
export interface PreCallCheck {
  appointmentId: string;
  mode:          'audio' | 'video';
  device:        DeviceCheck;
  ready:         boolean;          // all required checks pass
  warnings:      string[];         // e.g. "Weak network detected"
}

// Per-participant connection state (patient/doctor connected? disconnected?).
export interface CallParticipantState {
  author:      ChatAuthor;          // 'doctor' | 'patient'
  connected:   boolean;
  disconnectedAt?: string;          // ISO datetime when they dropped
}

// In-call control toggles (mute, camera, speaker, view, switch camera).
export interface CallControls {
  muted:        boolean;
  cameraOn:     boolean;
  speakerOn:    boolean;
  frontCamera:  boolean;           // false → rear camera (switch camera)
  minimized:    boolean;           // minimized vs fullscreen view
}

// The rich call session — COMPOSES the Phase 1 `CallSession` and adds Batch 2
// provider/device/network/participant/control state. The base type (and
// `getCallSession`) is untouched.
export interface CallSessionRich {
  base:            CallSession;     // reuse Phase 1 id/appointmentId/patient/mode/status/duration/roomToken
  phase:           CallPhase;       // richer status (waiting_room/reconnecting/dropped)
  provider:        CallProvider;    // active real-time provider
  providerFailed:  boolean;         // true when Agora failed (drives fallback banner)
  networkQuality:  NetworkQuality;
  device:          DeviceCheck;     // last device-check result
  controls:        CallControls;
  patientState:    CallParticipantState;
  doctorState:     CallParticipantState;
}

// Post-call duration summary (call ended → duration summary screen).
export interface CallDurationSummary {
  appointmentId: string;
  patient:       PatientSummary;
  provider:      CallProvider;
  mode:          'audio' | 'video';
  durationSecs:  number;
  startedAt:     string;            // ISO datetime
  endedAt:       string;            // ISO datetime
  endedReason:   'completed' | 'dropped' | 'patient_left' | 'doctor_left';
}

// Call-quality feedback (rate the call after it ends).
export interface CallQualityFeedback {
  appointmentId: string;
  rating:        1 | 2 | 3 | 4 | 5;
  audioOk:       boolean;
  videoOk:       boolean;
  comment?:      string;
  submittedAt:   string;            // ISO datetime
}

// A failed-call dispute (patient/doctor disputes a charge for a failed call).
export type CallDisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';

export interface CallDispute {
  id:            string;
  ref:           string;            // e.g. "CDP-9F2A41"
  appointmentId: string;
  reason:        string;            // why the call failed / is disputed
  status:        CallDisputeStatus;
  raisedAt:      string;            // ISO datetime
  resolution?:   string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION J — CONSULTATION NOTES & DIAGNOSIS (24)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `SoapNote` ADDITIVELY via `ClinicalNote` (composes the base +
// codes/impression/plan/referral/follow-up/private notes + status). Draft /
// finalize / locked / edit-before-submission are STATES driven by `status`,
// not separate entities. Reuses the Phase 2 `SpecialistReferral` concept.

// A searchable ICD-lite diagnosis code (drives diagnosis search + code select).
export interface DiagnosisCode {
  code:     string;                // "I10"
  label:    string;                // "Essential Hypertension"
  category: string;                // "Cardiovascular", "Endocrine", ...
}

// A red-flag warning attached to the note (emergency / urgent escalation cue).
export type RedFlagSeverity = 'warning' | 'critical';

export interface RedFlagWarning {
  id:        string;
  severity:  RedFlagSeverity;
  label:     string;               // "Chest pain with radiation"
  action:    string;               // recommended action, e.g. "Refer to ED now"
}

// A lifestyle recommendation line.
export interface LifestyleRecommendation {
  id:       string;
  category: string;                // "Diet", "Exercise", "Smoking"
  text:     string;
}

// A follow-up recommendation embedded in the note.
export interface NoteFollowUp {
  recommended: boolean;
  dueInDays?:  number;             // e.g. 14 (review in two weeks)
  reason?:     string;
  note?:       string;
}

// A specialist-referral recommendation embedded in the note. Reuses the Phase 2
// `SpecialistReferral['urgency']` concept; the full referral is created via the
// Phase 2 flow — this records the recommendation made from the note.
export interface NoteReferral {
  recommended: boolean;
  specialty?:  string;             // "Cardiology"
  urgency?:    SpecialistReferral['urgency'];
  reason?:     string;
}

// The note lifecycle status — draft (editable) → finalized → locked
// (immutable). "Edit before submission" is the draft state; "locked note after
// submission" is the locked state.
export type ClinicalNoteStatus = 'draft' | 'finalized' | 'locked';

// The rich clinical note (Section J consolidated). COMPOSES the Phase 1
// `SoapNote` and adds the richer clinical fields ADDITIVELY. The base `SoapNote`
// (and `saveSoapNote`) is untouched.
export interface ClinicalNote {
  base:                    SoapNote;        // reuse Phase 1 subjective/objective/assessment/plan/diagnosis
  icdCodes:                DiagnosisCode[];  // selected ICD codes
  clinicalImpression:      string;          // narrative impression
  treatmentPlan:           string;          // explicit treatment plan
  lifestyleRecommendations: LifestyleRecommendation[];
  redFlags:                RedFlagWarning[];
  referral:                NoteReferral;     // emergency / specialist referral recommendation
  followUp:                NoteFollowUp;
  privateNotes:            string;          // doctor-only notes (not shared with patient)
  status:                  ClinicalNoteStatus;
  version:                 number;          // increments on each save
  sharedWithPatient:       boolean;         // summary shared with the patient
  updatedAt:               string;          // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// ─── Section H — chat consultation ───────────────────────────────────────────

export interface SendVoiceNoteInput {
  threadId:         string;
  uri:              string;        // local file URI of the recording
  durationSecs:     number;
  idempotencyKey:   string;
}

export interface SendVoiceNoteResult {
  message: ChatMessageRich;
}

export interface SendAttachmentInput {
  threadId:         string;
  kind:             'image' | 'document';
  uri:              string;        // local file URI
  fileName:         string;
  mimeType?:        string;
  caption?:         string;
  idempotencyKey:   string;
}

export interface SendAttachmentResult {
  message: ChatMessageRich;
}

export interface AnnotateImageInput {
  messageId:        string;
  annotations:      ChatImageAnnotation[];
  idempotencyKey:   string;
}

export interface AnnotateImageResult {
  messageId:   string;
  annotations: ChatImageAnnotation[];
}

export interface ShareInChatInput {
  threadId:         string;
  kind:             SharedEntityKind;  // prescription | lab | summary
  entityId:         string;            // id of the entity being shared
  idempotencyKey:   string;
}

export interface ShareInChatResult {
  message: ChatMessageRich;
}

export interface EscalateToCallInput {
  threadId:         string;
  mode:             'audio' | 'video';
  idempotencyKey:   string;
}

export interface EscalateToCallResult {
  appointmentId: string;
  mode:          'audio' | 'video';
  callId:        string;
}

export interface ReportMessageInput {
  messageId:        string;
  reason:           string;
  idempotencyKey:   string;
}

export interface ReportMessageResult {
  messageId: string;
  reported:  boolean;
}

export interface EndChatInput {
  threadId:         string;
  idempotencyKey:   string;
}

export interface EndChatResult {
  threadId:  string;
  lifecycle: ChatLifecycle;   // → 'ended'
  endedAt:   string;          // ISO datetime
}

// ─── Section I — audio & video consultation ──────────────────────────────────

export interface RunDeviceCheckInput {
  appointmentId:    string;
  mode:             'audio' | 'video';
  idempotencyKey:   string;
}

export interface RunDeviceCheckResult {
  check: PreCallCheck;
}

export interface JoinCallInput {
  appointmentId:    string;
  mode:             'audio' | 'video';
  idempotencyKey:   string;
}

export interface JoinCallResult {
  callId:    string;
  provider:  CallProvider;
  phase:     CallPhase;            // → 'live' (or 'waiting_room')
  roomToken: string;
}

export interface LeaveCallInput {
  appointmentId:    string;
  idempotencyKey:   string;
}

export interface LeaveCallResult {
  appointmentId: string;
  phase:         CallPhase;        // → 'ended'
  summary:       CallDurationSummary;
}

export interface SwitchProviderInput {
  appointmentId:    string;
  to:               CallProvider;  // typically 'videosdk' (Agora → VideoSDK fallback)
  idempotencyKey:   string;
}

export interface SwitchProviderResult {
  appointmentId: string;
  provider:      CallProvider;
  phase:         CallPhase;        // → 'reconnecting' then 'live'
}

export interface SubmitCallFeedbackInput {
  appointmentId:    string;
  rating:           1 | 2 | 3 | 4 | 5;
  audioOk:          boolean;
  videoOk:          boolean;
  comment?:         string;
  idempotencyKey:   string;
}

export interface SubmitCallFeedbackResult {
  appointmentId: string;
  submitted:     boolean;
}

export interface RaiseCallDisputeInput {
  appointmentId:    string;
  reason:           string;
  idempotencyKey:   string;
}

export interface RaiseCallDisputeResult {
  disputeId: string;
  ref:       string;
  status:    CallDisputeStatus;
}

export interface ReportTechnicalIssueInput {
  appointmentId:    string;
  category:         string;        // "audio", "video", "connection", ...
  detail:           string;
  idempotencyKey:   string;
}

export interface ReportTechnicalIssueResult {
  ticketId: string;
  ref:      string;
}

// ─── Section J — consultation notes & diagnosis ──────────────────────────────

// Editable payload for a clinical note (the draft body, no server-assigned ids).
export interface ClinicalNoteDraft {
  appointmentId:           string;
  patientId:               string;
  subjective:              string;
  objective:               string;
  assessment:              string;
  plan:                    string;
  diagnosis:               string[];        // ICD-lite labels (Phase 1 shape)
  icdCodes:                DiagnosisCode[];
  clinicalImpression:      string;
  treatmentPlan:           string;
  lifestyleRecommendations: LifestyleRecommendation[];
  redFlags:                RedFlagWarning[];
  referral:                NoteReferral;
  followUp:                NoteFollowUp;
  privateNotes:            string;
}

export interface SaveDraftNoteInput {
  note:             ClinicalNoteDraft;
  idempotencyKey:   string;
}

export interface SaveDraftNoteResult {
  noteId:    string;
  status:    ClinicalNoteStatus;   // → 'draft'
  version:   number;
  updatedAt: string;               // ISO datetime
}

export interface FinalizeNoteInput {
  noteId:           string;
  idempotencyKey:   string;
}

export interface FinalizeNoteResult {
  noteId:   string;
  status:   ClinicalNoteStatus;    // → 'finalized' then 'locked'
  locked:   boolean;
  lockedAt: string;                // ISO datetime
}

export interface ShareSummaryInput {
  noteId:           string;
  idempotencyKey:   string;
}

export interface ShareSummaryResult {
  noteId:           string;
  sharedWithPatient: boolean;
  sharedAt:         string;        // ISO datetime
}
