// ── Film Academy — which areas a batch offers ────────────────────────────────
// The catalogue and its prices live in academy_interest_areas; a batch only
// chooses WHICH of them it offers.
//
// NO ROWS MEANS UNRESTRICTED — the batch offers every active area. That makes
// an empty selection a deliberate, safe state rather than a missing one, and it
// is why batches created before this feature keep working untouched.

type SupabaseLike = {
  from: (table: string) => any;
};

/** The slugs a batch offers. Empty array = unrestricted, NOT "offers nothing". */
export async function getBatchAreaSlugs(
  supabase: SupabaseLike,
  batchId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('academy_batch_interest_areas')
    .select('area_slug')
    .eq('batch_id', batchId);
  return (data ?? []).map((r: { area_slug: string }) => String(r.area_slug));
}

/**
 * Replace a batch's offered areas with exactly `slugs`.
 *
 * Delete-then-insert, deliberately: a merge would make REMOVING an area
 * impossible, so the stored set could only ever grow.
 *
 * Passing a non-array (i.e. the field was absent from the request) leaves the
 * selection alone — an edit that does not mention areas must not wipe them.
 *
 * Unknown slugs are dropped rather than inserted. The foreign key would reject
 * them anyway, and failing the whole save over one stale checkbox would lose the
 * admin's other edits.
 */
export async function replaceBatchAreas(
  supabase: SupabaseLike,
  batchId: string,
  slugs: unknown,
): Promise<void> {
  if (!Array.isArray(slugs)) return;

  const wanted = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))];

  const { data: known } = await supabase
    .from('academy_interest_areas')
    .select('slug')
    .in('slug', wanted.length ? wanted : ['__none__']);
  const valid = new Set((known ?? []).map((r: { slug: string }) => String(r.slug)));

  const { error: delError } = await supabase
    .from('academy_batch_interest_areas')
    .delete()
    .eq('batch_id', batchId);
  if (delError) {
    logAreaError('clearing the previous selection', delError);
    throw new Error('Could not update the areas this batch offers');
  }

  const rows = wanted.filter((s) => valid.has(s)).map((slug) => ({ batch_id: batchId, area_slug: slug }));
  if (rows.length > 0) {
    const { error: insError } = await supabase
      .from('academy_batch_interest_areas')
      .insert(rows);
    // The delete has already run. Swallowing this would leave the batch with NO
    // rows — which MEANS UNRESTRICTED — so a failed save would silently widen
    // what the batch offers instead of failing. Surface it.
    if (insError) {
      logAreaError('saving the new selection', insError);
      throw new Error('Could not save the areas this batch offers');
    }
  }
}

/** Detail to the server log; the thrown message is what the caller shows. */
function logAreaError(where: string, error: unknown): void {
  const e = error as { message?: string; code?: string; details?: string } | null;
  console.error(`[batchAreas] ${where} failed`, {
    code: e?.code, message: e?.message, details: e?.details,
  });
}
