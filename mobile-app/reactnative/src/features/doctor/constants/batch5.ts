// ── Doctor module — Batch 5 constants ────────────────────────────────────────
// Static option lists / label maps for Batch 5 (Sections S · T · U · V — the
// VETERINARY sections). Pure data only — no money math. Money is always integers
// in kobo. ADDITIVE to `@/features/doctor/constants` (re-exported from its
// barrel).
//
// REUSE: existing Phase 3 vet/pet constants from `phase3.ts`
// (PET_SPECIES_OPTIONS, PET_SPECIES_LABELS, PET_BREED_OPTIONS,
// PET_DRUG_CATALOGUE, PET_DRUG_CATEGORY_LABELS, PET_LAB_TESTS,
// PET_LAB_CATEGORY_LABELS, PET_PRODUCT_CATEGORIES, PET_WARNING_SEVERITY_LABELS,
// PET_WARNING_SEVERITY_TONES). We re-export the most-reused ones below so Batch 5
// screens have a single import site, and add only the missing maps.

import type {
  VetConsultType,
  VetAppointmentStatus,
  PetOwnerRequestStatus,
  VetReferralStatus,
  PetRxWarningKind,
  PetRxSendStatus,
  PetRefillStatus,
  PetVaccinationUrgency,
  PetChronicTrend,
  PetFulfilmentStatus,
  PetWarningSeverity,
} from '@/types/doctor.batch5';

// ─── REUSE: re-export the existing Phase 3 vet/pet constants ──────────────────
export {
  PET_SPECIES_OPTIONS,
  PET_SPECIES_LABELS,
  PET_BREED_OPTIONS,
  PET_DRUG_CATALOGUE,
  PET_DRUG_CATEGORY_LABELS,
  PET_LAB_TESTS,
  PET_LAB_CATEGORY_LABELS,
  PET_PRODUCT_CATEGORIES,
  PET_WARNING_SEVERITY_LABELS,
  PET_WARNING_SEVERITY_TONES,
} from './phase3';

// ─── Section S — vet consultation ────────────────────────────────────────────

export const VET_CONSULT_TYPE_OPTIONS: { value: VetConsultType; label: string }[] = [
  { value: 'chat',      label: 'Chat' },
  { value: 'audio',     label: 'Audio call' },
  { value: 'video',     label: 'Video call' },
  { value: 'in_person', label: 'In person' },
];

export const VET_CONSULT_TYPE_LABELS: Record<VetConsultType, string> = {
  chat: 'Chat', audio: 'Audio call', video: 'Video call', in_person: 'In person',
};

export const VET_APPOINTMENT_STATUS_LABELS: Record<VetAppointmentStatus, string> = {
  requested:   'Requested',
  scheduled:   'Scheduled',
  in_progress: 'In progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
  no_show:     'No show',
};

export const PET_OWNER_REQUEST_STATUS_LABELS: Record<PetOwnerRequestStatus, string> = {
  pending:  'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  expired:  'Expired',
};

export const VET_REFERRAL_STATUS_LABELS: Record<VetReferralStatus, string> = {
  draft:     'Draft',
  sent:      'Sent',
  accepted:  'Accepted',
  scheduled: 'Scheduled',
  completed: 'Completed',
  declined:  'Declined',
};

export const VET_REFERRAL_URGENCY_OPTIONS: { value: 'routine' | 'urgent'; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent',  label: 'Urgent' },
];

// ─── Section T — pet e-prescription ──────────────────────────────────────────

export const PET_RX_WARNING_LABELS: Record<PetRxWarningKind, string> = {
  medicine:                  'Medicine warning',
  species_contraindication:  'Species contraindication',
  allergy:                   'Allergy',
};

// Tones for the warning chips — mirrors the Phase 3 severity scale so the UI can
// reuse PET_WARNING_SEVERITY_TONES; this maps the KIND to a default severity.
export const PET_RX_WARNING_KIND_SEVERITY: Record<PetRxWarningKind, PetWarningSeverity> = {
  medicine:                  'caution',
  species_contraindication:  'danger',
  allergy:                   'danger',
};

