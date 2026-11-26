// Admin side of the village tier: validation + the four writes into `public.villages`.
//
// The public read (`readVillages` in locality.ts) and this module deliberately do not
// share a data path. That one answers applicants with `mode: 'curated' | 'free_text'` and
// hides retired rows; this one answers an admin with whole rows — including the retired
// ones, because `is_active = false` is meant to be reversible and an admin who cannot see
// what they retired cannot un-retire it.
//
// The field rules mirror the DDL (migration 20272000000000) instead of trusting it:
//   * `CHECK (char_length(btrim(state|lga|name)) > 1)` — a one-character "village" is a
//     keystroke, and it would make a dropdown entry nobody can recognise;
//   * the 80-char ceiling is the same `MAX_LOCALITY_LEN` the public picker and
//     backend/internal/connect/voting/locality.go enforce, so a value that passes here is
//     a value the read paths can actually display;
//   * `UNIQUE (state, lga, name)` — reported as a conflict naming the triple, because the
//     normal cause is pasting a list where two quarters are spelled differently
//     ("Umuasei" vs "Umuasele") and the admin needs to see which one collided.
//
// Every failure carries the field it came from. "Bad request" is not an error message:
// the console prints this sentence in a banner, and a reference-data editor who is told
// `name is required` fixes it in one go.
import { createAdminClient } from '@/lib/supabase/server';
import { MAX_LOCALITY_LEN, normalizeLocality } from './locality';

/** The DDL's `char_length(btrim(x)) > 1`, in words. */
export const MIN_LOCALITY_LEN = 2;

const SELECT_COLUMNS = 'id, state, lga, name, notes, is_active, created_at';

export interface VillageRow {
  id: string;
  state: string;
  lga: string;
  name: string;
  notes: string;
  is_active: boolean;
}

export interface VillageDraft {
  state: string;
  lga: string;
  name: string;
  notes: string;
}

/** Every refusal names its own field, so the console can print it verbatim. */
export type FieldError = { ok: false; status: 400; error: string };

const bad = (error: string): FieldError => ({ ok: false, status: 400, error });

/**
 * Canonicalise one intended row, or say which field is wrong and why.
 *
 * `state`/`lga` come from the request body (they scope the whole batch), `rawName` from
 * either `name` or one element of `names[]`. Nothing here decides whether the LGA is one
 * the reference table knows: `public.villages` has no foreign key, and being able to write
 * the FIRST quarter of an LGA is what makes the table the curation.
 */
export function draftVillage(
  rawState: unknown,
  rawLga: unknown,
  rawName: unknown,
  rawNotes: unknown,
): { ok: true; draft: VillageDraft } | FieldError {
  const state = normalizeLocality(rawState);
  const lga = normalizeLocality(rawLga);
  const name = normalizeLocality(rawName);
  const notes = typeof rawNotes === 'string' ? normalizeLocality(rawNotes) : '';

  if (!state) return bad('state is required.');
  if (state.length < MIN_LOCALITY_LEN) {
    return bad(`state must be at least ${MIN_LOCALITY_LEN} characters.`);
  }
  if (state.length > MAX_LOCALITY_LEN) {
    return bad(`state must be ${MAX_LOCALITY_LEN} characters or fewer.`);
  }

  if (!lga) return bad('lga is required.');
  if (lga.length < MIN_LOCALITY_LEN) {
    return bad(`lga must be at least ${MIN_LOCALITY_LEN} characters.`);
  }
  if (lga.length > MAX_LOCALITY_LEN) {
    return bad(`lga must be ${MAX_LOCALITY_LEN} characters or fewer.`);
  }

  if (!name) return bad('name is required.');
  if (name.length < MIN_LOCALITY_LEN) {
    return bad(`name must be at least ${MIN_LOCALITY_LEN} characters.`);
  }
  if (name.length > MAX_LOCALITY_LEN) {
    return bad(`name must be ${MAX_LOCALITY_LEN} characters or fewer.`);
  }

  return { ok: true, draft: { state, lga, name, notes } };
}

/**
 * Postgres' unique-violation signature, from either the SQLSTATE or the constraint text.
 * Checking both is what the contest-category route does, and it is the difference between
 * a 409 that tells the admin to fix a spelling and a 500 that tells them to file a ticket.
 */
export function isUniqueViolation(error: unknown): boolean {
  const detail = error as { code?: string; message?: string } | null;
  if (!detail || typeof detail !== 'object') return false;
  return detail.code === '23505' || /duplicate key|villages_state_lga_name_key/i.test(detail.message ?? '');
}

export type ReadFailure = { ok: false; status: 500; error: string };

/**
 * The rows an admin curates: `active` narrows to live ones, and leaving it out returns
 * retired rows too on purpose (see the header).
 */
export async function listAdminVillages(query: {
  state: string;
  lga?: string;
  active?: boolean;
}): Promise<{ ok: true; rows: VillageRow[] } | ReadFailure> {
  let queryBuilder = createAdminClient()
    .from('villages')
    .select(SELECT_COLUMNS)
    .eq('state', query.state);

  if (query.lga) queryBuilder = queryBuilder.eq('lga', query.lga);
  if (query.active !== undefined) queryBuilder = queryBuilder.eq('is_active', query.active);

  const { data, error } = await queryBuilder.order('lga').order('name');
  if (error) return { ok: false, status: 500, error: 'village list unavailable.' };

  return { ok: true, rows: (data ?? []) as VillageRow[] };
}

export type WriteFailure = { ok: false; status: 400 | 404 | 409 | 500; error: string };

