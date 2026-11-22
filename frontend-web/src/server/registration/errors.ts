/**
 * The error a write against a binding application produces.
 *
 * It extends `ApiError` so every registration route that ends in
 * `handleApiError` answers 409 with `code: 'application_locked'` without
 * needing a branch of its own — there are three write routes (the legacy
 * PATCH, the strict `/step` adapter and `/submit`) and a fourth one added
 * later would otherwise have to remember the rule.
 *
 * Server-side on purpose: `ApiError` pulls in `next/server`, so this file must
 * never be imported by a client component. The pure rule (which statuses are
 * binding) lives in `@/src/features/registration/lock`, which has no imports.
 */

import { ApiError } from '@/src/lib/api/responses';
import { SUBMISSION_LOCKED_CODE, SUBMISSION_LOCKED_MESSAGE } from '@/src/features/registration/lock';

export class ApplicationLockedError extends ApiError {
  constructor(message: string = SUBMISSION_LOCKED_MESSAGE) {
    super(message, 409, SUBMISSION_LOCKED_CODE);
    this.name = 'ApplicationLockedError';
  }
}