export const PET_RX_SEND_STATUS_LABELS: Record<PetRxSendStatus, string> = {
  not_sent:  'Not sent',
  sending:   'Sending…',
  sent:      'Sent',
  received:  'Received',
  dispensed: 'Dispensed',
  failed:    'Failed',
};

export const PET_REFILL_STATUS_LABELS: Record<PetRefillStatus, string> = {
  requested: 'Requested',
  approved:  'Approved',
  rejected:  'Rejected',
};

// Dosage units offered by the calculator UI.
export const DOSAGE_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'mg',     label: 'mg' },
  { value: 'ml',     label: 'ml' },
  { value: 'mg_kg',  label: 'mg/kg' },
  { value: 'tablet', label: 'tablet(s)' },
  { value: 'drop',   label: 'drop(s)' },
];

// ─── Section U — vet lab & pet health ────────────────────────────────────────

export const PET_VACCINATION_URGENCY_LABELS: Record<PetVaccinationUrgency, string> = {
  due_soon: 'Due soon',
  overdue:  'Overdue',
  routine:  'Routine',
};

export const PET_VACCINATION_URGENCY_TONES: Record<PetVaccinationUrgency, string> = {
  due_soon: '#F59E0B',
  overdue:  '#EF4444',
  routine:  '#10B981',
};

// Common pet vaccines for the recommendation / reminder picker.
export const PET_VACCINE_OPTIONS: { value: string; label: string; species: string[] }[] = [
  { value: 'rabies',        label: 'Rabies',          species: ['dog', 'cat'] },
  { value: 'dhpp',          label: 'DHPP',            species: ['dog'] },
  { value: 'leptospirosis', label: 'Leptospirosis',   species: ['dog'] },
  { value: 'bordetella',    label: 'Bordetella',      species: ['dog'] },
  { value: 'fvrcp',         label: 'FVRCP',           species: ['cat'] },
  { value: 'felv',          label: 'Feline Leukaemia', species: ['cat'] },
];

export const VACCINATION_REMINDER_CHANNEL_OPTIONS: { value: 'sms' | 'email' | 'push'; label: string }[] = [
  { value: 'sms',   label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'push',  label: 'Push notification' },
];

// Curated pet lab packages (bundled tests) for the order screen.
export const PET_LAB_PACKAGES: { id: string; name: string; testCodes: string[]; species: string[] }[] = [
  { id: 'pkg-wellness', name: 'Wellness Panel',    testCodes: ['CBC', 'CHEM'],        species: ['dog', 'cat'] },
  { id: 'pkg-senior',   name: 'Senior Pet Panel',  testCodes: ['CBC', 'CHEM', 'UA'],  species: ['dog', 'cat'] },
  { id: 'pkg-parasite', name: 'Parasite Screen',   testCodes: ['FEC', 'HW'],          species: ['dog', 'cat'] },
];

export const PET_CHRONIC_TREND_LABELS: Record<PetChronicTrend, string> = {
  improving: 'Improving',
  stable:    'Stable',
  worsening: 'Worsening',
};

export const PET_CHRONIC_TREND_TONES: Record<PetChronicTrend, string> = {
  improving: '#10B981',
  stable:    '#3B82F6',
  worsening: '#EF4444',
};

// ─── Section V — pet store / fulfilment ──────────────────────────────────────

export const PET_FULFILMENT_STATUS_LABELS: Record<PetFulfilmentStatus, string> = {
  pending:          'Pending',
  ordered:          'Ordered',
  packed:           'Packed',
  shipped:          'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered:        'Delivered',
  cancelled:        'Cancelled',
};

// Step order so the UI can render a progress timeline.
export const PET_FULFILMENT_STATUS_RANK: Record<PetFulfilmentStatus, number> = {
  pending: 0, ordered: 1, packed: 2, shipped: 3, out_for_delivery: 4, delivered: 5, cancelled: 6,
};
