// ── Merchant Onboarding — status → display mappings ──────────────────────────
// Single source for badge tone + copy so the dashboard, type picker and status
// screen render every state identically (reuses StatusBadge tones).

import type { StatusTone } from '@/features/doctor/components';
import type { ApplicationStatus, MerchantProfileStatus } from '@/types/merchant';

export const APP_STATUS_DISPLAY: Record<ApplicationStatus, { label: string; tone: StatusTone }> = {
  DRAFT:           { label: 'Draft',           tone: 'neutral' },
  SUBMITTED:       { label: 'Submitted',       tone: 'info' },
  UNDER_REVIEW:    { label: 'Under review',    tone: 'info' },
  NEEDS_MORE_INFO: { label: 'Action needed',   tone: 'warning' },
  APPROVED:        { label: 'Approved',        tone: 'success' },
  REJECTED:        { label: 'Rejected',        tone: 'danger' },
};

export const PROFILE_STATUS_DISPLAY: Record<MerchantProfileStatus, { label: string; tone: StatusTone }> = {
  PROVISIONING:         { label: 'Provisioning',  tone: 'info' },
  ACTIVE:               { label: 'Active',         tone: 'success' },
  UNDER_REVERIFICATION: { label: 'Re-verifying',   tone: 'warning' },
  SUSPENDED:            { label: 'Suspended',      tone: 'danger' },
  OFFBOARDED:           { label: 'Offboarded',     tone: 'neutral' },
};
