import type { TaxonomyCategory, CuisineRef } from './types';

interface TaxonomyLike {
  categories: TaxonomyCategory[];
  cuisines: CuisineRef[];
}

/**
 * Selected ids that are actually offered by the current taxonomy. A null
 * taxonomy (flag off / call failed) or an id the taxonomy no longer lists
 * yields nothing, so a hidden or stale selection can never filter the list.
 */
export function effectiveTaxonomyIds(
  selected: string[],
  taxonomy: TaxonomyLike | null,
  kind: 'cuisines' | 'categories',
): string[] {
  if (!taxonomy) return [];
  const present = new Set<string>(
    (kind === 'cuisines' ? taxonomy.cuisines : taxonomy.categories)?.map((x) => x.id) ?? [],
  );
  return selected.filter((id) => present.has(id));
}
