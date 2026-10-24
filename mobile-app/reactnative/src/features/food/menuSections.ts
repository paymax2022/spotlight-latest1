import type { MenuSection, RestaurantDetail } from './types';

/**
 * Sections to render on the store page: taxonomy sections when the server sent
 * any, else the legacy per-restaurant menu categories. Empty sections are dropped.
 */
export function sectionsForDisplay(detail: RestaurantDetail): MenuSection[] {
  const fromTaxonomy = detail.sections ?? [];
  const source: MenuSection[] =
    fromTaxonomy.length > 0
      ? fromTaxonomy
      : (detail.menu ?? []).map((c) => ({ id: c.id, name: c.name, items: c.items }));
  return source.filter((s) => s.items.length > 0);
}
