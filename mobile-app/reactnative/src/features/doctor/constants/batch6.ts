// ── Doctor module — Batch 6 constants ────────────────────────────────────────
// Static option lists / label maps for Batch 6 (Sections W · X · Y · Z —
// Medical Records · Notifications · Earnings/Wallet/Payout · Ratings/Reputation).
// Pure data only — no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel).
//
// REUSE: the rating/metric labels and the BankAccount shape already exist in
// Phase 2 / Section B; here we add only the missing record-category,
// notification-category, earnings-period/source and metric maps used by the
// Batch 6 screens.

import type {
  RecordCategory,
  RecordRestrictionLevel,
  RecordExportFormat,
  RecordShareStatus,
  DoctorNotificationKind,
  NotificationCategory,
  NotificationSeverity,
  EarningsSource,
  EarningsPeriod,
  PayoutDetailStatus,
  InvoiceStatus,
  SettlementDisputeStatus,
  QualityScoreGrade,
  ReviewDisputeReason,
  ReviewDisputeStatus,
} from '@/types/doctor.batch6';

// ─── Section W — medical records ──────────────────────────────────────────────

export const RECORD_CATEGORY_LABELS: Record<RecordCategory, string> = {
  consultations: 'Consultations',
  prescriptions: 'Prescriptions',
  lab_results:   'Lab results',
  documents:     'Documents',
  imaging:       'Imaging',
  allergies:     'Allergies',
  medications:   'Medications',
  diagnoses:     'Diagnoses',
  care_plans:    'Care plans',
  referrals:     'Referrals',
  hmo:           'HMO records',
  dependents:    'Dependents',
  pets:          'Pet records',
};

// Icon hints (Ionicons-style names) for the dashboard quick-category tiles.
export const RECORD_CATEGORY_ICONS: Record<RecordCategory, string> = {
  consultations: 'medkit-outline',
  prescriptions: 'document-text-outline',
  lab_results:   'flask-outline',
  documents:     'folder-outline',
  imaging:       'scan-outline',
  allergies:     'warning-outline',
  medications:   'medical-outline',
  diagnoses:     'pulse-outline',
  care_plans:    'clipboard-outline',
  referrals:     'share-social-outline',
  hmo:           'shield-checkmark-outline',
  dependents:    'people-outline',
  pets:          'paw-outline',
};

export const RECORD_RESTRICTION_LEVEL_LABELS: Record<RecordRestrictionLevel, string> = {
  open:             'Open',
  consent_required: 'Consent required',
  restricted:       'Restricted',
  blocked:          'Blocked',
};

export const RECORD_RESTRICTION_LEVEL_TONES: Record<RecordRestrictionLevel, string> = {
  open:             '#10B981',
  consent_required: '#F59E0B',
  restricted:       '#F97316',
  blocked:          '#EF4444',
};

export const RECORD_EXPORT_FORMAT_OPTIONS: { value: RecordExportFormat; label: string }[] = [
  { value: 'pdf',       label: 'PDF document' },
  { value: 'fhir_json', label: 'FHIR (JSON)' },
  { value: 'csv',       label: 'CSV (spreadsheet)' },
];

export const RECORD_SHARE_STATUS_LABELS: Record<RecordShareStatus, string> = {
  pending: 'Pending',
  sent:    'Sent',
  viewed:  'Viewed',
  revoked: 'Revoked',
  expired: 'Expired',
};

// ─── Section X — notifications ────────────────────────────────────────────────

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  appointments: 'Appointments',
  messages:     'Messages',
  clinical:     'Clinical',
  pharmacy:     'Pharmacy',
  hmo:          'HMO',
  earnings:     'Earnings',
  compliance:   'Compliance',
  reputation:   'Reputation',
  support:      'Support',
};

export const NOTIFICATION_CATEGORY_ICONS: Record<NotificationCategory, string> = {
  appointments: 'calendar-outline',
  messages:     'chatbubble-ellipses-outline',
  clinical:     'pulse-outline',
  pharmacy:     'medical-outline',
  hmo:          'shield-checkmark-outline',
  earnings:     'cash-outline',
  compliance:   'alert-circle-outline',
  reputation:   'star-outline',
  support:      'help-buoy-outline',
};

// Maps each notification kind to its category (single source of truth for the
// rich-notification → group bucketing).
export const NOTIFICATION_KIND_CATEGORY: Record<DoctorNotificationKind, NotificationCategory> = {
  new_appointment:               'appointments',
  appointment_cancelled:         'appointments',
  patient_waiting:               'appointments',
  new_chat_message:              'messages',
  prescription_refill_request:   'clinical',
  lab_result_ready:              'clinical',
  critical_lab_result:           'clinical',
  pharmacy_substitution_request: 'pharmacy',
  drug_delivery_update:          'pharmacy',
  hmo_approval:                  'hmo',
  hmo_rejection:                 'hmo',
  payout:                        'earnings',
  compliance:                    'compliance',
  licence_renewal:               'compliance',
  rating_review:                 'reputation',
  support_response:              'support',
};

