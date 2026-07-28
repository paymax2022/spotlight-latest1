// ─────────────────────────────────────────────────────────────────────────────
// Registration form registry.
//
// Each contest has its OWN self-contained form module in this folder. This file
// is the only place that knows the slug -> builder mapping. To add a new bespoke
// form: create `<slug>.ts` exporting a `build<...>Steps(draft)` function, then
// register it below. Contests without an entry here fall back to `buildDefaultSteps`.
//
// Because every form is self-contained, editing one contest's file (fields,
// labels, required flags, step titles) affects ONLY that contest.
// ─────────────────────────────────────────────────────────────────────────────
import type { ContestFormSchema, RegistrationDraft, RegistrationStep } from '../types';
import { buildRealityTvShowSteps } from './reality-tv-show';
import { buildStemContestSteps } from './stem-contest';
import { buildSmePitchContestSteps } from './sme-pitch-contest';
import { buildOpenMicCompetitionSteps } from './open-mic-competition';
import { buildFilmAcademySteps } from './film-academy';
import { buildDefaultSteps } from './default';
import { buildStepsFromSchema } from './from-schema';

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
 */
export function buildStepsForContest(draft: RegistrationDraft): RegistrationStep[] {
  const schema = readFormSchema(draft);
  if (schema) {
    return buildStepsFromSchema(draft, schema);
  }
  const builder = registrationFormBuilders[draft.contestSlug] || buildDefaultSteps;
  return builder(draft);
}
