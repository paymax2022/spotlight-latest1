// Privacy & Audit · Settings · Empty/Error/Edge-State. This is the FINAL C–AD
// batch and is CONSOLIDATED + heavy REUSE. Phase 1 / Phase 2 / Section B /
// Batch 6 shapes are imported and re-exported, NEVER duplicated. Money amounts
// are integers in minor units (kobo). Use `import type` for type-only imports.
// Sections:
//   AA — Support & Dispute: REUSE SupportTicket / SupportTicketStatus (Phase 1)
//        for the help-centre ticket list / status / resolved screens, and the
//        Phase 1 ChatMessage shape for the support chat thread. ADD FAQs / help
//        articles, a `Dispute` union (consultation/payment/pharmacy/lab/HMO/
//        prescription/call-failure/patient-complaint), evidence attachments and
//        a lightweight `SupportMessage`.
//   AB — Compliance, Privacy & Audit: REUSE ComplianceDashboard / LicenceInfo /
//        ConsentRecord / ComplianceAuditEntry / ComplianceAlert /
//        PolicyAcknowledgement (Phase 2). ADD data-privacy settings, scoped
//        audit trails, mandatory training, a safety-issue report and an
//        account-review notice.
//   AC — Settings: REUSE DoctorSettings (Phase 1, extended additively), the
//        Batch 6 NotificationPreference rows and the Section B BankAccount. ADD
//        security settings, device/session management, app preferences, change-
//        password input and a two-factor setup descriptor.
//   AD — Empty / Error / Edge-State: a small data layer of edge-state
//        descriptors, an app-status read and account-status reads. Most of these
//        only adds the descriptor map + a pure `getEdgeState` helper (in the api
//        file) so screens render consistent edge content.

import type {
  SupportTicket,
  SupportTicketStatus,
  ChatMessage,
  ChatAuthor,
  DoctorSettings,
  VerificationStatus,
} from '@/types/doctor';
import type {
  ComplianceDashboard,
  LicenceInfo,
  LicenceStatus,
  ConsentRecord,
  ComplianceAuditEntry,
  ComplianceAuditAction,
  ComplianceAlert,
  ComplianceAlertSeverity,
  PolicyAcknowledgement,
} from '@/types/doctor.phase2';
import type {
  NotificationPreference,
  NotificationCategory,
} from '@/types/doctor.batch6';
import type { BankAccount } from '@/types/doctor.profile';

// everything it needs from one import site.
export type {
  SupportTicket,
  SupportTicketStatus,
  ChatMessage,
  ChatAuthor,
  DoctorSettings,
  VerificationStatus,
} from '@/types/doctor';
export type {
  ComplianceDashboard,
  LicenceInfo,
  LicenceStatus,
  ConsentRecord,
  ComplianceAuditEntry,
  ComplianceAuditAction,
  ComplianceAlert,
  ComplianceAlertSeverity,
  PolicyAcknowledgement,
} from '@/types/doctor.phase2';
export type {
  NotificationPreference,
  NotificationCategory,
} from '@/types/doctor.batch6';
export type { BankAccount } from '@/types/doctor.profile';

// SECTION AA — SUPPORT & DISPUTE (18)
// REUSES SupportTicket / SupportTicketStatus for the ticket list / ticket
// status / resolved-ticket screens, and the Phase 1 ChatMessage shape for the
// support chat thread. The eight dispute sub-screens (consultation / payment /
// pharmacy / lab / HMO / prescription / call-failure / patient-complaint) are
// KINDS of one `Dispute`, not eight shapes. ADD: FAQs, help articles, the
// dispute union, evidence attachments and a lightweight support message.

export type FaqCategory =
  | 'getting_started'
  | 'consultations'
  | 'prescriptions'
  | 'payments_payouts'
  | 'verification'
  | 'technical'
  | 'account';

export interface FaqItem {
  id:        string;
  category:  FaqCategory;
  question:  string;
  answer:    string;
  helpful?:  number;             // upvote count (display only)
}

export interface HelpArticle {
  id:        string;
  category:  FaqCategory;
  title:     string;
  summary:   string;
  body:      string;             // markdown-lite body
  readMins:  number;
  updatedAt: string;             // ISO datetime
}

export type DisputeKind =
  | 'consultation'
  | 'payment'
  | 'pharmacy'
  | 'lab'
  | 'hmo'
  | 'prescription'
  | 'call_failure'
  | 'patient_complaint';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'awaiting_response'
  | 'resolved'
  | 'rejected';

// Evidence attachment uploaded against a dispute / support ticket.
export type EvidenceKind = 'image' | 'document' | 'screenshot' | 'log' | 'video';

