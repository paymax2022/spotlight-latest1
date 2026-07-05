// ── Registration — application status presentation helpers ───────────────────

import type { ApplicationStatus } from '../types/registration.types';
import { Colors } from '@/constants/colors';

export function statusLabel(status: ApplicationStatus): string {
  const map: Record<ApplicationStatus, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    awaiting_payment: 'Awaiting payment',
    payment_failed: 'Payment failed',
    under_review: 'Under review',
    more_information_requested: 'More info requested',
    shortlisted: 'Shortlisted',
    callback_invited: 'Callback invited',
    approved: 'Approved',
    rejected: 'Rejected',
    waitlisted: 'Waitlisted',
    disqualified: 'Disqualified',
    audition_scheduled: 'Audition scheduled',
    selected_for_bootcamp: 'Selected for bootcamp',
    selected_for_public_voting: 'Selected for voting',
    eliminated: 'Eliminated',
    winner: 'Winner',
    withdrawn: 'Withdrawn',
  };
  return map[status] ?? status;
}

// Returns { fg, bg } tones for a status chip from the design tokens.
export function statusTone(status: ApplicationStatus): { fg: string; bg: string } {
  const positive = ['approved', 'shortlisted', 'callback_invited', 'selected_for_bootcamp', 'selected_for_public_voting', 'winner', 'audition_scheduled', 'submitted'];
  const warning = ['awaiting_payment', 'under_review', 'more_information_requested', 'waitlisted', 'draft'];
  const negative = ['rejected', 'disqualified', 'eliminated', 'payment_failed', 'withdrawn'];

  if (positive.includes(status)) return { fg: Colors.tertiary, bg: Colors.iconBgTeal };
  if (warning.includes(status)) return { fg: Colors.onWarning, bg: Colors.iconBgGold };
  if (negative.includes(status)) return { fg: Colors.error, bg: Colors.errorContainer };
  return { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainer };
}

// Statuses that block further editing of the draft wizard.
export function isLockedForEditing(status: ApplicationStatus): boolean {
  return status !== 'draft';
}
