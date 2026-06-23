// ── Doctor (Telemedicine, provider-side) — Batch 4 Domain Types ──────────────
// Batch 4 = spec sections O (HMO/Insurance), P (Referral & Specialist
// Collaboration), Q (Follow-Up Care), R (Emergency & Escalation).
//
// CONSOLIDATED + HEAVY REUSE: these sections overlap Phase 1/Phase 2 HMO claims,
// specialist referrals and follow-up plans. We import/re-export those shapes and
// add ONLY the missing, richer variants. Granular variants (statuses,
// approve/reject, escalation steps) are modelled as states/data, NOT separate
// entities. Money amounts are integers in minor units (kobo). Use `import type`
// for type-only imports.
//
// ADDITIVE to `@/types/doctor`, `@/types/doctor.phase2` and `@/types/doctor.batch2`
// — earlier shapes are imported/reused, never duplicated.

import type {
  PatientSummary,
  ChatAuthor,
  HmoEligibility,
  EligibilityStatus,
} from '@/types/doctor';

import type {
  HmoClaim,
  ClaimStatus,
  ClaimLineItem,
  ClaimEvent,
  Specialist,
  SpecialistReferral,
  ReferralStatus,
  ReferralAttachment,
  ReferralAttachmentKind,
  FollowUpPlan,
  FollowUpKind,
  FollowUpStatus,
  SoapNote,
  DoctorPrescription,
  LabResult,
} from '@/types/doctor.phase2';

import type { RedFlagWarning, RedFlagSeverity } from '@/types/doctor.batch2';

// Re-export the reused shapes so a Batch 4 screen can pull everything it needs
// from one import site.
export type {
  PatientSummary,
  ChatAuthor,
  HmoEligibility,
  EligibilityStatus,
} from '@/types/doctor';

export type {
  HmoClaim,
  ClaimStatus,
  ClaimLineItem,
  ClaimEvent,
  Specialist,
  SpecialistReferral,
  ReferralStatus,
  ReferralAttachment,
  ReferralAttachmentKind,
  FollowUpPlan,
  FollowUpKind,
  FollowUpStatus,
  SoapNote,
  DoctorPrescription,
  LabResult,
} from '@/types/doctor.phase2';

export type { RedFlagWarning, RedFlagSeverity } from '@/types/doctor.batch2';

// ═══════════════════════════════════════════════════════════════════════════
// Section O — HMO / Insurance (19 entries)
// REUSE: HmoEligibility, EligibilityStatus, HmoClaim, ClaimStatus,
// ClaimLineItem, ClaimEvent, submitClaim, disputeClaim. ADD plan coverage,
// pre-authorisation, covered-service status, HMO support chat, fraud warning.
// ═══════════════════════════════════════════════════════════════════════════

// ─── O.1 Plan coverage summary (benefits / limits / co-pay) ──────────────────

export interface HmoBenefitLine {
  id:        string;
  service:   string;            // "Teleconsultation", "Laboratory", "Pharmacy"
  covered:   boolean;
  limitKobo?: number;           // annual / per-encounter cap, when applicable
  usedKobo?:  number;           // amount of the limit already consumed
  note?:     string;            // "Generic drugs only", "Pre-auth required"
}

export interface HmoPlanCoverage {
  planId:        string;
  planName:      string;        // "Hygeia HMO — Bronze"
  provider:      string;        // "Hygeia HMO"
  memberId:      string;        // patient enrollee number (masked)
  patient:       PatientSummary;
  status:        EligibilityStatus; // reuse Phase 2 eligibility status
  coPayKobo:     number;        // flat co-payment due from patient (0 = none)
  coPayPct?:     number;        // percentage co-pay, when applicable (0–100)
  annualLimitKobo: number;      // overall annual cover cap
  annualUsedKobo:  number;      // amount consumed against the annual cap
  validFrom:     string;        // ISO date
  validTo:       string;        // ISO date
  benefits:      HmoBenefitLine[];
}

// ─── O.2 Pre-authorisation request ───────────────────────────────────────────
// Approval pending / approved / rejected and coverage-limit-exceeded are STATES
// modelled here, not separate entities.

export type PreAuthStatus =
  | 'pending'           // submitted, awaiting HMO decision
  | 'approved'          // authorised
  | 'rejected'          // declined
  | 'limit_exceeded';   // declined because coverage limit is exhausted

