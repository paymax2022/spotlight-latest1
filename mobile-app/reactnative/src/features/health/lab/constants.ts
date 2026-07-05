// ── Paymax Health — Laboratory presentation constants ────────────────────────
// Status → label/colour maps and copy. Resolve all colours through the design
// tokens; never hardcode hex in screens.

import { Colors } from '@/constants/colors';
import type {
  LabOrderStatus,
  AnalyteFlag,
  TestCategory,
  CollectionMode,
  ResultStatus,
} from './types';

export const ORDER_STATUS_META: Record<LabOrderStatus, { label: string; color: string; bg: string }> = {
  CREATED: { label: 'Placed', color: Colors.secondary, bg: Colors.iconBgBlue },
  SCHEDULED: { label: 'Scheduled', color: Colors.secondary, bg: Colors.iconBgBlue },
  SAMPLE_COLLECTED: { label: 'Sample collected', color: Colors.secondary, bg: Colors.iconBgBlue },
  IN_TRANSIT: { label: 'In transit', color: Colors.onWarning, bg: Colors.iconBgGold },
  ACCESSIONED: { label: 'Received at lab', color: Colors.secondary, bg: Colors.iconBgBlue },
  RESULT_READY: { label: 'Result ready', color: Colors.teal, bg: Colors.iconBgTeal },
  ESCALATED: { label: 'Critical — escalated', color: Colors.error, bg: Colors.errorContainer },
  RELEASED: { label: 'Released', color: Colors.teal, bg: Colors.iconBgTeal },
  CANCELLED: { label: 'Cancelled', color: Colors.error, bg: Colors.errorContainer },
};

// Ordered steps for the test-status timeline (CANCELLED/ESCALATED handled inline).
export const ORDER_TIMELINE: { status: LabOrderStatus; label: string }[] = [
  { status: 'SCHEDULED', label: 'Scheduled' },
  { status: 'SAMPLE_COLLECTED', label: 'Sample collected' },
  { status: 'IN_TRANSIT', label: 'In transit' },
  { status: 'ACCESSIONED', label: 'Received at lab' },
  { status: 'RESULT_READY', label: 'Result ready' },
  { status: 'RELEASED', label: 'Released' },
];

export function timelineIndex(status: LabOrderStatus): number {
  if (status === 'CREATED') return 0;
  if (status === 'ESCALATED') return ORDER_TIMELINE.findIndex((s) => s.status === 'RESULT_READY');
  const i = ORDER_TIMELINE.findIndex((s) => s.status === status);
  return i < 0 ? 0 : i;
}

export const FLAG_META: Record<AnalyteFlag, { label: string; color: string; bg: string }> = {
  normal: { label: 'Normal', color: Colors.teal, bg: Colors.iconBgTeal },
  low: { label: 'Low', color: Colors.onWarning, bg: Colors.iconBgGold },
  high: { label: 'High', color: Colors.onWarning, bg: Colors.iconBgGold },
  critical: { label: 'Critical', color: Colors.error, bg: Colors.errorContainer },
};

export const RESULT_STATUS_META: Record<ResultStatus, { label: string; color: string; bg: string }> = {
  RESULT_READY: { label: 'Result ready', color: Colors.teal, bg: Colors.iconBgTeal },
  ESCALATED: { label: 'Critical — escalated', color: Colors.error, bg: Colors.errorContainer },
  RELEASED: { label: 'Released', color: Colors.teal, bg: Colors.iconBgTeal },
};

export const CATEGORY_OPTIONS: { value: TestCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'haematology', label: 'Haematology' },
  { value: 'chemistry', label: 'Chemistry' },
  { value: 'endocrine', label: 'Endocrine' },
  { value: 'cardiac', label: 'Cardiac' },
  { value: 'infectious', label: 'Infectious' },
  { value: 'wellness', label: 'Wellness' },
];

export const COLLECTION_MODE_LABEL: Record<CollectionMode, string> = {
  home: 'Home collection',
  walk_in: 'Walk-in',
};

export const SAMPLE_TYPE_LABEL: Record<string, string> = {
  blood: 'Blood draw',
  urine: 'Urine sample',
  stool: 'Stool sample',
  swab: 'Swab',
  saliva: 'Saliva',
};

// HL-9 messaging surfaced at checkout: money is held, released on result release.
export const PAYMENT_HELD_COPY =
  'Your payment is held securely and only released to the lab once your validated results are released. It is refunded if the order is cancelled.';

// HL-8 consent gate copy before a result is unlocked.
export const RESULT_CONSENT_COPY =
  'Your lab results are sensitive health data under the NDPA 2023. They are encrypted and access-logged. Confirm to unlock and view your results.';

// HL-7 critical-result reassurance — escalation is never silent.
export const CRITICAL_RESULT_COPY =
  'A critical value was detected. Our clinical team has been alerted and will reach out — this is never handled silently. If you feel unwell, seek urgent in-person care now.';

// Available collection time windows for home scheduling.
export const COLLECTION_WINDOWS: string[] = [
  'Today · 2:00 - 4:00 PM',
  'Today · 4:00 - 6:00 PM',
  'Tomorrow · 7:00 - 9:00 AM',
  'Tomorrow · 9:00 - 11:00 AM',
  'Tomorrow · 11:00 AM - 1:00 PM',
];