export interface EvidenceAttachment {
  id:         string;
  kind:       EvidenceKind;
  fileName:   string;
  sizeBytes:  number;
  url?:       string;            // Phase C: signed URL
  uploadedAt: string;           // ISO datetime
}

export interface Dispute {
  id:           string;
  ref:          string;          // e.g. "DPT-2026-031"
  kind:         DisputeKind;
  subject:      string;
  description:  string;
  status:       DisputeStatus;
  // Loosely linked references — only the relevant one is populated per kind.
  consultRef?:  string;          // consultation / call-failure
  paymentRef?:  string;          // payment / payout
  pharmacyRef?: string;          // pharmacy fulfilment
  labRef?:      string;          // lab order
  hmoClaimRef?: string;          // HMO claim
  prescriptionRef?: string;      // prescription
  patientId?:   string;          // patient-complaint
  patientName?: string;
  amountKobo?:  number;          // disputed amount (payment / HMO), kobo
  evidence:     EvidenceAttachment[];
  createdAt:    string;          // ISO datetime
  updatedAt:    string;          // ISO datetime
  resolvedAt?:  string;          // ISO datetime
  resolutionNote?: string;
}

export type SupportMessageAuthor = ChatAuthor | 'agent' | 'system';

export interface SupportMessage {
  id:          string;
  threadId:    string;           // ticket id or dispute id
  author:      SupportMessageAuthor;
  body:        string;
  createdAt:   string;           // ISO datetime
  attachment?: EvidenceAttachment;
}

// SECTION AB — COMPLIANCE, PRIVACY & AUDIT (16)
// REUSES ComplianceDashboard / LicenceInfo / ConsentRecord /
// ComplianceAuditEntry / ComplianceAlert / PolicyAcknowledgement (Phase 2). The
// compliance-dashboard, medical-/vet-licence-status, patient-consent-history,
// access-log, suspicious-activity-alert, compliance-warning and policy-update
// screens are all VIEWS over those shapes. ADD: data-privacy settings, scoped
// audit trails, mandatory training, a safety-issue report and an account-review
// notice.

export interface VetLicenceInfo extends LicenceInfo {
  councilName:   string;         // e.g. "Veterinary Council of Nigeria (VCN)"
  vcnNumber:     string;         // vet registration number
}

export interface DataSharingPreference {
  key:       string;             // "research", "analytics", "partner_hmo"
  label:     string;
  enabled:   boolean;
  locked?:   boolean;            // mandated by policy, cannot be toggled
}

export type DataRequestStatus = 'none' | 'requested' | 'processing' | 'ready' | 'completed' | 'rejected';

export interface DataPrivacySettings {
  sharingPreferences: DataSharingPreference[];
  exportStatus:       DataRequestStatus;
  exportRequestedAt?: string;    // ISO datetime
  exportReadyUrl?:    string;    // Phase C: signed download URL
  deletionStatus:     DataRequestStatus;
  deletionRequestedAt?: string;  // ISO datetime
}

export type AuditScope = 'prescription' | 'consultation' | 'lab' | 'hmo';

// An audit-trail row composes the Phase 2 ComplianceAuditEntry with a scope and
// an optional patient/ref so the per-scope screens can filter without redefining
// the entry shape.
export interface AuditTrailEntry extends ComplianceAuditEntry {
  scope:        AuditScope;
  ref?:         string;          // e.g. "RX-9F2A41", "TM-9F2A41"
  patientName?: string;
}

export interface AuditTrail {
  scope:      AuditScope;
  entries:    AuditTrailEntry[];
  updatedAt:  string;            // ISO datetime
}

export type TrainingStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';

export interface TrainingModule {
  id:           string;
  title:        string;          // "Data Protection & Patient Privacy 2026"
  summary:      string;
  status:       TrainingStatus;
  required:     boolean;
  durationMins: number;
  dueAt?:       string;          // ISO date
  completedAt?: string;          // ISO datetime
}

export interface MandatoryTraining {
  modules:        TrainingModule[];
  completedCount: number;
  totalRequired:  number;
  nextDueAt?:     string;        // ISO date of the soonest required module
}

// ─── AB.5 Safety-issue report (report medical safety issue) ──────────────────
export type SafetyIssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SafetyIssueCategory =
  | 'adverse_drug_reaction'
  | 'device_malfunction'
  | 'misdiagnosis_risk'
  | 'data_breach'
  | 'patient_harm'
  | 'other';
export type SafetyIssueStatus = 'submitted' | 'acknowledged' | 'investigating' | 'closed';

export interface SafetyIssueReport {
  id:          string;
  ref:         string;           // e.g. "SAF-2026-009"
  category:    SafetyIssueCategory;
  severity:    SafetyIssueSeverity;
  description: string;
  patientId?:  string;
  status:      SafetyIssueStatus;
  reportedAt:  string;           // ISO datetime
}

