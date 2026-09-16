// ─────────────────────────────────────────────────────────────────────────────
// Registration engine entry point.
//
// This file used to define ONE shared set of field arrays and assemble every
// contest's form from them — which meant a single edit changed every contest.
// It is now a thin dispatcher:
//
//   • Shared reference DATA (states, cities, catalog, talent-skill map, option
//     lists) lives in `./reference-data` and is re-exported here so existing
//     imports (`@/src/features/registration/config`) keep working unchanged.
//
//   • The FORM STRUCTURE for each contest lives in its own self-contained module
//     under `./forms/`. `buildRegistrationSteps` simply routes each draft to the
//     right per-contest builder via `buildStepsForContest`.
//
// To change one contest's form, edit its file in `./forms/` — nothing else is
// affected. To change shared reference data for ALL contests, edit
// `./reference-data`.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  RegistrationStep,
  RegistrationStepKey,
  RegistrationDraft,
} from './types';
import { buildStepsForContest } from './forms';
import { markAccountProvidedFields } from './account-prefill';

// Re-export shared reference data so callers importing from this module (store,
// wizard, admin components) continue to work without changes.
export {
  NIGERIA_STATES,
  NIGERIA_CITIES_BY_STATE,
  DEFAULT_APPLICANT_CATEGORIES,
  TALENT_SKILL_OPTIONS,
  getTalentSkillsForContestCategory,
  MEDICAL_CONDITION_OPTIONS,
  ALLERGY_OPTIONS,
  contestRegistrationCatalog,
  resolveContestRegistration,
} from './reference-data';

export { registrationFormBuilders, buildStepsForContest } from './forms';

/**
 * Build the ordered wizard steps for a draft. Each contest resolves to its own
 * independent form definition (see `./forms/<slug>.ts`); unknown slugs use the
 * capability-driven default form.
 */
export function buildRegistrationSteps(draft: RegistrationDraft): RegistrationStep[] {
  // Details the applicant already gave at sign-up are pre-filled and locked, so
  // no contest form asks for them twice. See `./account-prefill`.
  return markAccountProvidedFields(buildStepsForContest(draft), draft);
}

/**
 * Map a (possibly legacy) step key to its index within the given steps. All
 * per-contest forms use the same 5 canonical step keys, so legacy keys from
 * older drafts still resolve correctly.
 */
export function getStepIndex(steps: RegistrationStep[], stepKey?: RegistrationStepKey) {
  if (!stepKey) return 0;
  const legacyStepMap: Partial<Record<RegistrationStepKey, RegistrationStepKey>> = {
    account_gate: 'contest_selection',
    guardian_consent: 'personal_information',
    talent_profile: 'personal_information',
    identity_verification: 'category_specific',
    media_uploads: 'category_specific',
    social_fanbase: 'category_specific',
    bootcamp_housemate_readiness: 'category_specific',
    medical_welfare_safety: 'category_specific',
    emergency_contact: 'category_specific',
    character_compliance: 'category_specific',
    payment: 'category_specific',
    audition_scheduling: 'category_specific',
    public_profile_setup: 'category_specific',
    legal_consents: 'review_submit',
  };
  const normalizedStepKey = legacyStepMap[stepKey] || stepKey;
  const index = steps.findIndex((step) => step.key === normalizedStepKey);
  return index < 0 ? 0 : index;
}
