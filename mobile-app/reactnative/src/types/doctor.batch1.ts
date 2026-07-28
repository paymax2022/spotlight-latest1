// ── Doctor (Telemedicine, provider-side) — Batch 1 Domain Types ──────────────
// Batch 1 = spec sections C, D, E, F. ADDITIVE to `@/types/doctor`,
// `@/types/doctor.phase2`, `@/types/doctor.profile` and `@/types/doctor.phase3`
// — those shapes are imported/reused, never duplicated. Money amounts are
// integers in minor units (kobo). Use `import type` for type-only imports.
//
// APPROACH IS CONSOLIDATED: action/state variants (accept/reject, empty/error,
// confirmation steps, countdown) are modelled as states/data, not as separate
// entities, so the Frontend can render variants from the same shapes.
//
// Sections:
//   C — Veterinary Doctor Profile & Verification (vet equivalent of Section B).
//   D — Doctor Dashboard (aggregate + alerts + announcements).
//   E — Availability & Schedule Management (extends AvailabilitySchedule).
//   F — Appointment & Consultation Queue (extends DoctorAppointment).

import type {
  VerificationStatus,
  AvailabilitySchedule,
  WorkingDay,
  ScheduleBreak,
  DoctorAppointment,
  ConsultStatus,
  ConsultType,
  EarningsSummary,
} from '@/types/doctor';
import type { LicenceStatus } from '@/types/doctor.phase2';
import type {
  PersonalInfo,
  ClinicAffiliation,
  WorkExperienceEntry,
  ConsultationPricing,
  ProfileLicenceInfo,
  UploadedFile,
  ProfileDocumentSlot,
  VerificationDecision,
  LicenceExpiryWarning,
  LicenceRenewal,
} from '@/types/doctor.profile';
import type { PetSpecies } from '@/types/doctor.phase3';

// Re-export the primitives Batch 1 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  VerificationStatus,
  AvailabilitySchedule,
  WorkingDay,
  ScheduleBreak,
  DoctorAppointment,
  ConsultStatus,
  ConsultType,
  EarningsSummary,
} from '@/types/doctor';
export type { LicenceStatus } from '@/types/doctor.phase2';
export type {
  PersonalInfo,
  ClinicAffiliation,
  WorkExperienceEntry,
  ConsultationPricing,
  ProfileLicenceInfo,
  UploadedFile,
  ProfileDocumentSlot,
  VerificationDecision,
  LicenceExpiryWarning,
  LicenceRenewal,
} from '@/types/doctor.profile';
export type { PetSpecies } from '@/types/doctor.phase3';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION C — VETERINARY DOCTOR PROFILE & VERIFICATION (17)
// ═══════════════════════════════════════════════════════════════════════════
// Vet equivalent of Section B's profile builder + verification lifecycle. Reuses
// the Section B builder primitives (PersonalInfo, ClinicAffiliation,
// WorkExperienceEntry, ConsultationPricing, ProfileLicenceInfo, UploadedFile,
// ProfileDocumentSlot) and adds the vet-specific fields: species
// specialisations + the veterinary licence body.

// The veterinary licensing body (vs the human MDCN). Kept as an open string-ish
// union so the Frontend can drive a picker from `VET_LICENCE_BODIES`.
export type VetLicenceBody =
  | 'VCN'        // Veterinary Council of Nigeria
  | 'other';

// Editable veterinary licence metadata — the vet analogue of Section B's
// `ProfileLicenceInfo`. Distinct shape (the issuing body differs) so it does not
// collide with the human builder's licence type.
export interface VetLicenceInfo {
  licenceNumber: string;          // VCN registration number, e.g. "VCN/R/0184"
  issuingBody:   VetLicenceBody;  // "VCN"
  issuedAt?:     string;          // ISO date
  expiresAt?:    string;          // ISO date
  status?:       LicenceStatus;   // reuse Phase 2 LicenceStatus union
  licenceFile?:  UploadedFile;    // uploaded licence document
}

// Vet profile builder steps (the consolidated 17-screen flow for Section C).
export type VetProfileBuilderStep =
  | 'personal_info'        // vet personal info
  | 'specialty'            // vet specialty selection
  | 'species'              // pet species specialisation
  | 'licence_number'       // veterinary licence entry
  | 'licence_upload'       // veterinary licence upload
  | 'certificates'         // vet certificates upload
  | 'affiliations'         // vet clinic affiliation
  | 'experience'           // vet experience history
  | 'pricing'              // vet consultation pricing (kobo)
  | 'availability';        // vet availability (reuse AvailabilitySchedule)