export interface PreAuthRequest {
  id:               string;
  ref:              string;     // e.g. "PA-7C1B88"
  appointmentId?:   string;
  patient:          PatientSummary;
  provider:         string;     // "Hygeia HMO"
  planName:         string;
  service:          string;     // service requiring authorisation
  estimatedKobo:    number;     // estimated cost being authorised
  status:           PreAuthStatus;
  authCode?:        string;     // present when approved
  requestedAt:      string;     // ISO datetime
  decidedAt?:       string;     // ISO datetime
  rejectionReason?: string;     // present when rejected / limit_exceeded
  note?:            string;     // clinical justification
}

// ─── O.3 Covered service status (rx / lab coverage) ──────────────────────────
// One shape for "covered prescription status" and "covered lab-order status".

export type CoveredServiceKind = 'prescription' | 'lab' | 'consultation';

export type CoveredServiceStatus =
  | 'covered'           // fully covered by the plan
  | 'partial'           // partially covered (co-pay / limit applies)
  | 'not_covered'       // excluded from the plan
  | 'pending_auth';     // requires pre-authorisation first

export interface CoveredService {
  id:           string;
  kind:         CoveredServiceKind;
  refId:        string;         // DoctorPrescription / LabOrder / appointment id
  refLabel:     string;         // human ref, e.g. "RX-4F2A41"
  description:  string;         // "Metformin 500mg ×30", "Lipid Profile"
  status:       CoveredServiceStatus;
  totalKobo:    number;         // full price
  coveredKobo:  number;         // amount the HMO covers
  patientKobo:  number;         // amount the patient pays (co-pay / excess)
  note?:        string;         // "Generic substitution required"
}

// ─── O.4 HMO support chat ────────────────────────────────────────────────────
// Lightweight thread (NOT the rich consult ChatMessageRich). Reuses ChatAuthor
// for sender symmetry but adds an 'hmo' agent author.

export type HmoSupportAuthor = ChatAuthor | 'hmo';

export interface HmoSupportMessage {
  id:        string;
  threadId:  string;            // claim / pre-auth thread id
  author:    HmoSupportAuthor;  // 'doctor' | 'patient' | 'hmo'
  body:      string;
  createdAt: string;            // ISO datetime
}

export interface HmoSupportThread {
  threadId:  string;
  provider:  string;            // "Hygeia HMO"
  subject:   string;            // "Claim CLM-9F2A41 — query"
  claimId?:  string;
  preAuthId?: string;
  messages:  HmoSupportMessage[];
}

// ─── O.5 HMO fraud warning ───────────────────────────────────────────────────

export type FraudWarningSeverity = 'info' | 'warning' | 'critical';

export interface HmoFraudWarning {
  id:           string;
  severity:     FraudWarningSeverity;
  title:        string;         // "Duplicate claim detected"
  body:         string;         // explanation / required action
  relatedRef?:  string;         // related claim / pre-auth ref
  createdAt:    string;         // ISO datetime
  acknowledged: boolean;        // doctor has read + acknowledged the warning
}

// ═══════════════════════════════════════════════════════════════════════════
// Section P — Referral & Specialist Collaboration (16 entries)
// REUSE: Specialist, SpecialistReferral, ReferralStatus, ReferralAttachment,
// createReferral, useReferrals, useSpecialists. ADD incoming referrals,
// opinion requests, care-team chat, shared case summary.
// ═══════════════════════════════════════════════════════════════════════════

// ─── P.1 Incoming referral (referrals TO this doctor) ────────────────────────
// "Refer to specialist / select / reason / attach / sent / accepted / rejected"
// are covered by the existing OUTGOING SpecialistReferral. This is the inbound
// counterpart so a specialist doctor can accept/reject.

export type IncomingReferralStatus =
  | 'incoming'          // newly received, awaiting this doctor's decision
  | 'accepted'          // this doctor accepted the case
  | 'rejected'          // this doctor declined the case
  | 'completed';        // care provided, case closed

