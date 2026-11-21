
import type { ApplicationStatus } from '../types/registration.types';
import { Colors } from '@/constants/tokens';

// The wording lives in `status-labels.ts`, which is free of `react-native` so a
// `node --test` spec can reuse it. Re-exported here because that is where the
// screen-facing status helpers already live.
export { statusLabel } from './status-labels';

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
