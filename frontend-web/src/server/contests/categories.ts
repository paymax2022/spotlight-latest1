// Contest categories — the admin-managed replacement for the hardcoded
// `allowedCategories` consts that gated contest create/update.
//
// contests.category is plain TEXT with no CHECK constraint, so this list is the
// only thing deciding which categories exist. It is read on every contest
// create/update, hence the deliberate fallback below.

import { createAdminClient } from '@/lib/supabase/server';

export interface ContestCategoryRow {
  slug: string;
  label: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
}

/**
 * The eleven that were hardcoded before this table existed. Kept as the
 * fallback for one reason: if the categories query fails, refusing every
 * contest create/update would turn a read blip into an outage of the whole
 * contest console. Falling back to what the code enforced last week is strictly
 * no worse than the previous behaviour, and never widens what is accepted.
 */
export const FALLBACK_CATEGORY_SLUGS = [
  'music', 'acting', 'comedy_content', 'dance', 'film_production',
  'stem_innovation', 'sme_pitch', 'school_campus', 'open_mic',
  'general_reality_show', 'other',
] as const;

interface RawRow {
  slug: string;
  label: string;
  description: string | null;
  active: boolean;
  sort_order: number;
}

function toRow(r: RawRow): ContestCategoryRow {
  return {
    slug: r.slug,
    label: r.label,
    description: r.description,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

/** Every category, active first by sort order. Admin console listing. */
export async function listContestCategories(): Promise<ContestCategoryRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('contest_categories')
    .select('slug,label,description,active,sort_order')
    .order('sort_order', { ascending: true })
    .order('slug', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toRow(r as RawRow));
}

/**
 * The slugs a contest may be filed under. Active only — deactivating a category
 * stops new use without touching contests already filed under it.
 */
export async function allowedCategorySlugs(): Promise<string[]> {
  try {
    const rows = await listContestCategories();
    const active = rows.filter((r) => r.active).map((r) => r.slug);
    // An empty table would otherwise reject every contest. Treat "no categories
    // configured" as "the ones that were hardcoded", never as "none allowed".
    return active.length > 0 ? active : [...FALLBACK_CATEGORY_SLUGS];
  } catch {
    return [...FALLBACK_CATEGORY_SLUGS];
  }
}

export async function getContestCategory(slug: string): Promise<ContestCategoryRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('contest_categories')
    .select('slug,label,description,active,sort_order')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRow(data as RawRow) : null;
}

export async function createContestCategory(input: {
  slug: string;
  label: string;
  description?: string | null;
  sortOrder?: number;
}): Promise<ContestCategoryRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('contest_categories')
    .insert({
      slug: input.slug,
      label: input.label,
      description: input.description ?? null,
      sort_order: input.sortOrder ?? 0,
    })
    .select('slug,label,description,active,sort_order')
    .single();
  if (error) throw new Error(error.message);
  return toRow(data as RawRow);
}

export async function updateContestCategory(
  slug: string,
  patch: { label?: string; description?: string | null; active?: boolean; sortOrder?: number },
): Promise<ContestCategoryRow> {
  const supabase = createAdminClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;

  const { data, error } = await supabase
    .from('contest_categories')
    .update(row)
    .eq('slug', slug)
    .select('slug,label,description,active,sort_order')
    .single();
  if (error) throw new Error(error.message);
  return toRow(data as RawRow);
}

/**
 * The display label to store on a contest, or null when the slug is not a
 * managed category.
 *
 * contests.category holds a HUMAN LABEL, not the slug — see CATEGORY_LABEL in
 * registration-v2/contest-store.ts, whose `?? 'Other'` fallback is why a
 * contest created under an admin-made category silently landed in "Other".
 */
export async function resolveCategoryLabel(slug: string): Promise<string | null> {
  try {
    const row = await getContestCategory(slug);
    return row ? row.label : null;
  } catch {
    return null;
  }
}

/**
 * How many contests are filed under a category. Deleting one that is in use
 * would leave those contests pointing at a category that no longer exists and
 * uneditable (their category would fail validation), so the route refuses and
 * offers deactivation instead.
 *
 * Matches on the LABEL as well as the slug because that is what the column
 * actually stores. Caveat worth knowing: renaming a category does not rewrite
 * the contests already filed under the old label, so a count taken after a
 * rename can miss them. Deactivation, not deletion, is the safe operation.
 */
export async function contestCountForCategory(slug: string): Promise<number> {
  const supabase = createAdminClient();
  const label = await resolveCategoryLabel(slug);
  const values = label && label !== slug ? [slug, label] : [slug];
  const { count, error } = await supabase
    .from('contests')
    .select('id', { count: 'exact', head: true })
    .in('category', values);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function deleteContestCategory(slug: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('contest_categories').delete().eq('slug', slug);
  if (error) throw new Error(error.message);
}

/** Same slug rule the contest routes use, so a category slug is a valid category value. */
export function toCategorySlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