export interface IncomingReferral {
  id:           string;
  ref:          string;         // e.g. "REF-9F2A41"
  patient:      PatientSummary;
  fromDoctor:   string;         // referring doctor name
  fromHospital?: string;
  specialty:    string;         // specialty requested
  reason:       string;
  urgency:      SpecialistReferral['urgency']; // reuse 'routine' | 'urgent'
  status:       IncomingReferralStatus;
  attachments:  ReferralAttachment[];          // reuse Phase 2 attachment shape
  receivedAt:   string;         // ISO datetime
  decidedAt?:   string;         // ISO datetime
  rejectionReason?: string;
}

// ─── P.2 Opinion request (specialist opinion / second opinion) ───────────────

export type OpinionKind = 'specialist' | 'second';

export type OpinionStatus = 'requested' | 'responded' | 'declined';

export interface OpinionRequest {
  id:           string;
  ref:          string;         // e.g. "OPN-5A8E07"
  patient:      PatientSummary;
  kind:         OpinionKind;    // specialist vs second opinion
  specialist:   Specialist;     // reuse Phase 2 Specialist
  question:     string;         // the clinical question posed
  attachments:  ReferralAttachment[];
  status:       OpinionStatus;
  response?:    string;         // specialist's opinion, when responded
  requestedAt:  string;         // ISO datetime
  respondedAt?: string;         // ISO datetime
}

// ─── P.3 Care-team chat ──────────────────────────────────────────────────────
// Lightweight multi-clinician thread (NOT the patient-facing consult chat).

export interface CareTeamMessage {
  id:          string;
  threadId:    string;          // care-team thread (per patient / case)
  authorId:    string;          // clinician id
  authorName:  string;          // "Dr. Emeka Nwosu"
  authorRole:  string;          // "Cardiologist", "Attending"
  body:        string;
  createdAt:   string;          // ISO datetime
}

export interface CareTeamThread {
  threadId:    string;
  patient:     PatientSummary;
  caseRef:     string;          // referral / case ref the team is discussing
  members:     { id: string; name: string; role: string }[];
  messages:    CareTeamMessage[];
}

// ─── P.4 Shared case summary (composed from notes / labs / rx) ───────────────

