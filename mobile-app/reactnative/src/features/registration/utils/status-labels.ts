// The words a status is shown as.
//
// Split out of `status.ts`, which also owns the chip colours and therefore
// imports `react-native`. This file stays loadable by `node --test` (see the
// note at the top of `src/features/openmic/constants.ts`), so anything that
// only needs the label — the status screen's merged history list, for
// instance — can reuse the exact wording the chip uses instead of keeping a
// second copy that drifts.
import type { ApplicationStatus } from '../types/registration.types';

const STATUS_LABELS: Record<ApplicationStatus, string> = {
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

export function statusLabel(status: ApplicationStatus): string {
  return STATUS_LABELS[status] ?? status;
}
