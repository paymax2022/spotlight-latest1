/**
 * CONTEST-LOCK — an approved registration is binding.
 *
 * Once an admin approves a song for voting, the answers that went to the
 * judges are the record of the entry: they are what the voters hear about, and
 * the roster row the promotion seam created was built from them. So they stop
 * being editable — not just hidden, but refused.
 *
 * The locked set is `approved | selected_for_public_voting |
 * selected_for_bootcamp` — exactly the statuses the promotion RPC fires on and
 * the voting projection already treats as "accepted onto a roster". Choosing the
 * same three everywhere is the point: the lock cannot disagree with the vote
 * gate or with the promotion seam.
 *
 * Deliberately NOT locked:
 *   - `draft` and `more_information_requested` — the latter is the admin ASKING
 *     the contestant to change something, so refusing the answer would be
 *     refusing the request.
 *   - the terminal states (`rejected`, `withdrawn`, `disqualified`, `eliminated`,
 *     `winner`) — a contestant must still be able to act on those, and this
 *     change is not about them.
 *
 * Mirrored in `mobile-app/reactnative/src/features/registration/utils/submission-lock.ts`
 * and `backend/internal/handlers/registration_store.go`; the three copies are
 * held to the same list by the specs beside them.
 */

export const BINDING_APPLICATION_STATUSES = [
  'approved',
  'selected_for_public_voting',
  'selected_for_bootcamp',
] as const;

export type BindingApplicationStatus = (typeof BINDING_APPLICATION_STATUSES)[number];

/** Machine-readable reason, surfaced to clients as `code`. */
export const SUBMISSION_LOCKED_CODE = 'application_locked';

export const SUBMISSION_LOCKED_MESSAGE =
  'This application was approved, so its answers are now fixed. Contact support if something needs to change.';

/**
 * Is this application binding?
 *
 * Accepts any status string so a caller can pass a row's status without
 * narrowing it first; unknown statuses are not binding.
 */
export function isSubmissionBinding(status: string | null | undefined): boolean {
  const value = String(status ?? '').trim();
  return (BINDING_APPLICATION_STATUSES as readonly string[]).includes(value);
}
