// Registration form registry.
// Each contest has its OWN self-contained form module in this folder. This file
// is the only place that knows the slug -> builder mapping. To add a new bespoke
// register it below. Contests without an entry here fall back to `buildDefaultSteps`.
// Because every form is self-contained, editing one contest's file (fields,
// labels, required flags, step titles) affects ONLY that contest.
import type { ContestFormSchema, RegistrationDraft, RegistrationStep } from '../types';
import { buildRealityTvShowSteps } from './reality-tv-show';
import { buildStemContestSteps } from './stem-contest';
import { buildSmePitchContestSteps } from './sme-pitch-contest';
import { buildOpenMicCompetitionSteps } from './open-mic-competition';
import { buildFilmAcademySteps } from './film-academy';
import { buildDefaultSteps } from './default';
import { buildStepsFromSchema } from './from-schema';
import { ensureLocalityFields } from '../locality-fields';

export type RegistrationFormBuilder = (draft: RegistrationDraft) => RegistrationStep[];

export const registrationFormBuilders: Record<string, RegistrationFormBuilder> = {
  'reality-tv-show': buildRealityTvShowSteps,
  'stem-contest': buildStemContestSteps,
  'sme-pitch-contest': buildSmePitchContestSteps,
  'open-mic-competition': buildOpenMicCompetitionSteps,
  'film-academy': buildFilmAcademySteps,
};

function readFormSchema(draft: RegistrationDraft): ContestFormSchema | null {
  const raw = draft.formData['derived.formSchema'];
  if (!raw || typeof raw !== 'object') return null;
  const schema = raw as Partial<ContestFormSchema>;
  if (!Array.isArray(schema.includedFields)) return null;
  return schema as ContestFormSchema;
}

/**
 * Resolve the correct form builder for a draft's contest and build its steps.
 *
 * Priority:
 *   1. Admin-defined form schema (draft carries `derived.formSchema`) — the
 *      contestant sees exactly the admin-mapped inputs.
 *   2. Hand-tailored per-contest template (forms/<slug>.ts) for built-in contests.
 *   3. Capability-driven default form for any other slug.
 *
 * The state -> LGA -> village cascade is added to branches 2 and 3, not 1. It is a
 * platform-level question (the same one every contest's roster filters read from)
 * rather than one template's choice, and before it was added here no hand-built
 * form asked for a local government or a quarter at all — so a contest scoped to
 * an LGA in the console still collected nothing to match it against. An operator
 * who mapped `formSchema` picks their own fields from the catalog, which already
 * offers all three keys, so that list is left exactly as they set it.
 */
export function buildStepsForContest(draft: RegistrationDraft): RegistrationStep[] {
  const schema = readFormSchema(draft);
  if (schema) {
    return buildStepsFromSchema(draft, schema);
  }
  const builder = registrationFormBuilders[draft.contestSlug] || buildDefaultSteps;
  return ensureLocalityFields(builder(draft), draft);
}
