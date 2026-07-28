// ── Doctor module — Batch 7 constants ────────────────────────────────────────
// Static option lists / label maps for Batch 7 (Sections AA · AB · AC · AD —
// Support & Dispute · Compliance/Privacy/Audit · Settings · Empty/Error/Edge).
// Pure data only — no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel).
//
// REUSE: SUPPORT_CATEGORIES already exists in the constants barrel; the
// compliance/licence labels live in Phase 2 constants; BankAccount lives in
// Section B. Here we add only the missing FAQ / dispute / audit-scope /
// language / theme / 2FA / edge-state maps used by the Batch 7 screens.

import type {
  FaqCategory,
  DisputeKind,
  DisputeStatus,
  EvidenceKind,
  AuditScope,
  TrainingStatus,
  SafetyIssueCategory,
  SafetyIssueSeverity,
  AccountReviewReason,
  TwoFactorMethod,
  DevicePlatform,
  AppLanguage,
  AppTheme,
  EdgeStateKind,
  EdgeStateTone,
  AppStatusMode,
  AccountState,
} from '@/types/doctor.batch7';

// ─── Section AA — support & dispute ──────────────────────────────────────────

export const FAQ_CATEGORY_LABELS: Record<FaqCategory, string> = {
  getting_started:  'Getting started',
  consultations:    'Consultations',
  prescriptions:    'Prescriptions',
  payments_payouts: 'Payments & payouts',
  verification:     'Verification',
  technical:        'Technical',
  account:          'Account',
};

// Ordered list for the help-centre category chips.
export const FAQ_CATEGORIES: FaqCategory[] = [
  'getting_started',
  'consultations',
  'prescriptions',
  'payments_payouts',
  'verification',
  'technical',
  'account',
];

export const DISPUTE_KIND_LABELS: Record<DisputeKind, string> = {
  consultation:      'Consultation dispute',
  payment:           'Payment issue',
  pharmacy:          'Pharmacy dispute',
  lab:               'Lab dispute',
  hmo:               'HMO dispute',
  prescription:      'Prescription dispute',
  call_failure:      'Call failure',
  patient_complaint: 'Patient complaint',
};

export const DISPUTE_KIND_ICONS: Record<DisputeKind, string> = {
  consultation:      'medkit-outline',
  payment:           'cash-outline',
  pharmacy:          'medical-outline',
  lab:               'flask-outline',
  hmo:               'shield-checkmark-outline',
  prescription:      'document-text-outline',
  call_failure:      'call-outline',
  patient_complaint: 'person-outline',
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open:              'Open',
  under_review:      'Under review',
  awaiting_response: 'Awaiting your response',
  resolved:          'Resolved',
  rejected:          'Rejected',
};

export const DISPUTE_STATUS_TONES: Record<DisputeStatus, string> = {
  open:              '#3B82F6',
  under_review:      '#F59E0B',
  awaiting_response: '#F97316',
  resolved:          '#10B981',
  rejected:          '#EF4444',
};

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  image:      'Image',
  document:   'Document',
  screenshot: 'Screenshot',
  log:        'Log file',
  video:      'Video',
};

// ─── Section AB — compliance, privacy & audit ────────────────────────────────

export const AUDIT_SCOPE_LABELS: Record<AuditScope, string> = {
  prescription: 'Prescription audit',
  consultation: 'Consultation audit trail',
  lab:          'Lab order audit trail',
  hmo:          'HMO claim audit trail',
};

export const AUDIT_SCOPE_ICONS: Record<AuditScope, string> = {
  prescription: 'document-text-outline',
  consultation: 'medkit-outline',
  lab:          'flask-outline',
  hmo:          'shield-checkmark-outline',
};

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed:   'Completed',
  overdue:     'Overdue',
};

export const TRAINING_STATUS_TONES: Record<TrainingStatus, string> = {
  not_started: '#94A3B8',
  in_progress: '#3B82F6',
  completed:   '#10B981',
  overdue:     '#EF4444',
};

export const SAFETY_ISSUE_CATEGORY_OPTIONS: { value: SafetyIssueCategory; label: string }[] = [
  { value: 'adverse_drug_reaction', label: 'Adverse drug reaction' },
  { value: 'device_malfunction',    label: 'Device malfunction' },
  { value: 'misdiagnosis_risk',     label: 'Misdiagnosis risk' },
  { value: 'data_breach',           label: 'Data breach' },
  { value: 'patient_harm',          label: 'Patient harm' },
  { value: 'other',                 label: 'Other' },
];

export const SAFETY_ISSUE_SEVERITY_OPTIONS: { value: SafetyIssueSeverity; label: string }[] = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const SAFETY_ISSUE_SEVERITY_TONES: Record<SafetyIssueSeverity, string> = {
  low:      '#10B981',
  medium:   '#F59E0B',
  high:     '#F97316',
  critical: '#EF4444',
};

