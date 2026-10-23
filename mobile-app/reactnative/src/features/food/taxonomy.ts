// Customer-facing menu taxonomy (categories tree + cuisines). The routes 404
// when the backend feature flag is off, so getTaxonomy() never throws: callers
// treat `null` as "taxonomy browsing unavailable" and keep the legacy UI.

import type { CuisineRef, TaxonomyCategory } from './types';

export interface Taxonomy {
  categories: TaxonomyCategory[];
  cuisines: CuisineRef[];
}

type Raw = Record<string, unknown>;
const asRaw = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rows = (v: unknown): unknown[] => {
  const d = Array.isArray(v) ? v : asRaw(v).data;
  return Array.isArray(d) ? d : [];
};

function mapNode(input: unknown): TaxonomyCategory | null {
  const r = asRaw(input);
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    name: str(r.name),
    slug: str(r.slug),
    icon: typeof r.icon === 'string' && r.icon ? r.icon : null,
    sortOrder: num(r.sort_order),
    children: mapNodes(r.children),
  };
}

function mapNodes(input: unknown): TaxonomyCategory[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(mapNode)
    .filter((n): n is TaxonomyCategory => n !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function mapTaxonomy(categoriesBody: unknown, cuisinesBody: unknown): Taxonomy {
  const cuisines = rows(cuisinesBody)
    .map((c) => {
      const r = asRaw(c);
      return { ref: { id: str(r.id), slug: str(r.slug), name: str(r.name) }, order: num(r.sort_order) };
    })
    .filter((c) => c.ref.id)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.ref);
  return { categories: mapNodes(rows(categoriesBody)), cuisines };
}

/** `null` on 404 / network error / flag off / mock mode. Never throws. */
export async function getTaxonomy(): Promise<Taxonomy | null> {
  try {
    // Lazy so the pure mappers above stay importable from node:test specs.
    const { USE_MOCK, RESTAURANT_BASE } = await import('./api');
    if (USE_MOCK) return null;
    const { api } = await import('@/api/client');
    const [cats, cuis] = await Promise.allSettled([
      api.get(`${RESTAURANT_BASE}/menu-taxonomy/browse/categories`),
      api.get(`${RESTAURANT_BASE}/menu-taxonomy/browse/cuisines`),
    ]);
    if (cats.status === 'rejected' || cuis.status === 'rejected') return null;
    return mapTaxonomy(cats.value.data, cuis.value.data);
  } catch {
    return null;
  }
}
