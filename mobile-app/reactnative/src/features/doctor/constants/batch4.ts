// ── Doctor module — Batch 4 constants ────────────────────────────────────────
// Static option lists / label maps for Batch 4 (Sections O · P · Q · R). Pure
// data only — no money math. Money is always integers in kobo. ADDITIVE to
// `@/features/doctor/constants` (re-exported from its barrel).
//
// REUSE: existing follow-up / referral / HMO constants from `phase2.ts`
// (FOLLOW_UP_STATUS_LABELS, FOLLOW_UP_KIND_OPTIONS, REFERRAL_STATUS_LABELS,
// REFERRAL_URGENCY_OPTIONS, REFERRAL_ATTACHMENT_KIND_LABELS, CLAIM_STATUS_LABELS,
// HMO_PROVIDER_OPTIONS) and `batch2.ts` (RED_FLAG_OPTIONS), and the free-window
// presets from `profile.ts` (FREE_FOLLOW_UP_WINDOW_OPTIONS). We re-export the
// reused ones below so Batch 4 screens have a single import site, and add only
// the missing maps.

import type {
  PreAuthStatus,
  CoveredServiceStatus,
  CoveredServiceKind,
  OpinionKind,
  OpinionStatus,
  IncomingReferralStatus,
  AdherenceLevel,
  ChronicTrend,
  CarePlanMilestoneStatus,
  EscalationKind,
  EscalationStatus,
  EmergencyFacilityKind,
  FraudWarningSeverity,
} from '@/types/doctor.batch4';

// ─── REUSE: re-export the existing Phase 2 / Batch 2 / profile constants ──────
// (Single import site for Batch 4 screens. Source of truth stays unchanged.)
export {
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_KIND_OPTIONS,
  REFERRAL_STATUS_LABELS,
  REFERRAL_URGENCY_OPTIONS,
  REFERRAL_ATTACHMENT_KIND_LABELS,
  REFERRAL_SPECIALTY_OPTIONS,
  CLAIM_STATUS_LABELS,
  HMO_PROVIDER_OPTIONS,
} from './phase2';
export { RED_FLAG_OPTIONS } from './batch2';
export { FREE_FOLLOW_UP_WINDOW_OPTIONS } from './profile';

// ═══════════════════════════════════════════════════════════════════════════
// Section O — HMO / Insurance
// ═══════════════════════════════════════════════════════════════════════════

// status → { label, tone } where tone is a UI palette key (success/warning/danger/info).
export const PREAUTH_STATUS_LABELS: Record<PreAuthStatus, { label: string; tone: string }> = {
  pending:        { label: 'Pending',          tone: 'warning' },
  approved:       { label: 'Approved',         tone: 'success' },
  rejected:       { label: 'Rejected',         tone: 'danger'  },
  limit_exceeded: { label: 'Limit exceeded',   tone: 'danger'  },
};

export const COVERED_STATUS_LABELS: Record<CoveredServiceStatus, { label: string; tone: string }> = {
  covered:      { label: 'Covered',            tone: 'success' },
  partial:      { label: 'Partially covered',  tone: 'warning' },
  not_covered:  { label: 'Not covered',        tone: 'danger'  },
  pending_auth: { label: 'Pre-auth required',  tone: 'info'    },
};

export const COVERED_SERVICE_KIND_LABELS: Record<CoveredServiceKind, string> = {
  prescription: 'Prescription',
  lab:          'Lab order',
  consultation: 'Consultation',
};

export const FRAUD_WARNING_SEVERITY_LABELS: Record<FraudWarningSeverity, { label: string; tone: string }> = {
  info:     { label: 'Info',     tone: 'info'    },
  warning:  { label: 'Warning',  tone: 'warning' },
  critical: { label: 'Critical', tone: 'danger'  },
};

// Services that may require pre-authorisation (pre-auth request picker).
export const PREAUTH_SERVICE_OPTIONS: string[] = [
  'MRI scan',
  'CT scan',
  'Specialist referral',
  'Inpatient admission',
  'Surgical procedure',
  'High-cost medication',
  'Physiotherapy',
];

// ═══════════════════════════════════════════════════════════════════════════
// Section P — Referral & Specialist Collaboration
// ═══════════════════════════════════════════════════════════════════════════

export const INCOMING_REFERRAL_STATUS_LABELS: Record<IncomingReferralStatus, { label: string; tone: string }> = {
  incoming:  { label: 'Incoming',  tone: 'info'    },
  accepted:  { label: 'Accepted',  tone: 'success' },
  rejected:  { label: 'Rejected',  tone: 'danger'  },
  completed: { label: 'Completed', tone: 'muted'   },
};

