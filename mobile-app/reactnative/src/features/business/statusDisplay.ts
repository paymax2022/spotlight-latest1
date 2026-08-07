// Shared status → chip presentation for the Business Registry surfaces.
// Kept tiny + framework-free so the hub, verify and register screens render
// status chips identically.

import { Colors } from '@/constants/colors';
import type { BusinessStatus } from '@/types/business';

export type StatusTone = 'success' | 'pending' | 'danger' | 'neutral';

export interface StatusChip {
  label: string;
  tone: StatusTone;
}

export const BUSINESS_STATUS_DISPLAY: Record<BusinessStatus, StatusChip> = {
  draft:                  { label: 'Draft',           tone: 'neutral' },
  name_check:             { label: 'Checking name',   tone: 'pending' },
  name_reserved:          { label: 'Name reserved',   tone: 'pending' },
  registration_submitted: { label: 'Submitted',       tone: 'pending' },
  under_review:           { label: 'Under review',    tone: 'pending' },
  registered:             { label: 'Registered',      tone: 'success' },
  submitted:              { label: 'Submitted',       tone: 'pending' },
  verified:               { label: 'Verified',        tone: 'success' },
  rejected:               { label: 'Rejected',        tone: 'danger' },
  failed:                 { label: 'Failed',          tone: 'danger' },
};

export function toneColors(tone: StatusTone): { bg: string; fg: string } {
  switch (tone) {
    case 'success': return { bg: 'rgba(22,163,74,0.12)', fg: '#15803D' };
    case 'pending': return { bg: 'rgba(161,92,0,0.12)',  fg: '#A15C00' };
    case 'danger':  return { bg: Colors.errorContainer,  fg: Colors.error };
    default:        return { bg: Colors.surfaceContainerHigh, fg: Colors.onSurfaceVariant };
  }
}

export function statusChip(status: BusinessStatus): StatusChip {
  return BUSINESS_STATUS_DISPLAY[status] ?? { label: status, tone: 'neutral' };
}
