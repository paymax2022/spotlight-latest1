// ── Registration — city ↔ state cascade ──────────────────────────────────────
// The registration form schema ships city selects (account.city, personal.city,
// emergency.city) with EMPTY options — they are meant to cascade off the sibling
// state field, which was never wired, so the city dropdown rendered blank
// ("city is not fetched"). We resolve the options client-side from the selected
// state using the app's canonical Nigeria dataset (states → LGAs). The server
// leaves these options empty, so its select-membership validation is skipped and
// accepts whatever city string we submit (see validation.ts) — no server change
// or client/server list-mismatch.

import { NIGERIA_STATES } from '@/data/nigeria';
import type { RegistrationField } from '../types/registration.types';

// city field key → the field key holding its parent state.
const CITY_TO_STATE: Record<string, string> = {
  'account.city': 'account.state',
  'personal.city': 'personal.stateOfResidence',
  'emergency.city': 'emergency.state',
};

const STATE_TO_CITY: Record<string, string> = Object.fromEntries(
  Object.entries(CITY_TO_STATE).map(([city, state]) => [state, city]),
);

const STATE_LGAS = new Map<string, string[]>(NIGERIA_STATES.map((s) => [s.name, s.lgas]));

// The state dropdown options come from the server's state list, whose FCT label
// ("FCT Abuja") differs from this dataset's key ("FCT - Abuja"). Alias it so the
// selected value resolves to the right LGAs (and matches the server's city list).
const STATE_ALIAS: Record<string, string> = { 'FCT Abuja': 'FCT - Abuja' };

/** LGAs / cities for a state name (empty when unknown/blank). */
export function citiesForState(state?: unknown): string[] {
  const name = String(state ?? '').trim();
  if (!name) return [];
  return STATE_LGAS.get(STATE_ALIAS[name] ?? name) ?? [];
}

/** If `stateKey` is a state field that a city cascades from, return that city key. */
export function dependentCityKey(stateKey: string): string | undefined {
  return STATE_TO_CITY[stateKey];
}

/**
 * For a city field, return the same field with its `options` populated from the
 * currently-selected sibling state (and a helpful placeholder). Non-city fields
 * pass through unchanged. `valueFor` reads the live form value for any key.
 */
export function withCityOptions(
  field: RegistrationField,
  valueFor: (key: string) => unknown,
): RegistrationField {
  const stateKey = CITY_TO_STATE[field.key];
  if (!stateKey) return field;
  const state = String(valueFor(stateKey) ?? '').trim();
  return {
    ...field,
    options: citiesForState(state),
    placeholder: state ? 'Select a city / town' : 'Select your state first',
  };
}