// The in-progress veterinary profile draft. Mirrors Section B's
// `DoctorProfileDraft` but trimmed to the vet-relevant steps + species/vet-body.
export interface VetProfileDraft {
  id:               string;             // draft id
  doctorId?:        string;             // linked account, when known
  personalInfo:     PersonalInfo;       // vet personal info
  bio:              string;             // professional bio
  specialtyId:      string;             // primary vet specialty
  subSpecialtyIds:  string[];           // vet sub-specialties — label ids
  speciesTreated:   PetSpecies[];       // pet species specialisation
  yearsExperience:  number;
  licence:          VetLicenceInfo;     // veterinary licence entry + upload
  documents:        ProfileDocumentSlot[]; // licence, ID, certificates, etc.
  certificates:     UploadedFile[];     // vet certificates upload
  affiliations:     ClinicAffiliation[];   // vet clinic affiliation
  workExperience:   WorkExperienceEntry[]; // vet experience history
  pricing:          ConsultationPricing;   // vet consultation pricing (kobo)
  completedSteps:   VetProfileBuilderStep[]; // drives the hub checklist
  status:           VerificationStatus;    // mirrors the submission lifecycle
  updatedAt:        string;                // ISO datetime
  isPublished:      boolean;               // live & discoverable
}

// Vet verification submission — the vet analogue of Section B's verification
// lifecycle (submitted / pending / approved / rejected). Reuses Phase 1
// `VerificationStatus` and Section B's `VerificationDecision` / document slots.
export interface VetVerificationSubmission {
  id:           string;
  draftId:      string;
  status:       VerificationStatus;  // submitted/pending → 'pending', etc.
  submittedAt?: string;              // ISO datetime
  reviewedAt?:  string;              // ISO datetime
  documents:    ProfileDocumentSlot[];
  decision?:    VerificationDecision; // present once approved/rejected
  notes?:       string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION D — DOCTOR DASHBOARD (21)
// ═══════════════════════════════════════════════════════════════════════════
// Consolidated as one `DoctorDashboardData` aggregate (counts + small lists) +
// a `DashboardAlert` union (severity, kind, cta) + `PlatformAnnouncement`.
// Reuses Phase 1 `DoctorAppointment` / `EarningsSummary`.

// Online / availability presence (online-offline + availability status widget).
export type DoctorPresence = 'online' | 'busy' | 'away' | 'offline';

// Kind of dashboard alert. Each maps to one of the Section D alert widgets so a
// single `DashboardAlert` row can represent any of them as data.
export type DashboardAlertKind =
  | 'urgent_case'          // urgent case alert
  | 'compliance'           // compliance alert
  | 'profile_completion'   // profile-completion reminder
  | 'licence_expiry'       // licence-expiry alert
  | 'new_lab_result'       // new lab-results alert
  | 'hmo_approval'         // HMO approval alert
  | 'pending_prescription' // pending prescriptions
  | 'refill_request'       // refill requests
  | 'follow_up'            // follow-up requests
  | 'doctor_late';         // doctor-late warning

export type DashboardAlertSeverity = 'info' | 'warning' | 'critical';

// A single call-to-action attached to an alert (route is a logical hint; the
// Frontend owns the actual navigation target).
export interface DashboardAlertCta {
  label: string;                 // "Review", "Renew now"
  route: string;                 // logical route hint, e.g. "labResults"
}

export interface DashboardAlert {
  id:        string;
  kind:      DashboardAlertKind;
  severity:  DashboardAlertSeverity;
  title:     string;
  body:      string;
  count?:    number;             // badge count when the alert aggregates items
  createdAt: string;             // ISO datetime
  cta?:      DashboardAlertCta;
}

// Platform-wide announcement banner (maintenance, policy, feature).
export type AnnouncementTone = 'info' | 'success' | 'warning';

export interface PlatformAnnouncement {
  id:        string;
  tone:      AnnouncementTone;
  title:     string;
  body:      string;
  publishedAt: string;           // ISO datetime
  dismissible: boolean;
  ctaLabel?: string;
  ctaRoute?: string;             // logical route hint
}

// A compact patient-message summary surfaced on the dashboard (unread messages).
export interface DashboardMessagePreview {
  threadId:    string;
  patientName: string;
  initials:    string;
  avatarColor: string;           // hex used for avatar circle
  snippet:     string;
  at:          string;           // ISO datetime
  unread:      boolean;
}

// The active consultation card (one in-progress consult, when present).
export interface ActiveConsultationCard {
  appointmentId: string;
  ref:           string;
  patientName:   string;
  initials:      string;
  avatarColor:   string;         // hex used for avatar circle
  consultType:   ConsultType;
  startedAt:     string;         // ISO datetime
  elapsedSecs:   number;         // elapsed seconds since start
}

// One row in the waiting-room queue preview (full queue lives in Section F).
export interface WaitingRoomEntry {
  appointmentId: string;
  patientName:   string;
  initials:      string;
  avatarColor:   string;         // hex used for avatar circle
  consultType:   ConsultType;
  waitMins:      number;         // minutes the patient has been waiting
  isHmo:         boolean;
}

// Aggregate counts the dashboard tiles read from (one source of truth).
export interface DashboardCounts {
  todaysAppointments:   number;
  upcomingAppointments: number;
  pendingRequests:      number;  // pending consultation requests
  waitingRoom:          number;  // patients in the waiting room
  followUpRequests:     number;
  unreadMessages:       number;
  newLabResults:        number;
  pendingPrescriptions: number;
  refillRequests:       number;
  hmoApprovals:         number;  // pending HMO approvals
}

// The whole dashboard payload (Section D consolidated). Lists are kept small —
// the dashboard shows previews; full lists live on their dedicated screens.
export interface DoctorDashboardData {
  presence:           DoctorPresence;
  acceptsInstant:     boolean;              // availability status toggle
  counts:             DashboardCounts;
  todaysAppointments: DoctorAppointment[];  // today's + upcoming (preview)
  pendingRequests:    DoctorAppointment[];  // pending consultation requests
  activeConsultation?: ActiveConsultationCard; // present when a consult is live
  waitingRoom:        WaitingRoomEntry[];   // waiting-room queue preview
  messages:           DashboardMessagePreview[]; // unread patient messages
  alerts:             DashboardAlert[];     // urgent / compliance / licence / etc.
  announcement?:      PlatformAnnouncement; // platform announcement banner
  earnings:           EarningsSummary;      // earnings summary (reuse Phase 1)
  satisfactionPct:    number;               // patient satisfaction rating, 0–100
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION E — AVAILABILITY & SCHEDULE MANAGEMENT (17)
// ═══════════════════════════════════════════════════════════════════════════
// Extends `AvailabilitySchedule` ADDITIVELY via a new `ScheduleSettings` shape
// so the existing type (and `updateAvailability`) stays untouched. Adds blocked
// dates, vacation mode, reminders, recurring rules, timezone + an overbooking
// check result. The "saved confirmation" variant is a state of the save
// mutation, not a separate entity.

// A single blocked / unavailable date.
export interface BlockedDate {
  id:      string;
  date:    string;               // ISO date
  reason?: string;               // "Public holiday", "Conference"
  allDay:  boolean;              // false → partial-day block
  startTime?: string;            // "13:00" when !allDay
  endTime?:   string;            // "16:00" when !allDay
}

// A vacation / unavailable-mode period.
export interface VacationPeriod {
  id:        string;
  startDate: string;             // ISO date
  endDate:   string;             // ISO date
  note?:     string;             // shown to patients
  active:    boolean;            // vacation mode currently on
}

// Appointment reminder settings (how/when the doctor is reminded).
export interface ReminderSettings {
  enabled:       boolean;
  offsetsMins:   number[];       // e.g. [60, 15] — remind 60 & 15 mins before
  channelPush:   boolean;
  channelEmail:  boolean;
  channelSms:    boolean;
}

// Recurring availability rule (set a pattern that repeats weekly/biweekly).
export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface RecurringRule {
  id:         string;
  frequency:  RecurrenceFrequency;
  days:       WorkingDay['day'][];   // weekdays the pattern applies to
  startTime:  string;            // "09:00"
  endTime:    string;            // "17:00"
  startsOn:   string;            // ISO date the rule takes effect
  endsOn?:    string;            // ISO date the rule stops (undefined = open)
  active:     boolean;
}

// A selectable timezone option.
export interface TimezoneOption {
  value:  string;                // IANA id, "Africa/Lagos"
  label:  string;                // "West Africa Time (Lagos)"
  offset: string;                // "+01:00"
}

// The extended schedule model — wraps the existing `AvailabilitySchedule` and
// adds the Section E settings ADDITIVELY (existing type is never modified).
export interface ScheduleSettings {
  schedule:           AvailabilitySchedule;  // reuse Phase 1 working days/breaks
  appointmentOnly:    boolean;     // instant vs appointment-only availability
  emergencyAvailable: boolean;     // emergency availability toggle
  timezone:           string;      // IANA timezone id
  blockedDates:       BlockedDate[];
  vacation?:          VacationPeriod; // present when a vacation is configured
  reminders:          ReminderSettings;
  recurringRules:     RecurringRule[];
}

// Overbooking-check result (powers the overbooking warning). `safe` false means
// the requested change exceeds capacity for `date`.
export interface OverbookingCheck {
  date:          string;         // ISO date being checked
  capacity:      number;         // max slots for the day
  booked:        number;         // already-booked slots
  requested:     number;         // additional slots the change would add
  safe:          boolean;        // booked + requested <= capacity
  overBy:        number;         // how many over capacity (0 when safe)
  message:       string;         // human-readable warning copy
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION F — APPOINTMENT & CONSULTATION QUEUE (18)
// ═══════════════════════════════════════════════════════════════════════════
// Reuses Phase 1 `DoctorAppointment` + `ConsultStatus`. Accept/reject, missed/
// no-show, doctor-late and the countdown are modelled as states/data on top of
// the appointment, not as separate entities. Adds the queue item, the pending
// request, the appointment-billing detail and a countdown helper result.

// How an appointment is billed (HMO-covered vs paid vs free follow-up). Drives
// the consolidated appointment-detail variants from one field.
export type AppointmentBilling = 'hmo' | 'paid' | 'free_follow_up';

// Priority bucket for the consultation queue (priority queue).
export type QueuePriority = 'emergency' | 'high' | 'normal' | 'low';

// A single item in the consultation queue / priority queue / waiting room.
export interface ConsultationQueueItem {
  appointmentId: string;
  ref:           string;            // e.g. "TM-9F2A41"
  patientName:   string;
  initials:      string;
  avatarColor:   string;            // hex used for avatar circle
  consultType:   ConsultType;
  status:        ConsultStatus;     // reuse Phase 1 status union
  priority:      QueuePriority;
  billing:       AppointmentBilling;
  isHmo:         boolean;           // convenience flag (billing === 'hmo')
  waitMins:      number;            // minutes waiting in queue
  slotTime:      string;            // "09:00 AM"
  feeKobo:       number;            // consult fee in kobo (0 for free follow-up)
}

// A pending appointment request awaiting the doctor's accept/reject decision.
// The accept / reject / reschedule-request variants are states the Frontend
// renders from `status` — no separate request entities.
export type AppointmentRequestStatus = 'pending' | 'accepted' | 'rejected' | 'reschedule_requested';

export interface AppointmentRequest {
  id:             string;
  appointment:    DoctorAppointment;   // the underlying appointment (reuse Phase 1)
  status:         AppointmentRequestStatus;
  requestedAt:    string;              // ISO datetime
  billing:        AppointmentBilling;
  priority:       QueuePriority;
  patientNote?:   string;              // patient's note with the request
  rejectionReason?: string;            // present when status === 'rejected'
  proposedSlotDate?: string;           // present for reschedule_requested
  proposedSlotTime?: string;
}

// Consultation countdown result (drives the countdown + doctor-late warning as
// states). Produced by `computeConsultCountdown` in the API client.
export interface ConsultCountdown {
  appointmentId: string;
  slotAt:        string;         // ISO datetime of the slot
  minsUntil:     number;         // minutes until the slot (negative = overdue)
  isStartingSoon: boolean;       // within the "starting soon" window
  isOverdue:     boolean;        // slot time has passed and consult not started
  isDoctorLate:  boolean;        // overdue beyond the grace window (late warning)
  label:         string;         // "Starts in 5 min", "Overdue by 3 min"
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// ─── Section C — vet profile & verification ──────────────────────────────────

export interface SaveVetProfileDraftInput {
  draft:          Partial<VetProfileDraft>; // patch — merged into the draft
  idempotencyKey: string;
}

export interface SaveVetProfileDraftResult {
  draftId:   string;
  status:    VerificationStatus;
  updatedAt: string;
}

export interface SubmitVetVerificationInput {
  draftId:        string;
  idempotencyKey: string;
}

export interface SubmitVetVerificationResult {
  submissionId: string;
  status:       VerificationStatus;
}

export interface RenewVetLicenceInput {
  licenceNumber:  string;
  newExpiresAt:   string;        // ISO date
  uri:            string;        // local file URI of renewed licence
  fileName:       string;
  mimeType?:      string;
  idempotencyKey: string;
}

export interface RenewVetLicenceResult {
  renewalId: string;
  status:    VerificationStatus;
}

export interface PublishVetProfileInput {
  draftId:        string;
  idempotencyKey: string;
}

export interface PublishVetProfileResult {
  doctorId:    string;
  isPublished: boolean;
  publishedAt: string;           // ISO datetime
}

// ─── Section D — dashboard ───────────────────────────────────────────────────

export interface SetPresenceInput {
  presence:       DoctorPresence;
  idempotencyKey: string;
}

export interface SetPresenceResult {
  presence: DoctorPresence;
}

export interface DismissAnnouncementInput {
  announcementId: string;
  idempotencyKey: string;
}

export interface DismissAnnouncementResult {
  announcementId: string;
  dismissed:      boolean;
}

// ─── Section E — availability & schedule ─────────────────────────────────────

export interface BlockDateInput {
  date:           string;        // ISO date
  reason?:        string;
  allDay:         boolean;
  startTime?:     string;
  endTime?:       string;
  idempotencyKey: string;
}

export interface BlockDateResult {
  blocked: BlockedDate;
}

export interface SetVacationInput {
  startDate:      string;        // ISO date
  endDate:        string;        // ISO date
  note?:          string;
  active:         boolean;
  idempotencyKey: string;
}

export interface SetVacationResult {
  vacation: VacationPeriod;
}

export interface ToggleEmergencyInput {
  enabled:        boolean;
  idempotencyKey: string;
}

export interface ToggleEmergencyResult {
  emergencyAvailable: boolean;
}

export interface SaveReminderSettingsInput {
  reminders:      ReminderSettings;
  idempotencyKey: string;
}

export interface SaveReminderSettingsResult {
  reminders: ReminderSettings;
}

export interface SaveRecurringRuleInput {
  rule:           Omit<RecurringRule, 'id'> & { id?: string }; // id absent = create
  idempotencyKey: string;
}

export interface SaveRecurringRuleResult {
  rule: RecurringRule;
}

export interface SetTimezoneInput {
  timezone:       string;        // IANA id
  idempotencyKey: string;
}

export interface SetTimezoneResult {
  timezone: string;
}

// ─── Section F — appointment & consultation queue ────────────────────────────

export interface AcceptAppointmentInput {
  appointmentId:  string;
  idempotencyKey: string;
}

export interface AcceptAppointmentResult {
  appointmentId: string;
  status:        AppointmentRequestStatus;
}

export interface RejectAppointmentInput {
  appointmentId:  string;
  reason:         string;
  idempotencyKey: string;
}

export interface RejectAppointmentResult {
  appointmentId: string;
  status:        AppointmentRequestStatus;
}

export interface RequestRescheduleInput {
  appointmentId:  string;
  proposedSlotDate: string;      // ISO date
  proposedSlotTime: string;      // "10:30 AM"
  note?:          string;
  idempotencyKey: string;
}

export interface RequestRescheduleResult {
  appointmentId: string;
  status:        AppointmentRequestStatus;
}

// Reschedule an already-confirmed appointment (Section E reschedule action).
export interface RescheduleAppointmentInput {
  appointmentId:  string;
  newSlotDate:    string;        // ISO date
  newSlotTime:    string;        // "10:30 AM"
  idempotencyKey: string;
}

export interface RescheduleAppointmentResult {
  appointmentId: string;
  slotDate:      string;
  slotTime:      string;
}

export interface CancelAppointmentInput {
  appointmentId:  string;
  reason?:        string;
  idempotencyKey: string;
}

export interface CancelAppointmentResult {
  appointmentId: string;
  status:        ConsultStatus;
}

export interface StartConsultationInput {
  appointmentId:  string;
  idempotencyKey: string;
}

export interface StartConsultationResult {
  appointmentId: string;
  status:        ConsultStatus;  // → 'in_progress'
  startedAt:     string;         // ISO datetime
}

export interface EndConsultationInput {
  appointmentId:  string;
  idempotencyKey: string;
}

export interface EndConsultationResult {
  appointmentId: string;
  status:        ConsultStatus;  // → 'completed'
  endedAt:       string;         // ISO datetime
  durationSecs:  number;
}

export interface MarkNoShowInput {
  appointmentId:  string;
  idempotencyKey: string;
}

export interface MarkNoShowResult {
  appointmentId: string;
  status:        ConsultStatus;  // → 'cancelled' (no-show)
}
