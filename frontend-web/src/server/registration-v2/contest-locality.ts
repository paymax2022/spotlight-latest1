// The write boundary for contest locality — the place that decides what a
// "local contest" is allowed to claim.
//
// WHY IT LIVES HERE AND NOT IN A CHECK CONSTRAINT
// 20272000000000 deliberately added no CHECK on public.contests.location_scope:
// a constraint would make that migration refuse to replay on any environment
// holding a value outside the list, and `supabase db push` has to be replayable.
// The trade is that the vocabulary is only as strict as this file, so both admin
// contest routes route their locality handling through it and answer the same
// 400 for the same mistake.
//
// WHAT IT DOES NOT DO
// It never checks a value against the curated village list. public.villages is
// partial by design (only the LGAs a human has named carry rows), and locality is
// display + filter — an admin describing a quarter the catalogue has not seen yet
// is doing the job this table exists to grow from, not submitting an error.
import { MAX_LOCALITY_LEN, normalizeLocality } from './locality';

/** The scopes that claim a locality, and therefore must supply one. */
export const LOCALITY_SCOPES = ['lga', 'village'] as const;

export const LOCALITY_ERRORS = {
  stateRequired: 'A local contest needs its state.',
  lgaRequired: 'A local contest needs its local government (LGA).',
  villageRequired: 'A village contest needs its village.',
  tooLong: `Locality values must be ${MAX_LOCALITY_LEN} characters or fewer.`,
} as const;

export interface ContestLocality {
  localityState: string;
  localityLga: string;
  localityVillage: string;
}

const NOTHING: ContestLocality = { localityState: '', localityLga: '', localityVillage: '' };

export type LocalityOutcome =
  | { ok: true; locality: ContestLocality }
  | { ok: false; error: string };

/**
 * Turn an admin payload's locality fields into the three columns.
 *
 * A non-local scope is not an error and not "leave it alone": it is a clearing.
 * Lowering a village contest to national must not leave a locality behind on a
 * contest that no longer claims it, or the roster filters keep listing it.
 */
export function contestLocalityFor(scope: unknown, body: Record<string, unknown>): LocalityOutcome {
  const localityScope = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  if (!LOCALITY_SCOPES.includes(localityScope as (typeof LOCALITY_SCOPES)[number])) {
    return { ok: true, locality: { ...NOTHING } };
  }

  const state = normalizeLocality(body.localityState);
  const lga = normalizeLocality(body.localityLga);
  const village = localityScope === 'village' ? normalizeLocality(body.localityVillage) : '';

  for (const value of [state, lga, village]) {
    if (value.length > MAX_LOCALITY_LEN) return { ok: false, error: LOCALITY_ERRORS.tooLong };
  }

  if (!state) return { ok: false, error: LOCALITY_ERRORS.stateRequired };
  if (!lga) return { ok: false, error: LOCALITY_ERRORS.lgaRequired };
  if (localityScope === 'village' && !village) return { ok: false, error: LOCALITY_ERRORS.villageRequired };

  return { ok: true, locality: { localityState: state, localityLga: lga, localityVillage: village } };
}

/**
 * True for the messages this module produces. The PATCH route maps thrown domain
 * errors to a 400 by EXACT string — never by substring, which used to catch a
 * PostgREST message and echo it to the console — so it needs the set, not a guess.
 */
export function isContestLocalityError(message: string): boolean {
  return (Object.values(LOCALITY_ERRORS) as string[]).includes(message);
}