export interface SharedCaseSummary {
  caseRef:       string;
  patient:       PatientSummary;
  summary:       string;        // narrative case summary
  diagnoses:     string[];      // active diagnoses
  notes:         SoapNote[];          // reuse Phase 1/2 SoapNote
  prescriptions: DoctorPrescription[]; // reuse Phase 1/2 prescription
  labResults:    LabResult[];          // reuse Phase 1/2 lab result
  sharedWith:    string[];      // clinician names the summary is shared with
  updatedAt:     string;        // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// Section Q — Follow-Up Care (15 entries)
// REUSE: FollowUpPlan, FollowUpKind, FollowUpStatus, createFollowUp,
// reviewFollowUpRequest, useFollowUps. ADD eligibility, long-term care plan,
// chronic monitoring, medication adherence. completed/missed are STATES on
// FollowUpStatus (we extend the demo data; the union already has 'completed').
// ═══════════════════════════════════════════════════════════════════════════

// ─── Q.1 Follow-up eligibility (free vs paid, window) ────────────────────────

export interface FollowUpEligibility {
  patientId:        string;
  appointmentId?:   string;
  freeEligible:     boolean;    // within the free follow-up window
  windowDays:       number;     // configured free-follow-up window
  daysSinceConsult: number;     // days since the originating consult
  suggestedKind:    FollowUpKind; // 'free' when eligible, else 'paid'
  paidFeeKobo:      number;      // fee charged when paid
  reason:           string;      // why free / why paid
}

// ─── Q.2 Long-term care plan + milestones ────────────────────────────────────

export type CarePlanMilestoneStatus = 'upcoming' | 'due' | 'completed' | 'missed';

export interface CarePlanMilestone {
  id:          string;
  title:       string;          // "Quarterly HbA1c review"
  dueDate:     string;          // ISO date
  status:      CarePlanMilestoneStatus;
  note?:       string;
  completedAt?: string;         // ISO datetime
}

export interface LongTermCarePlan {
  id:           string;
  ref:          string;         // e.g. "LTC-4F2A41"
  patient:      PatientSummary;
  condition:    string;         // "Type 2 Diabetes Mellitus"
  goal:         string;         // "HbA1c < 7%"
  startedAt:    string;         // ISO date
  reviewEvery:  string;         // "3 months"
  milestones:   CarePlanMilestone[];
  active:       boolean;
}

// ─── Q.3 Chronic condition monitoring entry ──────────────────────────────────

export type ChronicTrend = 'improving' | 'stable' | 'worsening';

export interface ChronicMonitoringEntry {
  id:          string;
  patient:     PatientSummary;
  condition:   string;          // "Hypertension"
  metric:      string;          // "Blood Pressure"
  value:       string;          // "132/84 mmHg"
  recordedAt:  string;          // ISO datetime
  trend:       ChronicTrend;
  withinTarget: boolean;
  note?:       string;
}

// ─── Q.4 Medication adherence check ──────────────────────────────────────────

export type AdherenceLevel = 'good' | 'partial' | 'poor';

export interface MedicationAdherenceCheck {
  id:           string;
  patient:      PatientSummary;
  prescriptionRef: string;      // RX ref being checked
  drugSummary:  string;         // "Metformin 500mg BD"
  level:        AdherenceLevel;
  missedDoses:  number;         // self-reported missed doses in the period
  periodLabel:  string;         // "Last 30 days"
  recordedAt:   string;         // ISO datetime
  note?:        string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Section R — Emergency & Escalation (10 entries)
// DEMO + clearly non-actionable (no real dialing). REUSE the RedFlagWarning
// concept from Batch 2 for red-flag alerts. ADD facilities, escalation,
// emergency case record + disclaimer constant.
// ═══════════════════════════════════════════════════════════════════════════

// ─── R.1 Emergency facility (hospital / ambulance) ───────────────────────────

export type EmergencyFacilityKind = 'hospital' | 'ambulance' | 'emergency_service';

export interface EmergencyFacility {
  id:          string;
  kind:        EmergencyFacilityKind;
  name:        string;          // "Lagoon Emergency Centre"
  distanceKm:  number;          // distance from patient (demo)
  etaMins:     number;          // estimated arrival / travel time (demo)
  contact:     string;          // DEMO contact string — non-dialable
  address:     string;
  open24h:     boolean;
}

// ─── R.2 Red-flag alert ──────────────────────────────────────────────────────
// Reuse the Batch 2 RedFlagWarning shape as the alert payload; add a list type
// alias for clarity at the call site.

export interface RedFlagAlert extends RedFlagWarning {
  detectedAt: string;           // ISO datetime the symptom was flagged
}

// ─── R.3 Emergency escalation ────────────────────────────────────────────────
// Granular targets (hospital / ambulance / emergency contact) are KINDS on one
// escalation entity; lifecycle steps are STATES.

export type EscalationKind = 'hospital' | 'ambulance' | 'emergency_contact';

export type EscalationStatus =
  | 'initiated'        // escalation started (demo)
  | 'notified'         // target notified (demo)
  | 'acknowledged'     // target acknowledged (demo)
  | 'cancelled';

export interface EmergencyEscalation {
  id:          string;
  ref:         string;          // e.g. "ESC-7C1B88"
  patient:     PatientSummary;
  kind:        EscalationKind;
  targetName:  string;          // facility / contact name
  status:      EscalationStatus;
  reason:      string;          // clinical reason for escalation
  facilityId?: string;          // links to EmergencyFacility when relevant
  initiatedAt: string;          // ISO datetime
  updatedAt:   string;          // ISO datetime
  note?:       string;
}

// ─── R.4 Emergency case record (documentation) ───────────────────────────────

export interface EmergencyCaseRecord {
  id:           string;
  ref:          string;         // e.g. "EMR-5A8E07"
  patient:      PatientSummary;
  presentedAt:  string;         // ISO datetime
  redFlags:     RedFlagAlert[]; // symptoms that triggered the emergency
  actionsTaken: string;         // free-text documentation
  escalations:  EmergencyEscalation[];
  recommendedFacility?: EmergencyFacility;
  contactNotified: boolean;     // emergency contact informed
  followUpScheduled: boolean;   // emergency follow-up arranged
  disclaimerAcknowledged: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mutation inputs / results
// `idempotencyKey` is required on every state-changing / money mutation. Hooks
// generate it; callers pass `Omit<Input, 'idempotencyKey'>`.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Section O mutations ──────────────────────────────────────────────────────

export interface RequestPreAuthInput {
  appointmentId?: string;
  patientId:      string;
  provider:       string;
  service:        string;
  estimatedKobo:  number;
  note?:          string;
  idempotencyKey: string;
}

export interface RequestPreAuthResult {
  preAuthId: string;
  ref:       string;
  status:    PreAuthStatus;
}

export interface SendHmoSupportMessageInput {
  threadId:       string;
  body:           string;
  idempotencyKey: string;
}

export interface SendHmoSupportMessageResult {
  message: HmoSupportMessage;
}

export interface AcknowledgeFraudWarningInput {
  warningId:      string;
  idempotencyKey: string;
}

export interface AcknowledgeFraudWarningResult {
  warningId:    string;
  acknowledged: boolean;
}

// ─── Section P mutations ──────────────────────────────────────────────────────

export interface AcceptReferralInput {
  referralId:     string;
  note?:          string;
  idempotencyKey: string;
}

export interface AcceptReferralResult {
  referralId: string;
  status:     IncomingReferralStatus;
}

export interface RejectReferralInput {
  referralId:     string;
  rejectionReason: string;
  idempotencyKey: string;
}

export interface RejectReferralResult {
  referralId: string;
  status:     IncomingReferralStatus;
}

export interface RequestOpinionInput {
  patientId:      string;
  specialistId:   string;
  kind:           OpinionKind;
  question:       string;
  attachments:    ReferralAttachment[];
  idempotencyKey: string;
}

export interface RequestOpinionResult {
  opinionId: string;
  ref:       string;
  status:    OpinionStatus;
}

export interface SendCareTeamMessageInput {
  threadId:       string;
  body:           string;
  idempotencyKey: string;
}

export interface SendCareTeamMessageResult {
  message: CareTeamMessage;
}

// ─── Section Q mutations ──────────────────────────────────────────────────────

export interface SetFollowUpReminderInput {
  followUpId:     string;
  remindAt:       string;        // ISO datetime
  idempotencyKey: string;
}

export interface SetFollowUpReminderResult {
  followUpId: string;
  remindAt:   string;
}

export interface CompleteFollowUpInput {
  followUpId:     string;
  outcomeNote?:   string;
  missed?:        boolean;        // true marks the follow-up as missed
  idempotencyKey: string;
}

export interface CompleteFollowUpResult {
  followUpId: string;
  status:     'completed' | 'missed';  // base FollowUpStatus has no 'missed'
}

export interface RecordAdherenceCheckInput {
  patientId:       string;
  prescriptionRef: string;
  level:           AdherenceLevel;
  missedDoses:     number;
  periodLabel:     string;
  note?:           string;
  idempotencyKey:  string;
}

export interface RecordAdherenceCheckResult {
  checkId: string;
  level:   AdherenceLevel;
}

export interface SaveCarePlanInput {
  patientId:      string;
  condition:      string;
  goal:           string;
  reviewEvery:    string;
  milestones:     { title: string; dueDate: string }[];
  idempotencyKey: string;
}

export interface SaveCarePlanResult {
  carePlanId: string;
  ref:        string;
  active:     boolean;
}

// ─── Section R mutations (DEMO — non-actionable) ─────────────────────────────

export interface EscalateInput {
  patientId:      string;
  facilityId?:    string;
  reason:         string;
  note?:          string;
  idempotencyKey: string;
}

export interface EscalateResult {
  escalationId: string;
  ref:          string;
  kind:         EscalationKind;
  status:       EscalationStatus;
}

export interface NotifyEmergencyContactInput {
  patientId:      string;
  message:        string;
  idempotencyKey: string;
}

export interface NotifyEmergencyContactResult {
  patientId: string;
  notified:  boolean;
}

export interface DocumentEmergencyCaseInput {
  patientId:      string;
  redFlagIds:     string[];
  actionsTaken:   string;
  recommendedFacilityId?: string;
  idempotencyKey: string;
}

export interface DocumentEmergencyCaseResult {
  caseId: string;
  ref:    string;
}

export interface ScheduleEmergencyFollowUpInput {
  patientId:      string;
  caseId:         string;
  dueDate:        string;        // ISO date
  reason:         string;
  idempotencyKey: string;
}

export interface ScheduleEmergencyFollowUpResult {
  followUpId: string;
  ref:        string;
  status:     FollowUpStatus;
}
