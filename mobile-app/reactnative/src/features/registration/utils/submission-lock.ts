import type { ApplicationStatus } from '../types/registration.types';

/** Statuses in which admin approval makes the submitted answers binding. */
export const BINDING_APPLICATION_STATUSES = [
  'approved',
  'selected_for_public_voting',
  'selected_for_bootcamp',
] as const satisfies readonly ApplicationStatus[];

const BINDING_NOTICE =
  'Your submitted answers are now binding because your entry was approved for voting. Contact support if something needs to change.';

export function isSubmissionBinding(status: ApplicationStatus): boolean {
  return (BINDING_APPLICATION_STATUSES as readonly string[]).includes(status);
}

export function submissionBindingNotice(status: ApplicationStatus): string | null {
  return isSubmissionBinding(status) ? BINDING_NOTICE : null;
}