export const OPINION_TYPE_OPTIONS: { value: OpinionKind; label: string }[] = [
  { value: 'specialist', label: 'Specialist opinion' },
  { value: 'second',     label: 'Second opinion' },
];

export const OPINION_STATUS_LABELS: Record<OpinionStatus, { label: string; tone: string }> = {
  requested: { label: 'Requested', tone: 'warning' },
  responded: { label: 'Responded', tone: 'success' },
  declined:  { label: 'Declined',  tone: 'danger'  },
};

export const REFERRAL_REJECTION_REASONS: string[] = [
  'Outside my specialty',
  'Insufficient clinical information',
  'No availability in the requested window',
  'Patient should be seen in person',
  'Other',
];

// ═══════════════════════════════════════════════════════════════════════════
// Section Q — Follow-Up Care
// ═══════════════════════════════════════════════════════════════════════════

// Self-reported medication adherence options (adherence check sheet).
export const ADHERENCE_OPTIONS: { value: AdherenceLevel; label: string; tone: string }[] = [
  { value: 'good',    label: 'Good (≥ 90%)',     tone: 'success' },
  { value: 'partial', label: 'Partial (50–89%)', tone: 'warning' },
  { value: 'poor',    label: 'Poor (< 50%)',     tone: 'danger'  },
];

export const CHRONIC_TREND_LABELS: Record<ChronicTrend, { label: string; tone: string }> = {
  improving: { label: 'Improving', tone: 'success' },
  stable:    { label: 'Stable',    tone: 'info'    },
  worsening: { label: 'Worsening', tone: 'danger'  },
};

export const CARE_PLAN_MILESTONE_STATUS_LABELS: Record<CarePlanMilestoneStatus, { label: string; tone: string }> = {
  upcoming:  { label: 'Upcoming',  tone: 'muted'   },
  due:       { label: 'Due',       tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  missed:    { label: 'Missed',    tone: 'danger'  },
};

// Care-plan review cadence presets.
export const CARE_PLAN_REVIEW_OPTIONS: string[] = ['1 month', '3 months', '6 months', '12 months'];

// Chronic conditions commonly placed on a long-term care plan.
export const CHRONIC_CONDITION_OPTIONS: string[] = [
  'Type 2 Diabetes Mellitus',
  'Hypertension',
  'Asthma',
  'Chronic Kidney Disease',
  'Heart Failure',
  'Hypothyroidism',
  'Sickle Cell Disease',
];

// Free-follow-up window presets (days). REUSE: alias of the profile policy list.
// Re-exported above as FREE_FOLLOW_UP_WINDOW_OPTIONS; this alias documents intent
// at Batch 4 call sites.
export const FOLLOWUP_WINDOW_OPTIONS: number[] = [3, 5, 7, 14, 30];

// ═══════════════════════════════════════════════════════════════════════════
// Section R — Emergency & Escalation (DEMO — non-actionable)
// ═══════════════════════════════════════════════════════════════════════════

export const ESCALATION_KIND_LABELS: Record<EscalationKind, string> = {
  hospital:          'Escalate to hospital',
  ambulance:         'Request ambulance',
  emergency_contact: 'Notify emergency contact',
};

export const ESCALATION_STATUS_LABELS: Record<EscalationStatus, { label: string; tone: string }> = {
  initiated:    { label: 'Initiated',    tone: 'warning' },
  notified:     { label: 'Notified',     tone: 'info'    },
  acknowledged: { label: 'Acknowledged', tone: 'success' },
  cancelled:    { label: 'Cancelled',    tone: 'muted'   },
};

export const EMERGENCY_FACILITY_KIND_LABELS: Record<EmergencyFacilityKind, string> = {
  hospital:          'Hospital',
  ambulance:         'Ambulance',
  emergency_service: 'Emergency service',
};

// REUSE the Batch 2 RED_FLAG_OPTIONS (re-exported above) for red-flag symptom
// selection in the emergency flow.

// Mandatory disclaimer shown on every emergency screen. This is a DEMO feature
// and NOT a real emergency service — no calls are placed and no dispatch occurs.
export const EMERGENCY_DISCLAIMER =
  'DEMO ONLY — This is not a real emergency service. No calls are placed and no ' +
  'ambulance or hospital is actually dispatched. In a real emergency, contact ' +
  'your local emergency number directly.';
