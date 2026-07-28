// ── Doctor module — Batch 1 (sections C · D · E · F) constants ───────────────
// Static option lists for the Batch 1 provider-side screens. Pure data only —
// no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel). REUSES
// WEEKDAYS / CONSULT_DURATION_OPTIONS / BUFFER_OPTIONS / SPECIALTY_OPTIONS /
// PET_SPECIES_OPTIONS / CONSULT_FEE_PRESETS_KOBO from the barrel — do not
// duplicate those here.

import type { VetLicenceBody, VetProfileBuilderStep } from '@/types/doctor.batch1';
import type {
  DashboardAlertKind,
  DashboardAlertSeverity,
  DoctorPresence,
  AnnouncementTone,
  RecurrenceFrequency,
  QueuePriority,
  AppointmentBilling,
  TimezoneOption,
} from '@/types/doctor.batch1';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION C — vet profile & verification
// ═══════════════════════════════════════════════════════════════════════════

// Veterinary licensing bodies (vet analogue of the human MDCN).
export const VET_LICENCE_BODIES: { value: VetLicenceBody; label: string }[] = [
  { value: 'VCN',   label: 'Veterinary Council of Nigeria (VCN)' },
  { value: 'other', label: 'Other' },
];

// Vet specialties (drives screen "vet specialty selection"). Distinct from the
// human SPECIALTY_OPTIONS in the barrel.
export const VET_SPECIALTY_OPTIONS: { id: string; label: string }[] = [
  { id: 'vet-small-animal', label: 'Small Animal (Companion)' },
  { id: 'vet-large-animal', label: 'Large Animal / Livestock' },
  { id: 'vet-avian',        label: 'Avian (Birds)' },
  { id: 'vet-exotic',       label: 'Exotic & Wildlife' },
  { id: 'vet-surgery',      label: 'Veterinary Surgery' },
  { id: 'vet-dermatology',  label: 'Veterinary Dermatology' },
  { id: 'vet-dentistry',    label: 'Veterinary Dentistry' },
  { id: 'vet-general',      label: 'General Veterinary Practice' },
];

export const VET_SUB_SPECIALTY_OPTIONS: string[] = [
  'Companion Animal Medicine',
  'Veterinary Surgery',
  'Internal Medicine',
  'Dermatology',
  'Dentistry',
  'Reproduction & Theriogenology',
  'Preventive Care & Vaccination',
  'Emergency & Critical Care',
];

// Vet profile builder step metadata (hub checklist order + labels).
export const VET_PROFILE_BUILDER_STEPS: { step: VetProfileBuilderStep; label: string }[] = [
  { step: 'personal_info',  label: 'Personal information' },
  { step: 'specialty',      label: 'Veterinary specialty' },
  { step: 'species',        label: 'Pet species specialisation' },
  { step: 'licence_number', label: 'Veterinary licence number' },
  { step: 'licence_upload', label: 'Upload veterinary licence' },
  { step: 'certificates',   label: 'Certificates' },
  { step: 'affiliations',   label: 'Clinic affiliation' },
  { step: 'experience',     label: 'Experience history' },
  { step: 'pricing',        label: 'Consultation pricing' },
  { step: 'availability',   label: 'Availability' },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION D — dashboard
// ═══════════════════════════════════════════════════════════════════════════

export const PRESENCE_LABELS: Record<DoctorPresence, string> = {
  online:  'Online',
  busy:    'Busy',
  away:    'Away',
  offline: 'Offline',
};

// Presence dot tones (hex; UI may map to its own palette).
export const PRESENCE_TONES: Record<DoctorPresence, string> = {
  online:  '#10B981',
  busy:    '#F59E0B',
  away:    '#6B7280',
  offline: '#9CA3AF',
};

// NOTE: prefixed `DASHBOARD_` to avoid colliding with the Phase 2 compliance
// `ALERT_SEVERITY_LABELS` already exported from the constants barrel.
export const DASHBOARD_ALERT_KIND_LABELS: Record<DashboardAlertKind, string> = {
  urgent_case:          'Urgent case',
  compliance:           'Compliance',
  profile_completion:   'Profile completion',
  licence_expiry:       'Licence expiry',
  new_lab_result:       'New lab result',
  hmo_approval:         'HMO approval',
  pending_prescription: 'Pending prescription',
  refill_request:       'Refill request',
  follow_up:            'Follow-up request',
  doctor_late:          'Running late',
};

export const DASHBOARD_ALERT_SEVERITY_LABELS: Record<DashboardAlertSeverity, string> = {
  info:     'Info',
  warning:  'Warning',
  critical: 'Critical',
};

// Alert severity tones (hex).
export const DASHBOARD_ALERT_SEVERITY_TONES: Record<DashboardAlertSeverity, string> = {
  info:     '#3B82F6',
  warning:  '#F59E0B',
  critical: '#EF4444',
};

// Sort order so the dashboard surfaces the worst alerts first.
export const DASHBOARD_ALERT_SEVERITY_RANK: Record<DashboardAlertSeverity, number> = {
  info: 0, warning: 1, critical: 2,
};

export const ANNOUNCEMENT_TONE_TONES: Record<AnnouncementTone, string> = {
  info:    '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION E — availability & schedule
// ═══════════════════════════════════════════════════════════════════════════

// Reminder offsets (minutes before the appointment) for the reminder picker.
export const REMINDER_OFFSET_OPTIONS: { value: number; label: string }[] = [
  { value: 1440, label: '1 day before' },
  { value: 120,  label: '2 hours before' },
  { value: 60,   label: '1 hour before' },
  { value: 30,   label: '30 minutes before' },
  { value: 15,   label: '15 minutes before' },
  { value: 5,    label: '5 minutes before' },
];

export const RECURRENCE_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'weekly',   label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly',  label: 'Every month' },
];

export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  weekly:   'Weekly',
  biweekly: 'Bi-weekly',
  monthly:  'Monthly',
};