export const ACCOUNT_REVIEW_REASON_LABELS: Record<AccountReviewReason, string> = {
  routine_audit:        'Routine audit',
  licence_verification: 'Licence verification',
  patient_report:       'Patient report',
  suspicious_activity:  'Suspicious activity',
  policy_violation:     'Policy violation',
};

// ─── Section AC — settings ───────────────────────────────────────────────────

export const TWO_FACTOR_METHODS: { value: TwoFactorMethod; label: string }[] = [
  { value: 'none',          label: 'Off' },
  { value: 'authenticator', label: 'Authenticator app' },
  { value: 'sms',           label: 'SMS code' },
  { value: 'email',         label: 'Email code' },
];

export const TWO_FACTOR_METHOD_LABELS: Record<TwoFactorMethod, string> = {
  none:          'Off',
  authenticator: 'Authenticator app',
  sms:           'SMS code',
  email:         'Email code',
};

export const DEVICE_PLATFORM_ICONS: Record<DevicePlatform, string> = {
  ios:     'phone-portrait-outline',
  android: 'phone-portrait-outline',
  web:     'desktop-outline',
};

// NOTE: named APP_LANGUAGE_OPTIONS (not LANGUAGE_OPTIONS) — the Section B
// profile constants already export a `LANGUAGE_OPTIONS: string[]` for "languages
// spoken". This is the typed app-UI language selector for the language-settings
// screen, so it is deliberately distinct to avoid a barrel collision.
export const APP_LANGUAGE_OPTIONS: { value: AppLanguage; label: string }[] = [
  { value: 'en',  label: 'English' },
  { value: 'fr',  label: 'Français' },
  { value: 'ha',  label: 'Hausa' },
  { value: 'yo',  label: 'Yorùbá' },
  { value: 'ig',  label: 'Igbo' },
  { value: 'pcm', label: 'Nigerian Pidgin' },
];

export const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: 'system', label: 'System default' },
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
];

// ─── Section AD — empty, error & edge-state ──────────────────────────────────

export const EDGE_STATE_TONES: Record<EdgeStateTone, string> = {
  neutral: '#94A3B8',
  info:    '#3B82F6',
  warning: '#F59E0B',
  error:   '#EF4444',
};

// Human-readable labels for each edge-state kind (used in debug / analytics and
// any picker UI). The full descriptors (title/message/icon/cta) live in
// EDGE_STATES in the api file.
export const EDGE_STATE_LABELS: Record<EdgeStateKind, string> = {
  no_appointments:              'No appointments',
  no_messages:                  'No messages',
  no_prescriptions:             'No prescriptions',
  no_lab_results:               'No lab results',
  no_earnings:                  'No earnings',
  no_reviews:                   'No reviews',
  no_internet:                  'No internet',
  server_error:                 'Server error',
  session_expired:              'Session expired',
  camera_permission_denied:     'Camera permission denied',
  microphone_permission_denied: 'Microphone permission denied',
  file_upload_failed:           'File upload failed',
  patient_unavailable:          'Patient unavailable',
  patient_cancelled:            'Patient cancelled',
  call_connection_failed:       'Call connection failed',
  agora_unavailable:            'Agora unavailable',
  videosdk_fallback_failed:     'VideoSDK fallback failed',
  prescription_blocked:         'Prescription blocked',
  drug_interaction_detected:    'Drug interaction detected',
  lab_order_blocked:            'Lab order blocked',
  hmo_verification_failed:      'HMO verification failed',
  account_verification_pending: 'Verification pending',
  licence_expired:              'Licence expired',
  access_denied:                'Access denied',
  maintenance_mode:             'Maintenance mode',
  app_update_required:          'App update required',
};

export const APP_STATUS_MODE_LABELS: Record<AppStatusMode, string> = {
  ok:                  'Up to date',
  maintenance:         'Maintenance',
  app_update_required: 'Update required',
};

export const ACCOUNT_STATE_LABELS: Record<AccountState, string> = {
  unsubmitted:  'Not submitted',
  pending:      'Pending review',
  approved:     'Approved',
  rejected:     'Rejected',
  under_review: 'Under review',
  needs_info:   'Needs more info',
  suspended:    'Suspended',
};

export const ACCOUNT_STATE_TONES: Record<AccountState, string> = {
  unsubmitted:  '#94A3B8',
  pending:      '#F59E0B',
  approved:     '#10B981',
  rejected:     '#EF4444',
  under_review: '#F97316',
  needs_info:   '#F97316',
  suspended:    '#EF4444',
};
