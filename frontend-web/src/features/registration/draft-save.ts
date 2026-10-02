import type { RegistrationStepKey } from './types';

/**
 * Draft-save contract for PATCH /api/registration/applications/[id].
 *
 * The route forwards `{ stepKey, values }` to `saveRegistrationStep`, which
 * merges `values` into `formData` and then validates the NAMED step against
 * the merged data. Critical detail: when that step's validation fails, the
 * route still returns HTTP 200 (`success: true`, `validation.isValid: false`)
 * but the merged formData is NOT written — a silent non-persist.
 *
 * Bespoke wizards (e.g. RealityTvShowApplicationWizard) save the whole form on
 * every step transition, not one schema step at a time. Every reality-tv step
 * other than `contest_selection` carries schema-required fields the wizard
 * never renders (identity.idUpload, medical.*, emergency.state/city,
 * audition.format, several legal.* consents…), so saving under those keys
 * would fail validation and persist nothing. `contest_selection`'s only
 * required field, `contest.title`, is server-locked from the resolved contest,
 * so it validates on every save — making it the safe checkpoint key for a
 * whole-form draft save.
 */
export const DRAFT_CHECKPOINT_STEP_KEY: RegistrationStepKey = 'contest_selection';

export function buildDraftSaveBody(values: Record<string, unknown>) {
  return { stepKey: DRAFT_CHECKPOINT_STEP_KEY, values };
}

/**
 * A PATCH save only persisted when the response succeeded AND the named step
 * validated — `validation.isValid === false` means the server returned the
 * merged draft without writing it (see comment above). Anything else
 * (non-ok status, success !== true) is also a failure; callers pair this with
 * `res.ok`.
 */
export function draftSaveSucceeded(
  payload: { success?: boolean; validation?: { isValid?: boolean } | null } | null | undefined,
): boolean {
  if (!payload || payload.success !== true) return false;
  return payload.validation?.isValid !== false;
}
