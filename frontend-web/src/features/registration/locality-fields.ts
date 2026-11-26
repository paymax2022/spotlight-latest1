// Putting the locality tier into the applicant's form.
//
// WHY THIS FILE EXISTS
// A contest form is assembled per contest — `forms/<slug>.ts`, or
// `forms/from-schema.ts` when an operator mapped the fields themselves. Six
// builders each hand-wrote their own personal-information step, and only two of
// them ever listed `personal.stateOfOrigin`; NONE listed
// `personal.localGovernment` or `personal.village`. So the cascade the wizards
// implement (`locality-picker.ts` on web, `localityOptions.ts` on the phone) had
// no field to attach to, `public.villages` had nothing to populate, and every
// roster locality filter ran on data nobody was asked for. A "local contest" was
// configured in the console but invisible at the point of entry.
//
// Injecting here — at the one choke point every hand-built form passes through —
// rather than editing six templates keeps one rule in one place: a new contest
// template gets the cascade for free, and the templates stay free of a geography
// block they would each drift apart from.
//
// WHAT IS DELIBERATE
// • OPTIONAL. The enforcement decision for locality is display + filter, so an
//   applicant who cannot answer a level is never boxed out of entering. The
//   catalog already marks all three keys without `defaultRequired`, and nothing
//   here adds a `required`.
// • THE ANCHOR IS THE PARENT, NOT THE END OF THE STEP. The pair belongs next to
//   the state it derives from: origin, then its LGA, then its quarter — before
//   "state of residence", which drives a different geography (the city pickers)
//   and answers a different question.
// • THE SCHEMA-DRIVEN PATH IS NOT TOUCHED. When an operator mapped
//   `derived.formSchema`, the field list IS their decision; completing it here
//   would silently re-add a question they switched off. That branch is handled by
//   the catalog, which already offers all three keys.
// • NO MUTATION. `buildRegistrationSteps` output can be cached, so the step whose
//   fields change is replaced rather than edited in place.
import { FIELD_CATALOG, catalogFieldToRegistrationField } from './field-catalog';
import { LOCAL_GOVERNMENT_KEY, STATE_OF_ORIGIN_KEY, VILLAGE_KEY } from './locality-picker';
import type {
  ContestRegistrationDefinition,
  RegistrationDraft,
  RegistrationField,
  RegistrationStep,
} from './types';

/** The cascade, parent first. Spelled once, in order. */
export const LOCALITY_FIELD_KEYS = [STATE_OF_ORIGIN_KEY, LOCAL_GOVERNMENT_KEY, VILLAGE_KEY] as const;

/**
 * Where an injected block lands when the step has no state of origin of its own:
 * after the geography the template already asks for, not in the middle of it.
 */
const GEOGRAPHY_ANCHORS = ['personal.city', 'personal.stateOfResidence'] as const;

/**
 * The four `derived.*` keys a draft carries the contest's locality on, spelled once
 * so the store and the hint below cannot drift.
 */
export const LOCALITY_DERIVED_KEYS = {
  scope: 'derived.localityScope',
  state: 'derived.localityState',
  lga: 'derived.localityLga',
  village: 'derived.localityVillage',
} as const;

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function catalogField(key: string): RegistrationField | undefined {
  const entry = FIELD_CATALOG.find((field) => field.key === key);
  return entry ? catalogFieldToRegistrationField(entry) : undefined;
}

/**
 * Tell the applicant WHICH local government the contest belongs to, at the field
 * where they answer for it.
 *
 * The values come from `public.contests.locality_*`, stamped onto the draft as
 * `derived.locality*` by the store. Absent keys — every draft created before this
 * feature, and every national contest — produce no hint, which is why the catalog
 * help text survives.
 */
function localityHint(draft: RegistrationDraft, key: string): string | undefined {
  const state = trimmed(draft.formData[LOCALITY_DERIVED_KEYS.state]);
  const lga = trimmed(draft.formData[LOCALITY_DERIVED_KEYS.lga]);
  const village = trimmed(draft.formData[LOCALITY_DERIVED_KEYS.village]);

  if (key === LOCAL_GOVERNMENT_KEY && lga) {
    return `This contest is for ${lga}${state ? ` (${state})` : ''}.`;
  }
  if (key === VILLAGE_KEY && village) {
    return `This contest is for ${village}${lga ? `, ${lga}` : ''}.`;
  }
  return undefined;
}

/**
 * Turn a contest definition into the `formData` entries the wizard reads.
 *
 * ALL FOUR KEYS ARE ALWAYS WRITTEN, empty included. `saveRegistrationStep` merges
 * these into the draft on every save, so a key that is omitted when a contest is
 * demoted from village to national keeps its old value on every draft of that
 * contest forever — and the applicant would be told, in help text, to answer for a
 * quarter the contest no longer claims. An empty string is the answer that clears.
 *
 * A null/undefined definition (unresolvable slug) produces the same empty shape:
 * the caller has no locality to assert either way.
 */
export function derivedLocalityFor(
  contest: Pick<ContestRegistrationDefinition, 'regionScope' | 'localityState' | 'localityLga' | 'localityVillage'> | null | undefined,
): Record<string, string> {
  return {
    [LOCALITY_DERIVED_KEYS.scope]: trimmed(contest?.regionScope),
    [LOCALITY_DERIVED_KEYS.state]: trimmed(contest?.localityState),
    [LOCALITY_DERIVED_KEYS.lga]: trimmed(contest?.localityLga),
    [LOCALITY_DERIVED_KEYS.village]: trimmed(contest?.localityVillage),
  };
}

/** Insertion index for the missing keys: after origin, else after the geography. */
function anchorIndex(fields: RegistrationField[]): number {
  const origin = fields.findIndex((field) => field.key === STATE_OF_ORIGIN_KEY);
  if (origin >= 0) return origin + 1;
  for (const anchor of GEOGRAPHY_ANCHORS) {
    const at = fields.findIndex((field) => field.key === anchor);
    if (at >= 0) return at + 1;
  }
  return fields.length;
}

/**
 * Add the locality cascade to a built form's personal step.
 *
 * Idempotent: keys the step already has are left exactly as the template wrote
 * them (reality-tv and film-academy require the state of origin, and that stays
 * required). Returns the same array when there is no personal step to extend.
 */
export function ensureLocalityFields(
  steps: RegistrationStep[],
  draft: RegistrationDraft,
): RegistrationStep[] {
  const target = steps.find((step) => step.key === 'personal_information');
  if (!target) return steps;

  const present = new Set(target.fields.map((field) => field.key));
  const missing = LOCALITY_FIELD_KEYS.filter((key) => !present.has(key))
    .map((key) => {
      const field = catalogField(key);
      if (!field) return undefined;
      const hint = localityHint(draft, key);
      return hint ? { ...field, helpText: hint } : field;
    })
    .filter((field): field is RegistrationField => Boolean(field));

  if (missing.length === 0) return steps;

  const at = anchorIndex(target.fields);
  const fields = [...target.fields.slice(0, at), ...missing, ...target.fields.slice(at)];
  return steps.map((step) => (step === target ? { ...step, fields } : step));
}
