// ── Marketplace category tree ────────────────────────────────────────────────
// The API returns categories as a FLAT list (one row per category, parents and
// children together, parents first). These helpers give the screens the two
// shapes they actually render — the 12 mains, and one main's subcategories —
// without every screen re-deriving the relationship and drifting on the answer.
//
// Ordering is the admin's `sortOrder`, then name. The server already sorts, but
// sorting here too means a client that merges a cached page with a fresh one
// cannot end up showing Vehicles after Agriculture.

import type { Category } from './types';

/** Sort by the admin's order, then name — matching the API's own ORDER BY. */
function byOrder(a: Category, b: Category): number {
  const ao = a.sortOrder ?? 0;
  const bo = b.sortOrder ?? 0;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name);
}

/**
 * The main (top-level) categories — the 12 tiles on the marketplace home.
 *
 * A category is main when it has no parent. Guarding on `!parentId` rather than
 * `parentId === null` matters: the API omits the field entirely for a root, so a
 * strict null check would return nothing at all.
 */
export function mainCategories(all: Category[] | undefined): Category[] {
  return (all ?? []).filter((c) => !c.parentId).sort(byOrder);
}

/** The subcategories directly under one main. Empty for a leaf. */
export function subcategoriesOf(all: Category[] | undefined, parentId: string): Category[] {
  return (all ?? []).filter((c) => c.parentId === parentId).sort(byOrder);
}

/**
 * Every category id at or beneath `rootId`.
 *
 * Browsing a main must show the listings filed under its children too — a
 * listing lives in "Cars", not in "Vehicles", so filtering on the main's own id
 * alone would show an empty Vehicles page while 40 cars sit one level down.
 */
export function categoryIdsUnder(all: Category[] | undefined, rootId: string): string[] {
  const list = all ?? [];
  const out = [rootId];
  // One level is all the taxonomy has today; the loop still handles deeper
  // nesting so adding a third level later does not silently drop listings.
  let frontier = [rootId];
  while (frontier.length > 0) {
    const next = list.filter((c) => c.parentId && frontier.includes(c.parentId)).map((c) => c.id);
    const fresh = next.filter((id) => !out.includes(id));
    out.push(...fresh);
    frontier = fresh;
  }
  return out;
}

/** The chain from a category up to its main, e.g. [Vehicles, Cars]. */
export function breadcrumb(all: Category[] | undefined, id: string): Category[] {
  const list = all ?? [];
  const chain: Category[] = [];
  let cursor = list.find((c) => c.id === id);
  // Bounded by the list length so a cycle in the data cannot hang the screen.
  let guard = list.length + 1;
  while (cursor && guard-- > 0) {
    chain.unshift(cursor);
    cursor = cursor.parentId ? list.find((c) => c.id === cursor!.parentId) : undefined;
  }
  return chain;
}
