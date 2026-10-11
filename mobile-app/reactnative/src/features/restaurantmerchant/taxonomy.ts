// Owner add-item form logic for the admin-managed menu taxonomy. Pure: no React,
// no network. The server re-checks everything; this only keeps the form honest.

export interface TaxonomyChild {
  id: string;
  name: string;
  slug: string;
}

export interface TaxonomyCategory {
  id: string;
  name: string;
  slug: string;
  kind: 'FOOD' | 'DRINK' | 'OTHER';
  children: TaxonomyChild[];
}

export interface ItemDraft {
  categoryId: string | null;
  subcategoryId: string | null;
  name: string;
  priceNaira: string;
}

export type ItemDraftErrors = Partial<Record<'category' | 'subcategory' | 'name' | 'price', string>>;

export interface TaxonomyItemPayload {
  taxonomyCategoryId: string;
  taxonomySubcategoryId: string | null;
  name: string;
  priceKobo: number;
}

// Active only, and only the categories an owner may pick: inactive rows are hidden
// by the server, but guard here too.
export function pickableCategories(tree: TaxonomyCategory[]): TaxonomyCategory[] {
  return tree.filter((c) => c && c.id);
}

// Sub-categories depend on the chosen category. A sub from another category is not
// offered, so the form cannot produce a mismatch.
export function subcategoriesFor(tree: TaxonomyCategory[], categoryId: string | null): TaxonomyChild[] {
  if (!categoryId) return [];
  return tree.find((c) => c.id === categoryId)?.children ?? [];
}

// Naira typed as text to kobo as an integer. Parsed as text, never through a float,
// so "350.5" is exactly 35050 kobo and "0.1" is 10.
export function nairaToKobo(input: string): number | null {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const naira = Number(m[1]);
  const kobo = Number((m[2] ?? '').padEnd(2, '0'));
  const total = naira * 100 + kobo;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export function validateItemDraft(
  d: ItemDraft,
  tree: TaxonomyCategory[],
): { ok: true; payload: TaxonomyItemPayload } | { ok: false; errors: ItemDraftErrors } {
  const errors: ItemDraftErrors = {};
  const cats = pickableCategories(tree);
  if (!d.categoryId || !cats.some((c) => c.id === d.categoryId)) {
    errors.category = 'Choose a category.';
  }
  if (d.subcategoryId) {
    const subs = subcategoriesFor(tree, d.categoryId);
    if (!subs.some((s) => s.id === d.subcategoryId)) {
      errors.subcategory = 'Choose a sub-category under the category you picked.';
    }
  }
  const name = d.name.trim();
  if (!name) errors.name = 'Enter the item name.';
  else if (name.length > 200) errors.name = 'Keep the name under 200 characters.';
  const priceKobo = nairaToKobo(d.priceNaira);
  if (priceKobo === null) errors.price = 'Enter a price in naira, more than zero (e.g. 2500 or 2500.50).';

  if (Object.keys(errors).length > 0 || !d.categoryId || priceKobo === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    payload: {
      taxonomyCategoryId: d.categoryId,
      taxonomySubcategoryId: d.subcategoryId ?? null,
      name,
      priceKobo,
    },
  };
}