export type AccountReviewReason =
  | 'routine_audit'
  | 'licence_verification'
  | 'patient_report'
  | 'suspicious_activity'
  | 'policy_violation';

export interface AccountReviewNotice {
  id:              string;
  reason:          AccountReviewReason;
  title:           string;
  message:         string;
  restrictsPractice: boolean;
  openedAt:        string;       // ISO datetime
  expectedBy?:     string;       // ISO date
  contactRoute?:   string;       // expo-router path to support / appeal
}

// SECTION AC — SETTINGS (16)
// REUSES DoctorSettings (Phase 1) for the profile/notification/availability
// toggles, the Batch 6 NotificationPreference rows for the notification-settings
// screen and the Section B BankAccount for the edit-bank-account screen. The
// edit-professional-profile / edit-pricing / edit-availability / edit-bank
// screens REUSE existing Section B / Phase 1 profile mutations. ADD: security
// settings, devices, app preferences, change-password input and a 2FA setup.

// ─── AC.1 Security settings (biometric, 2FA, last password change) ───────────
export type TwoFactorMethod = 'none' | 'authenticator' | 'sms' | 'email';

export interface SecuritySettings {
  biometricEnabled:    boolean;
  biometricType?:      'face' | 'fingerprint'; // device-reported
  twoFactorEnabled:    boolean;
  twoFactorMethod:     TwoFactorMethod;
  lastPasswordChange?: string;   // ISO datetime
  pinEnabled:          boolean;  // app-open PIN lock
}

export interface TwoFactorSetup {
  method:       TwoFactorMethod;
  secret?:      string;          // authenticator shared secret (otpauth)
  otpauthUrl?:  string;          // QR payload for authenticator apps
  maskedTarget?: string;         // "****1234" for sms / "a***@x.com" for email
  recoveryCodes?: string[];      // shown once at enrolment
}

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface Device {
  id:           string;
  label:        string;          // "iPhone 15 Pro", "Chrome on macOS"
  platform:     DevicePlatform;
  lastActiveAt: string;          // ISO datetime
  location?:    string;          // "Lagos, NG"
  current:      boolean;         // the device making this request
  trusted:      boolean;
}

// Alias kept for screens that prefer the "session" vocabulary; identical shape.
export type DeviceSession = Device;

export type AppLanguage = 'en' | 'fr' | 'ha' | 'yo' | 'ig' | 'pcm';
export type AppTheme = 'system' | 'light' | 'dark';

export interface AppPreferences {
  language:        AppLanguage;
  theme:           AppTheme;
  reduceMotion:    boolean;
  hapticsEnabled:  boolean;
}

// SECTION AD — EMPTY, ERROR & EDGE-STATE (26)
// MOSTLY StateView variants already handled across existing screens. This batch
// adds a small data layer only: an `EdgeStateKind` enum, an `EDGE_STATES`
// descriptor map (title/message/icon/cta/tone per kind), an `AppStatus`
// (maintenance / app-update-required / min-version) read and `AccountStatus`
// reads. A pure `getEdgeState(kind)` helper lives in the api file.

export type EdgeStateKind =
  // empty states
  | 'no_appointments'
  | 'no_messages'
  | 'no_prescriptions'
  | 'no_lab_results'
  | 'no_earnings'
  | 'no_reviews'
  // connectivity / server
  | 'no_internet'
  | 'server_error'
  | 'session_expired'
  // permissions
  | 'camera_permission_denied'
  | 'microphone_permission_denied'
  | 'file_upload_failed'
  // consultation / call edge cases
  | 'patient_unavailable'
  | 'patient_cancelled'
  | 'call_connection_failed'
  | 'videosdk_unavailable'
  // clinical edge cases
  | 'prescription_blocked'
  | 'drug_interaction_detected'
  | 'lab_order_blocked'
  | 'hmo_verification_failed'
  // account / platform
  | 'account_verification_pending'
  | 'licence_expired'
  | 'access_denied'
  | 'maintenance_mode'
  | 'app_update_required';

export type EdgeStateTone = 'neutral' | 'info' | 'warning' | 'error';

// The StateView variant a kind maps to (empty vs error). Loading is never an
// edge descriptor — it is transient.
export type EdgeStateVariant = 'empty' | 'error';

export interface EdgeStateCta {
  label: string;
  // Action hint the screen interprets: a router path OR a known imperative.
  action: 'retry' | 'refresh' | 'login' | 'open_settings' | 'update_app' | 'contact_support' | 'go_back' | string;
  route?: string;                // expo-router path when action is navigation
}

