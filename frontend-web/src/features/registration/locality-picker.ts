// Client rules for the state -> local government -> village cascade.
//
// Kept out of ContestRegistrationWizard.tsx so the three rules an applicant feels
// can be tested directly, and so the same helper serves the other two wizards
// (SME pitch, reality-TV) when they adopt the locality tier:
//
//   1. LGA options follow the STATE OF ORIGIN. Residence keeps driving the city
//      pickers it already drives — those two geographies answer different
//      questions, and locality filters are built from origin.
//   2. Changing a level clears the levels below it. A saved row must never read
//      "Onitsha North / Ikeja": the village would then be counted under the wrong
//      locality on every filter and leaderboard.
//   3. A missing, empty, or failed village list degrades to a free-text box — it
//      is never an error the applicant has to dismiss. Only some LGAs have curated
//      quarters, and nobody is blocked from entering over where they live.
import { NIGERIA_LGAS_BY_STATE } from './reference-data';

export const VILLAGES_ENDPOINT = '/api/registration/villages';

/** The three cascade keys, spelled once. */
export const STATE_OF_ORIGIN_KEY = 'personal.stateOfOrigin';
export const LOCAL_GOVERNMENT_KEY = 'personal.localGovernment';
export const VILLAGE_KEY = 'personal.village';

export type LocalityLevel = 'origin' | 'lga';

export interface VillagesChoice {
  mode: 'curated' | 'free_text';
  villages: string[];
}

/** Local governments of a state of origin. Blank/unknown state => no options. */
export function lgaOptionsFor(originState: unknown): string[] {
  if (typeof originState !== 'string') return [];
  const state = originState.trim();
  if (!state) return [];
  return NIGERIA_LGAS_BY_STATE[state] || [];
}

function sameLocalityValue(previous: unknown, next: unknown): boolean {
  const a = typeof previous === 'string' ? previous : '';
  const b = typeof next === 'string' ? next : '';
  return a === b;
}

/**
 * Which locality keys to wipe after a field changed. Returns {} when nothing
 * relevant moved, so re-selecting the same value never throws away an answer
 * mid-edit, and so the caller can spread the result straight into its formData.
 *
 * A saved row must never read "Onitsha North / Ikeja": the village would then be
 * counted under the wrong locality on every filter and leaderboard.
 */
export function localityResetsFor(
  fieldKey: string,
  formData: Record<string, unknown>,
  nextValue: unknown,
): Record<string, string> {
  if (fieldKey === STATE_OF_ORIGIN_KEY) {
    if (sameLocalityValue(formData[STATE_OF_ORIGIN_KEY], nextValue)) return {};
    return { [LOCAL_GOVERNMENT_KEY]: '', [VILLAGE_KEY]: '' };
  }
  if (fieldKey === LOCAL_GOVERNMENT_KEY) {
    if (sameLocalityValue(formData[LOCAL_GOVERNMENT_KEY], nextValue)) return {};
    return { [VILLAGE_KEY]: '' };
  }
  return {};
}

/** Query for the village list of one LGA. */
export function villagesUrl(state: string, lga: string): string {
  return `${VILLAGES_ENDPOINT}?state=${encodeURIComponent(state)}&lga=${encodeURIComponent(lga)}`;
}

const FALLBACK: VillagesChoice = { mode: 'free_text', villages: [] };

/**
 * Turn whatever the endpoint returned into a picker decision. Anything the shape
 * does not recognise — an error body, a null list, a list of objects — answers
 * free text rather than guessing, because "let them type it" is always a safe
 * reading and the other direction silently hides a real list.
 */
export function parseVillagesResponse(body: unknown): VillagesChoice {
  if (!body || typeof body !== 'object') return { ...FALLBACK };

  const payload = body as Record<string, unknown>;
  if (payload.success !== true) return { ...FALLBACK };
  if (payload.mode !== 'curated') return { ...FALLBACK };

  const raw = payload.villages;
  if (!Array.isArray(raw) || raw.length === 0) return { ...FALLBACK };
  if (!raw.every((name) => typeof name === 'string' && name.trim().length > 0)) {
    return { ...FALLBACK };
  }

  return { mode: 'curated', villages: (raw as string[]).map((name) => name.trim()) };
}