/**
 * Insert one drafted row.
 *
 * `updated_at` is left to the table's trigger and `id` to its default: naming columns the
 * DDL already owns is how a write starts failing the day someone widens the table.
 */
export async function createVillage(draft: VillageDraft): Promise<{ ok: true; row: VillageRow } | WriteFailure> {
  const { data, error } = await createAdminClient()
    .from('villages')
    .insert({ state: draft.state, lga: draft.lga, name: draft.name, notes: draft.notes })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: `${draft.name} is already curated for ${draft.lga}, ${draft.state}.`,
      };
    }
    // A driver message ("permission denied", a connection failure) never reaches the
    // console banner — but it must not be reported as though the admin typed something
    // wrong either, hence its own sentence rather than a shared "bad request".
    return { ok: false, status: 500, error: 'village could not be saved.' };
  }

  return { ok: true, row: (data ?? { ...draft, id: '', is_active: true }) as VillageRow };
}

/** Only the fields a patch may change: a row's state/lga are its identity, so moving a
 * quarter between LGAs is a delete plus a create, not a rename. */
export interface VillagePatch {
  name?: string;
  notes?: string;
  active?: boolean;
}

export function draftPatch(patch: VillagePatch): { ok: true; write: Record<string, string | boolean> } | FieldError {
  const write: Record<string, string | boolean> = {};

  if (patch.name !== undefined) {
    const name = normalizeLocality(patch.name);
    if (!name) return bad('name cannot be empty.');
    if (name.length < MIN_LOCALITY_LEN) {
      return bad(`name must be at least ${MIN_LOCALITY_LEN} characters.`);
    }
    if (name.length > MAX_LOCALITY_LEN) {
      return bad(`name must be ${MAX_LOCALITY_LEN} characters or fewer.`);
    }
    write.name = name;
  }

  if (patch.notes !== undefined) write.notes = normalizeLocality(patch.notes);
  if (patch.active !== undefined) write.is_active = Boolean(patch.active);

  if (Object.keys(write).length === 0) {
    return bad('Nothing to change: send name, notes, or active.');
  }

  return { ok: true, write };
}

/**
 * Apply a patch to one row by id.
 *
 * The row is read first: Supabase's update returns no rows when the id matched nothing, so
 * without the check a typo'd id would look like a retired quarter rather than the request it
 * is — and the caller would be told "village not found" only if they guessed.
 */
export async function updateVillage(
  id: string,
  write: Record<string, string | boolean>,
): Promise<{ ok: true; row: VillageRow } | WriteFailure> {
  const existing = await createAdminClient()
    .from('villages')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (existing.error) return { ok: false, status: 500, error: 'village could not be loaded.' };
  if (!existing.data) return { ok: false, status: 404, error: 'village not found.' };

  const { data, error } = await createAdminClient()
    .from('villages')
    .update(write)
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const label = typeof write.name === 'string' ? write.name : String(existing.data.name);
      return {
        ok: false,
        status: 409,
        error: `${label} is already curated for ${existing.data.lga}, ${existing.data.state}.`,
      };
    }
    return { ok: false, status: 500, error: 'village could not be saved.' };
  }

  return { ok: true, row: (data ?? existing.data) as VillageRow };
}

/** Hard delete. Retiring (`active: false`) is the normal move — this is for a row that was
 * never real (a typo, a duplicate spelling of a quarter that exists under its other name). */
export async function deleteVillage(
  id: string,
): Promise<{ ok: true; removed: boolean } | { ok: false; status: 500; error: string }> {
  const { data, error } = await createAdminClient()
    .from('villages')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: 'village could not be deleted.' };
  return { ok: true, removed: Boolean(data) };
}

/**
 * Publish a pasted list of quarters, one insert each.
 *
 * Per-name answers are the point: an admin pasting the 15 Onitsha North list into a table
 * that already holds two of them needs to be told which two, and that the other 13 are
 * live. That is why this is not one batch insert — a batch either all-succeeds or all-fails,
 * and "all-fails" would hide the 13 rows that were perfectly good.
 *
 * A 409 becomes a `skipped` entry (it is the admin's data to reconcile). Anything worse
 * aborts the batch: a database problem reported as "these names were rejected" would send
 * them off editing a list that was never the issue.
 */
export interface BulkOutcome {
  status: number;
  created: VillageRow[];
  skipped: { name: string; reason: string }[];
  error?: string;
}

export async function createVillagesBulk(
  rawState: unknown,
  rawLga: unknown,
  rawNames: readonly unknown[],
  rawNotes: unknown,
): Promise<BulkOutcome> {
  const created: VillageRow[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let conflict: string | null = null;

  for (const rawName of rawNames) {
    const drafted = draftVillage(rawState, rawLga, rawName, rawNotes);
    if (!drafted.ok) {
      skipped.push({ name: normalizeLocality(rawName), reason: drafted.error });
      continue;
    }

    const result = await createVillage(drafted.draft);
    if (result.ok) {
      created.push(result.row);
      continue;
    }
    if (result.status === 409) {
      skipped.push({ name: drafted.draft.name, reason: result.error });
      conflict = result.error;
      continue;
    }
    return {
      status: result.status,
      created,
      skipped,
      error: `${result.error} ${created.length} of ${rawNames.length} published before it stopped.`,
    };
  }

  if (created.length > 0) return { status: 201, created, skipped };
  if (skipped.length === 0) {
    return { status: 400, created, skipped, error: 'names is empty — nothing to publish.' };
  }
  return {
    status: conflict ? 409 : 400,
    created,
    skipped,
    error: conflict ?? skipped[0].reason,
  };
}