export const NOTIFICATION_KIND_LABELS: Record<DoctorNotificationKind, string> = {
  new_appointment:               'New appointment',
  appointment_cancelled:         'Appointment cancelled',
  patient_waiting:               'Patient waiting',
  new_chat_message:              'New message',
  prescription_refill_request:   'Refill request',
  lab_result_ready:              'Lab result ready',
  critical_lab_result:           'Critical lab result',
  pharmacy_substitution_request: 'Substitution request',
  drug_delivery_update:          'Delivery update',
  hmo_approval:                  'HMO approval',
  hmo_rejection:                 'HMO rejection',
  payout:                        'Payout',
  compliance:                    'Compliance',
  licence_renewal:               'Licence renewal',
  rating_review:                 'Rating / review',
  support_response:              'Support response',
};

export const NOTIFICATION_SEVERITY_TONES: Record<NotificationSeverity, string> = {
  info:     '#3B82F6',
  success:  '#10B981',
  warning:  '#F59E0B',
  critical: '#EF4444',
};

// ─── Section Y — earnings, wallet & payout ───────────────────────────────────

export const EARNINGS_PERIOD_OPTIONS: { value: EarningsPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week',  label: 'This week' },
  { value: 'month', label: 'This month' },
];

export const EARNINGS_PERIOD_LABELS: Record<EarningsPeriod, string> = {
  today: 'Today',
  week:  'This week',
  month: 'This month',
};

export const EARNINGS_SOURCE_LABELS: Record<EarningsSource, string> = {
  consult: 'Consultations',
  hmo:     'HMO',
  vet:     'Vet consultations',
  bonus:   'Bonus / incentives',
};

export const EARNINGS_SOURCE_TONES: Record<EarningsSource, string> = {
  consult: '#340075',
  hmo:     '#0051D5',
  vet:     '#48B8AC',
  bonus:   '#F59E0B',
};

export const PAYOUT_DETAIL_STATUS_LABELS: Record<PayoutDetailStatus, string> = {
  pending:    'Pending',
  processing: 'Processing',
  paid:       'Paid',
  failed:     'Failed',
};

export const PAYOUT_DETAIL_STATUS_TONES: Record<PayoutDetailStatus, string> = {
  pending:    '#F59E0B',
  processing: '#3B82F6',
  paid:       '#10B981',
  failed:     '#EF4444',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft:  'Draft',
  issued: 'Issued',
  paid:   'Paid',
  void:   'Void',
};

export const SETTLEMENT_DISPUTE_STATUS_LABELS: Record<SettlementDisputeStatus, string> = {
  open:         'Open',
  under_review: 'Under review',
  resolved:     'Resolved',
  rejected:     'Rejected',
};

// ─── Section Z — ratings, reviews & reputation ───────────────────────────────

// Metric tile labels for the rating dashboard (response-time / completion-rate /
// satisfaction). Keyed to the QualityScoreFactor / ReputationMetrics keys.
export const METRIC_LABELS: Record<string, string> = {
  rating:        'Patient rating',
  response_time: 'Response time',
  completion:    'Completion rate',
  satisfaction:  'Satisfaction',
  rebook:        'Rebook rate',
};

export const QUALITY_SCORE_GRADE_LABELS: Record<QualityScoreGrade, string> = {
  excellent:       'Excellent',
  good:            'Good',
  fair:            'Fair',
  needs_attention: 'Needs attention',
};

export const QUALITY_SCORE_GRADE_TONES: Record<QualityScoreGrade, string> = {
  excellent:       '#10B981',
  good:            '#3B82F6',
  fair:            '#F59E0B',
  needs_attention: '#EF4444',
};

export const REVIEW_DISPUTE_REASON_OPTIONS: { value: ReviewDisputeReason; label: string }[] = [
  { value: 'not_my_patient',       label: 'Not my patient' },
  { value: 'factually_incorrect',  label: 'Factually incorrect' },
  { value: 'abusive_language',     label: 'Abusive language' },
  { value: 'spam',                 label: 'Spam' },
  { value: 'conflict_of_interest', label: 'Conflict of interest' },
];

export const REVIEW_DISPUTE_REASON_LABELS: Record<ReviewDisputeReason, string> = {
  not_my_patient:       'Not my patient',
  factually_incorrect:  'Factually incorrect',
  abusive_language:     'Abusive language',
  spam:                 'Spam',
  conflict_of_interest: 'Conflict of interest',
};

export const REVIEW_DISPUTE_STATUS_LABELS: Record<ReviewDisputeStatus, string> = {
  open:         'Open',
  under_review: 'Under review',
  upheld:       'Upheld',
  rejected:     'Rejected',
};
