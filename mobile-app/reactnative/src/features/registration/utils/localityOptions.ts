// Client rules for the state -> local government -> village cascade on the phone.
//
// The registration schema ships `personal.localGovernment` as a select with no
// options and `personal.village` as a bare text box, which is the same hole
// `personal.city` had until cityOptions.ts filled it: the data exists, the app just
// never asked for it in the right order. On a local contest the village IS the
// locality — a filter and a leaderboard tier built from rows where eleven people
// typed eleven spellings of one quarter.
//
// Three rules, deliberately the same three the web wizard uses
// (frontend-web/src/features/registration/locality-picker.ts — the packages share no
// runtime, so the rules are restated here rather than imported, and the mobile spec
// pins them side by side):
//
//   1. LGA options follow the STATE OF ORIGIN. Residence still drives the city
//      pickers it already drives; those two geographies answer different questions
//      and locality is built from origin.
//   2. Changing a level clears the levels below it, so a saved row can never read
//      "Onitsha North / Ikeja".
//   3. A missing, empty, or failed village list degrades to a plain text box. Only
//      some LGAs have curated quarters, and nobody is blocked from entering over
//      where they live — so this module cannot throw and the wizard never shows an
//      error for it.
//
// The HTTP reader is a parameter, not an import: `@/api/client` drags in
// async-storage and the React Native network stack, which the `node --test` unit
// suite cannot load, and the rules above are the part worth pinning. The wizard
// passes `regGet`, which hits the Next.js BFF (the public read
// /api/registration/villages — NOT Go's /api/v1/connect/villages, which sits behind
// auth and is meant for the voting screens).

import type { RegistrationField } from '../types/registration.types';
import { citiesForState } from './cityOptions';

export const VILLAGES_ENDPOINT = '/api/registration/villages';

/** The three cascade keys, spelled once. */
export const STATE_OF_ORIGIN_KEY = 'personal.stateOfOrigin';
export const LOCAL_GOVERNMENT_KEY = 'personal.localGovernment';
export const VILLAGE_KEY = 'personal.village';

export interface VillagesChoice {
  mode: 'curated' | 'free_text';
  villages: string[];
}

const FREE_TEXT: VillagesChoice = { mode: 'free_text', villages: [] };
const freeText = (): VillagesChoice => ({ ...FREE_TEXT });

/** Local governments of a state of origin. Blank/unknown state => no options. */
export function lgaOptionsFor(originState: unknown): string[] {
  if (typeof originState !== 'string') return [];
  const state = originState.trim();
  if (!state) return [];
  // citiesForState already reads src/data/nigeria.ts and aliases the server's
  // "FCT Abuja" to this dataset's "FCT - Abuja", so one list serves both cascades.
  return citiesForState(state);
}

function sameValue(previous: unknown, next: unknown): boolean {
  const a = typeof previous === 'string' ? previous : '';
  const b = typeof next === 'string' ? next : '';
  return a === b;
}

/**
 * Which locality keys to wipe after a field changed, keyed off the CURRENT values so
 * re-selecting the same option never throws away an answer mid-edit. Returns {} when
 * nothing relevant moved, so the caller can spread it straight into its edit map.
 */
export function localityResetsFor(
  fieldKey: string,
  current: Record<string, unknown>,
  nextValue: unknown,
): Record<string, string> {
  if (fieldKey === STATE_OF_ORIGIN_KEY) {
    if (sameValue(current[STATE_OF_ORIGIN_KEY], nextValue)) return {};
    return { [LOCAL_GOVERNMENT_KEY]: '', [VILLAGE_KEY]: '' };
  }
  if (fieldKey === LOCAL_GOVERNMENT_KEY) {
    if (sameValue(current[LOCAL_GOVERNMENT_KEY], nextValue)) return {};
    return { [VILLAGE_KEY]: '' };
  }
  return {};
}

/** Query for the village list of one LGA. */
export function villagesUrl(state: string, lga: string): string {
  return `${VILLAGES_ENDPOINT}?state=${encodeURIComponent(state)}&lga=${encodeURIComponent(lga)}`;
}

/**
 * Turn whatever the endpoint returned into a picker decision. Anything the shape does
 * not recognise — an error body, a null list, a list of objects — answers free text
 * rather than guessing: "let them type it" is always the safe reading, and the other
 * direction silently hides a real list behind a text box.
 */
export function parseVillagesResponse(body: unknown): VillagesChoice {
  if (!body || typeof body !== 'object') return freeText();

  const payload = body as Record<string, unknown>;
  if (payload.success !== true) return freeText();
  if (payload.mode !== 'curated') return freeText();

  const raw = payload.villages;
  if (!Array.isArray(raw) || raw.length === 0) return freeText();
  if (!raw.every((name) => typeof name === 'string' && name.trim().length > 0)) {
    return freeText();
  }

  return { mode: 'curated', villages: (raw as string[]).map((name) => name.trim()) };
}

/**
 * Read the published quarters of one LGA. A half-chosen pair is not a question worth
 * sending, and a failed request is not the applicant's problem — both answer free
 * text, which is the same thing an uncurated LGA would have said anyway.
 */
export async function loadVillageChoices(
  state: unknown,
  lga: unknown,
  get: (url: string) => Promise<unknown>,
): Promise<VillagesChoice> {
  const origin = String(state ?? '').trim();
  const localGovernment = String(lga ?? '').trim();
  if (!origin || !localGovernment) return freeText();
  try {
    return parseVillagesResponse(await get(villagesUrl(origin, localGovernment)));
  } catch {
    return freeText();
  }
}

/**
 * For a locality field, return the same field with its options populated: the LGA
 * select follows the state of origin, and the village box carries the published
 * quarters of the chosen LGA as tap-to-fill suggestions.
 *
 * The village field STAYS a text field when it has options — that pairing is what
 * FieldRenderer renders as suggestions under an editable box, the RN equivalent of the
 * web's <datalist>. A quarter spelled differently at home has to remain typeable, so
 * turning it into a select would be a downgrade dressed up as a feature.
 *
 * Every other field passes through by identity, so the wizard can wrap each field with
 * this on every render without re-rendering anything.
 */
export function withLocalityOptions(
  field: RegistrationField,
  valueFor: (key: string) => unknown,
  choices: VillagesChoice,
): RegistrationField {
  if (field.key === LOCAL_GOVERNMENT_KEY) {
    const state = String(valueFor(STATE_OF_ORIGIN_KEY) ?? '').trim();
    return {
      ...field,
      options: lgaOptionsFor(state),
      placeholder: state ? 'Select your local government' : 'Select your state of origin first',
    };
  }

  if (field.key === VILLAGE_KEY) {
    if (choices.mode !== 'curated') return field;
    return { ...field, options: choices.villages };
  }

  return field;
}

/**
 * The published quarters a text field should offer as tap-to-fill pills, or [] when
 * this field is not the village box.
 *
 * FieldRenderer asks this instead of testing `field.options?.length` on the text
 * branch: options means "these are the values" for a select, and letting a text field
 * grow pills whenever a schema happens to carry options would make an unrelated field
 * change appearance. Only the village box is meant to be typeable AND suggestable.
 */
export function villageSuggestionsFor(field: RegistrationField): string[] {
  if (field.key !== VILLAGE_KEY) return [];
  return field.options ?? [];
}