// Timezone options (Nigeria-first sampling) for the timezone settings screen.
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: 'Africa/Lagos',     label: 'West Africa Time — Lagos',      offset: '+01:00' },
  { value: 'Africa/Accra',     label: 'Greenwich Mean Time — Accra',   offset: '+00:00' },
  { value: 'Africa/Nairobi',   label: 'East Africa Time — Nairobi',    offset: '+03:00' },
  { value: 'Africa/Johannesburg', label: 'South Africa Time — Johannesburg', offset: '+02:00' },
  { value: 'Europe/London',    label: 'British Time — London',         offset: '+00:00' },
  { value: 'America/New_York', label: 'Eastern Time — New York',       offset: '-05:00' },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION F — appointment & consultation queue
// ═══════════════════════════════════════════════════════════════════════════

export const QUEUE_PRIORITY_LABELS: Record<QueuePriority, string> = {
  emergency: 'Emergency',
  high:      'High',
  normal:    'Normal',
  low:       'Low',
};

// Priority chip tones (hex).
export const QUEUE_PRIORITY_TONES: Record<QueuePriority, string> = {
  emergency: '#EF4444',
  high:      '#F97316',
  normal:    '#3B82F6',
  low:       '#6B7280',
};

// Sort order so the queue surfaces the highest-priority patients first.
export const QUEUE_PRIORITY_RANK: Record<QueuePriority, number> = {
  emergency: 3, high: 2, normal: 1, low: 0,
};

export const APPOINTMENT_BILLING_LABELS: Record<AppointmentBilling, string> = {
  hmo:            'HMO-covered',
  paid:           'Paid',
  free_follow_up: 'Free follow-up',
};

// Billing badge tones (hex).
export const APPOINTMENT_BILLING_TONES: Record<AppointmentBilling, string> = {
  hmo:            '#6366F1',
  paid:           '#10B981',
  free_follow_up: '#48B8AC',
};

// Rejection reasons for declining an appointment request (consolidated reject
// state). Mirrors the Section B REJECTION_REASONS pattern.
export const APPOINTMENT_REJECT_REASONS: { code: string; label: string }[] = [
  { code: 'unavailable',     label: 'Not available at the requested time' },
  { code: 'out_of_scope',    label: 'Outside my area of practice' },
  { code: 'needs_in_person', label: 'Requires an in-person visit' },
  { code: 'incomplete_info', label: 'Insufficient information provided' },
  { code: 'other',           label: 'Other' },
];

// Countdown windows (minutes) — keep the helper defaults and the UI in sync.
export const CONSULT_SOON_WINDOW_MINS = 10; // "starting soon" threshold
export const CONSULT_LATE_GRACE_MINS = 5;   // doctor-late warning threshold
