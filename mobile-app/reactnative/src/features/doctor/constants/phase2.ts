// ── Doctor module — Phase 2 constants ────────────────────────────────────────
// Static option lists for the advanced (Phase 2) provider-side screens. Pure
// data only — no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel).

import type {
  PharmacyFulfilmentStatus,
  DeliveryStage,
  RefillStatus,
  ReferralStatus,
  ClaimStatus,
  FollowUpStatus,
  FollowUpKind,
  LicenceStatus,
  ComplianceAlertSeverity,
  ReferralAttachmentKind,
} from '@/types/doctor.phase2';

// ─── Pharmacy fulfilment ─────────────────────────────────────────────────────

export const PHARMACY_STATUS_LABELS: Record<PharmacyFulfilmentStatus, string> = {
  received:              'Received',
  substitute_requested: 'Substitute requested',
  preparing:            'Preparing',
  ready:                'Ready',
  dispensed:            'Dispensed',
  cancelled:            'Cancelled',
};

// ─── Drug delivery ───────────────────────────────────────────────────────────

export const DELIVERY_STAGE_LABELS: Record<DeliveryStage, string> = {
  confirmed:        'Order confirmed',
  dispensed:        'Medication dispensed',
  picked_up:        'Picked up by courier',
  in_transit:       'In transit',
  out_for_delivery: 'Out for delivery',
  delivered:        'Delivered',
  failed:           'Delivery failed',
};

// Canonical happy-path order, used to render the timeline skeleton.
export const DELIVERY_STAGE_ORDER: DeliveryStage[] = [
  'confirmed', 'dispensed', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
];

export const COURIER_OPTIONS: string[] = ['Gokada', 'Kwik Delivery', 'GIG Logistics', 'Sendbox', 'In-house rider'];

// ─── Refills ─────────────────────────────────────────────────────────────────

export const REFILL_STATUS_LABELS: Record<RefillStatus, string> = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

// ─── Referrals ───────────────────────────────────────────────────────────────

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  draft:     'Draft',
  sent:      'Sent',
  accepted:  'Accepted',
  scheduled: 'Scheduled',
  completed: 'Completed',
  declined:  'Declined',
};

export const REFERRAL_URGENCY_OPTIONS: { value: 'routine' | 'urgent'; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent',  label: 'Urgent' },
];

export const REFERRAL_ATTACHMENT_KIND_LABELS: Record<ReferralAttachmentKind, string> = {
  note:         'Consult note',
  lab:          'Lab result',
  prescription: 'Prescription',
};

// Specialties a doctor can refer to (mirrors SPECIALTY_OPTIONS labels).
export const REFERRAL_SPECIALTY_OPTIONS: string[] = [
  'Cardiology',
  'Endocrinology',
  'Nephrology',
  'Neurology',
  'Dermatology',
  'Gastroenterology',
  'Psychiatry',
  'Orthopaedics',
  'Oncology',
  'Pulmonology',
];

// ─── HMO claims ──────────────────────────────────────────────────────────────

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted:    'Submitted',
  under_review: 'Under review',
  approved:     'Approved',
  rejected:     'Rejected',
  disputed:     'Disputed',
  paid:         'Paid',
};

export const HMO_PROVIDER_OPTIONS: string[] = [
  'Hygeia HMO', 'Avon HMO', 'Reliance HMO', 'AXA Mansard', 'Leadway Health', 'Clearline HMO',
];

// ─── Follow-up plans ─────────────────────────────────────────────────────────

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  scheduled: 'Scheduled',
  requested: 'Requested',
  approved:  'Approved',
  rejected:  'Rejected',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const FOLLOW_UP_KIND_OPTIONS: { value: FollowUpKind; label: string }[] = [
  { value: 'free', label: 'Free follow-up' },
  { value: 'paid', label: 'Paid follow-up' },
];

// ─── Reviews ─────────────────────────────────────────────────────────────────

export const REVIEW_REPORT_REASONS: string[] = [
  'Abusive or offensive language',
  'Not from a real patient',
  'Factually inaccurate',
  'Unrelated to the consultation',
  'Spam or advertising',
  'Other',
];

// ─── Compliance ──────────────────────────────────────────────────────────────

export const LICENCE_STATUS_LABELS: Record<LicenceStatus, string> = {
  valid:         'Valid',
  expiring_soon: 'Expiring soon',
  expired:       'Expired',
  suspended:     'Suspended',
};

export const ALERT_SEVERITY_LABELS: Record<ComplianceAlertSeverity, string> = {
  info:     'Info',
  warning:  'Warning',
  critical: 'Critical',
};
