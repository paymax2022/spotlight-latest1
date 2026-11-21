// The location answers the song hand-in form needs, read from the app's own
// canonical Nigeria dataset.
//
// `frontend-web` keeps its own Open Mic LGA table
// (`src/features/openmic/location-options.ts`); this app already ships a states
// list with LGAs per state (`src/data/nigeria.ts`), which every registration
// city cascade uses. Re-declaring a second table here would only create a way for
// the two to disagree, so the single source stays `@/data/nigeria`.
//
// The server requires `country`, `state` and `lga` to be non-empty and does not
// enforce select membership (`createSubmission` trims and stores), so a value
// spelled slightly differently between surfaces still submits — the select is
// there to keep the answer consistent, not to gate it.
//
// Pure module: no `expo`, no `react-native`, so `node --test` can exercise it.

import { NIGERIA_STATES } from '@/data/nigeria';

/** Open Mic is a Nigerian edition; the web form offers exactly one country. */
export const OPEN_MIC_COUNTRY = 'Nigeria';

/** State names in dataset order, for the hand-in form's state select. */
export const STATE_OPTIONS: string[] = NIGERIA_STATES.map((state) => state.name);

const LGAS_BY_STATE = new Map<string, string[]>(NIGERIA_STATES.map((state) => [state.name, state.lgas]));

/** The dataset's own spelling of a state, or '' when the value is unknown. */
export function knownStateName(state: string | null | undefined): string {
  const name = String(state ?? '').trim();
  if (!name) return '';
  return LGAS_BY_STATE.has(name) ? name : '';
}

/**
 * LGAs for a state. Unknown or blank state yields [] so the LGA select can say
 * "select your state first" rather than pretend the list finished loading.
 */
export function lgasForState(state: string | null | undefined): string[] {
  const name = knownStateName(state);
  if (!name) return [];
  return LGAS_BY_STATE.get(name) ?? [];
}
