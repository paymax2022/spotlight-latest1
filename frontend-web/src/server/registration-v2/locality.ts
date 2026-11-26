// The village tier of the state -> local government -> village cascade.
//
// Two halves live here, and the split is the point:
//
//   * the LGA list is static reference data (reference-data.ts) and needs no
//     server, exactly like the residence -> city picker;
//   * the VILLAGE list is curated content owned by admins, stored in
//     `public.villages` (migration 20272000000000). It is never bundled into the
//     app — publishing a quarter an admin added must not require a redeploy — so
//     the web wizard and the phone app read the same table through the same
//     shape: { state, lga, mode, villages[] }.
//
// `mode` is the contract that keeps the feature honest. An LGA with rows answers
// `curated`; an LGA without them answers `free_text` with an empty list and a
// 200, NOT a 404 and not an invented set of names. Locality is a display + filter
// concern, so a gap in the curated data degrades the input to a text box instead
// of blocking an application.
//
// The 80-char ceiling mirrors the two other doors the same value comes through:
// `maxLocalityLen` in backend/internal/connect/voting/locality.go and the
// boundary checks in the villages table. Rejecting here means an absurd string
// never reaches Postgres at all.
import { createAdminClient } from '@/lib/supabase/server';

export const MAX_LOCALITY_LEN = 80;

export type VillageMode = 'curated' | 'free_text';

export interface VillagesPayload {
  state: string;
  lga: string;
  mode: VillageMode;
  /** Always an array — the picker maps over it, so an absent list is [] not null. */
  villages: string[];
}

export interface LocalityArgs {
  state: string;
  lga: string;
  /** Set when the pair cannot be used; names the offending field. */
  error?: string;
}

export function normalizeLocality(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Newlines and tabs arrive from pasted values and from a query string that was
  // split on & — none of them are part of a place name.
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Validate + canonicalise the ?state=&lga= pair. Deliberately does not decide
 * whether the state exists or has LGAs — that would turn a data gap into an
 * error, and the whole point of `free_text` is that gaps stay usable.
 */
export function localityArgs(rawState: unknown, rawLga: unknown): LocalityArgs {
  const state = normalizeLocality(rawState);
  const lga = normalizeLocality(rawLga);

  if (!state) return { state, lga, error: 'state is required.' };
  if (state.length > MAX_LOCALITY_LEN) {
    return { state, lga, error: `state must be ${MAX_LOCALITY_LEN} characters or fewer.` };
  }
  if (!lga) return { state, lga, error: 'lga is required.' };
  if (lga.length > MAX_LOCALITY_LEN) {
    return { state, lga, error: `lga must be ${MAX_LOCALITY_LEN} characters or fewer.` };
  }
  return { state, lga };
}

/**
 * Shape the query result for the wire. Empty list => `free_text`, so callers get
 * an instruction ("type it") rather than a dropdown with nothing in it.
 */
export function villagesPayload(
  state: string,
  lga: string,
  names: readonly string[],
): VillagesPayload {
  const villages = names
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.replace(/[\r\n\t]+/g, ' ').trim())
    .filter(Boolean);

  return {
    state,
    lga,
    mode: villages.length > 0 ? 'curated' : 'free_text',
    villages,
  };
}

export type VillagesResult =
  | { ok: true; payload: VillagesPayload }
  | { ok: false; status: 400 | 500; error: string };

type VillageRow = { name: string };

/**
 * Read the curated villages for one LGA. Inactive rows are excluded here rather
 * than trusted to RLS: the admin client bypasses policies, and "retired" has to
 * mean invisible to both this route and Go's /connect/villages.
 */
export async function readVillages(rawState: unknown, rawLga: unknown): Promise<VillagesResult> {
  const args = localityArgs(rawState, rawLga);
  if (args.error) return { ok: false, status: 400, error: args.error };

  const { data, error } = await createAdminClient()
    .from('villages')
    .select('name')
    .eq('state', args.state)
    .eq('lga', args.lga)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    // No detail from the driver leaks out: the message reaches an applicant's
    // browser, and a table name or an RLS denial helps nobody on that screen.
    return { ok: false, status: 500, error: 'village list unavailable.' };
  }

  return {
    ok: true,
    payload: villagesPayload(args.state, args.lga, (data ?? []).map((row) => row.name)),
  };
}
