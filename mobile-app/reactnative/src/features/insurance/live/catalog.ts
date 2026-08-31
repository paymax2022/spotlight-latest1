// ── Insurance (live) — category presentation ────────────────────────────────
// PURE (icon *names* only, no component imports) so it loads under `node --test`.
//
// These are the SEVEN real MyCover categories, verified against the live catalog
// (68 products: Life 15, Auto 14, Health 12, Content 10, Gadget 10, Package 6,
// Travel 1). Counts are NOT hardcoded anywhere in the UI — they are computed
// from whatever the live catalog returns, so the browse screen stays honest if
// the aggregator adds or retires a product. The metadata below is presentation
// only: title, blurb, lucide icon name, tone.

import type { ProductLine } from './types';

export type Tone = 'brand' | 'accent' | 'teal' | 'gold' | 'green' | 'red' | 'purple';

export interface CategoryMeta {
  line: ProductLine;
  label: string;
  /** One line under the tile — what a person actually protects with this. */
  blurb: string;
  /** Longer copy for the category header on the browse screen. */
  description: string;
  icon: string; // lucide-react-native export name
  tone: Tone;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    line: 'health',
    label: 'Health',
    blurb: 'Hospital, surgery & HMO cover',
    description: 'Hospital cash, surgery and outpatient plans from licensed HMOs and insurers.',
    icon: 'HeartPulse',
    tone: 'red',
  },
  {
    line: 'auto',
    label: 'Motor',
    blurb: 'Third-party & comprehensive',
    description: 'Third-party, third-party-plus and comprehensive motor cover for your vehicle.',
    icon: 'Car',
    tone: 'accent',
  },
  {
    line: 'life',
    label: 'Life & Personal',
    blurb: 'Life, credit life & accident',
    description: 'Life, credit-life and personal-accident cover for you and the people who depend on you.',
    icon: 'ShieldPlus',
    tone: 'brand',
  },
  {
    line: 'gadget',
    label: 'Gadget',
    blurb: 'Phone, laptop & devices',
    description: 'Theft, damage and screen cover for phones, laptops and tablets.',
    icon: 'Smartphone',
    tone: 'purple',
  },
  {
    line: 'content',
    label: 'Home & Content',
    blurb: 'Home, office & stock',
    description: 'Householder, homeowner, office content and inventory-burglary cover.',
    icon: 'Home',
    tone: 'teal',
  },
  {
    line: 'package',
    label: 'Business & Goods',
    blurb: 'Goods in transit & marine',
    description: 'Goods-in-transit, cash-in-transit and marine cargo cover for businesses.',
    icon: 'Truck',
    tone: 'gold',
  },
  {
    line: 'travel',
    label: 'Travel',
    blurb: 'Trip & travel accident',
    description: 'Travel accident and trip cover for journeys inside and outside Nigeria.',
    icon: 'Plane',
    tone: 'green',
  },
];

const BY_LINE: Record<string, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.line, c]),
);

export function categoryMeta(line: string | null | undefined): CategoryMeta {
  return (
    BY_LINE[String(line ?? '').toLowerCase()] ?? {
      line: 'package' as ProductLine,
      label: 'Cover',
      blurb: 'Protection',
      description: 'Protection products.',
      icon: 'ShieldCheck',
      tone: 'brand' as Tone,
    }
  );
}

export function categoryLabel(line: string | null | undefined): string {
  return categoryMeta(line).label;
}

/** Count products per line from a live catalog list — never a hardcoded number. */
export function countByLine(
  products: { productLine: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CATEGORIES) out[c.line] = 0;
  for (const p of products) {
    const key = String(p.productLine ?? '').toLowerCase();
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Search + filter for the browse screen. Matches product name, underwriter and
 * description so "Leadway" or "hospicash" both find something.
 */
export function filterProducts<T extends {
  name: string;
  description: string;
  underwriter: string;
  productLine: string;
  active: boolean;
}>(products: T[], opts: { line?: string | null; query?: string | null }): T[] {
  const line = opts.line ? String(opts.line).toLowerCase() : null;
  const q = (opts.query ?? '').trim().toLowerCase();
  return products.filter((p) => {
    if (!p.active) return false;
    if (line && String(p.productLine).toLowerCase() !== line) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.underwriter.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });
}