export interface EdgeStateDescriptor {
  kind:     EdgeStateKind;
  variant:  EdgeStateVariant;
  tone:     EdgeStateTone;
  icon:     string;              // Ionicons-style name
  title:    string;
  message:  string;
  cta?:     EdgeStateCta;
  secondaryCta?: EdgeStateCta;
}

export type AppStatusMode = 'ok' | 'maintenance' | 'app_update_required';

export interface AppStatus {
  mode:           AppStatusMode;
  minVersion:     string;        // semver, e.g. "2.4.0"
  currentVersion: string;        // the running build's version
  updateUrl?:     string;        // store URL when an update is required
  message?:       string;        // banner copy for maintenance / update
  maintenanceUntil?: string;     // ISO datetime
}

// REUSES the Phase 1 VerificationStatus vocabulary and extends it with the
// post-approval review/suspension states the signup/pending + account screens
// need.
export type AccountState = VerificationStatus | 'under_review' | 'suspended';

export interface AccountStatus {
  state:        AccountState;
  canPractise:  boolean;         // gate for taking consults
  title:        string;
  message:      string;
  reviewNotice?: AccountReviewNotice; // present when state === 'under_review'
  updatedAt:    string;          // ISO datetime
}

// MUTATION INPUTS / RESULTS
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

export interface CreateDisputeInput {
  kind:           DisputeKind;
  subject:        string;
  description:    string;
  consultRef?:    string;
  paymentRef?:    string;
  pharmacyRef?:   string;
  labRef?:        string;
  hmoClaimRef?:   string;
  prescriptionRef?: string;
  patientId?:     string;
  amountKobo?:    number;         // disputed amount, kobo
  idempotencyKey: string;
}

export interface CreateDisputeResult {
  disputeId: string;
  ref:       string;
  status:    DisputeStatus;
}

export interface UploadDisputeEvidenceInput {
  disputeId:      string;
  kind:           EvidenceKind;
  fileName:       string;
  sizeBytes:      number;
  idempotencyKey: string;
}

export interface UploadDisputeEvidenceResult {
  attachment: EvidenceAttachment;
}

export interface SendSupportMessageInput {
  threadId:       string;        // ticket id or dispute id
  body:           string;
  attachmentId?:  string;        // previously uploaded evidence id
  idempotencyKey: string;
}

export interface SendSupportMessageResult {
  message: SupportMessage;
}

export interface UpdatePrivacySettingsInput {
  sharingPreferences: DataSharingPreference[];
  idempotencyKey:     string;
}

export interface UpdatePrivacySettingsResult {
  settings: DataPrivacySettings;
}

export interface CompleteTrainingModuleInput {
  moduleId:       string;
  idempotencyKey: string;
}

export interface CompleteTrainingModuleResult {
  moduleId: string;
  status:   TrainingStatus;
}

export interface ReportSafetyIssueInput {
  category:       SafetyIssueCategory;
  severity:       SafetyIssueSeverity;
  description:    string;
  patientId?:     string;
  idempotencyKey: string;
}

export interface ReportSafetyIssueResult {
  reportId: string;
  ref:      string;
  status:   SafetyIssueStatus;
}

export interface RequestDataExportInput {
  idempotencyKey: string;
}

export interface RequestDataExportResult {
  status: DataRequestStatus;
}

export interface RequestAccountDeletionInput {
  reason?:        string;
  idempotencyKey: string;
}

export interface RequestAccountDeletionResult {
  status: DataRequestStatus;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword:     string;
  idempotencyKey:  string;
}

export interface ChangePasswordResult {
  changed:          boolean;
  lastPasswordChange: string;    // ISO datetime
}

export interface SetBiometricInput {
  enabled:        boolean;
  idempotencyKey: string;
}

export interface SetBiometricResult {
  biometricEnabled: boolean;
}

export interface SetTwoFactorInput {
  enabled:        boolean;
  method:         TwoFactorMethod;
  code?:          string;        // verification code when enabling
  idempotencyKey: string;
}

export interface SetTwoFactorResult {
  twoFactorEnabled: boolean;
  twoFactorMethod:  TwoFactorMethod;
  setup?:           TwoFactorSetup; // returned when enrolment is starting
}

export interface RevokeDeviceInput {
  deviceId:       string;
  idempotencyKey: string;
}

export interface RevokeDeviceResult {
  deviceId: string;
  revoked:  boolean;
}

export interface UpdateAppPreferencesInput {
  preferences:    Partial<AppPreferences>;
  idempotencyKey: string;
}

export interface UpdateAppPreferencesResult {
  preferences: AppPreferences;
}

export interface LogoutInput {
  allDevices?:    boolean;
  idempotencyKey: string;
}

export interface LogoutResult {
  loggedOut: boolean;
}

// the app/account status reads, handled by query invalidation in the hooks.
