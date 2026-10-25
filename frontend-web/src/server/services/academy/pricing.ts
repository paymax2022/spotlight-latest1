// The composite Film Academy tuition structure: every area of interest is
// offered in five formats, and the same five prices apply to all areas.
// Mirrors supabase/migrations/20271043000000_academy_area_pricing_options.sql.
// This module is the single source for: seeding an area's option rows, the
// admin's label/price editor, and validating + pricing an applicant's format.

export const ACADEMY_PRICING_KEYS = [
  'weekend_day',
  'weekend_boarding',
  'weekday_day',
  'weekday_boarding',
  'full_time_boarding',
] as const;

export type AcademyPricingKey = (typeof ACADEMY_PRICING_KEYS)[number];

export interface AcademyPricingOption {
  key: AcademyPricingKey;
  label: string;
  note: string | null;
  /** Naira — the academy tables predate the kobo convention. */
  price_ngn: number;
  sort_order: number;
}

// Labels are the operator's exact wording, one line per format, e.g.
// "Weekend (No Boarding) = ₦50,000". The 30-days / non-Lagos context for the
// full-time format lives in the apply-form caption, not the price line.
export const ACADEMY_PRICING_STRUCTURE: AcademyPricingOption[] = [
  { key: 'weekend_day',        label: 'Weekend (No Boarding)',   note: null, price_ngn: 50000,  sort_order: 10 },
  { key: 'weekend_boarding',   label: 'Weekend (With Boarding)', note: null, price_ngn: 80000,  sort_order: 20 },
  { key: 'weekday_day',        label: 'Week days (No Boarding)', note: null, price_ngn: 100000, sort_order: 30 },
  { key: 'weekday_boarding',   label: 'Week days (Boarding)',    note: null, price_ngn: 150000, sort_order: 40 },
  { key: 'full_time_boarding', label: '1 month - Boarding',      note: null, price_ngn: 200000, sort_order: 50 },
];

/** What an applicant pays at application time. */
export const ACADEMY_DELIVERABLES = [
  '2 movie projects',
  'Potential talent management contract and signing into Timeless Movies Production',
  'Assistance to produce your own movie, and to set up & manage a YouTube channel',
];

/** Costs the tuition does NOT cover, shown next to every price. */
export const ACADEMY_FEE_EXCLUSIONS = [
  'Feeding',
  'Project fees: script print-out, make-up, props & set design, location (₦20,000 per movie project)',
];

/**
 * The format priced for a client that never chose one (the old web form sends
 * no key). The cheapest format — a legacy submission must never be priced
 * above what it was shown.
 */
export const ACADEMY_PRICING_FALLBACK_KEY: AcademyPricingKey = 'weekend_day';

export function isPricingKey(v: unknown): v is AcademyPricingKey {
  return typeof v === 'string' && (ACADEMY_PRICING_KEYS as readonly string[]).includes(v);
}

export function pricingDefinition(key: AcademyPricingKey): AcademyPricingOption {
  return ACADEMY_PRICING_STRUCTURE.find((o) => o.key === key) ?? ACADEMY_PRICING_STRUCTURE[0];
}

/** The five launch rows to seed for a freshly created area. */
export function defaultPricingRows(areaId: string) {
  return ACADEMY_PRICING_STRUCTURE.map((o) => ({
    area_id: areaId,
    key: o.key,
    label: o.label,
    note: o.note,
    price_ngn: o.price_ngn,
    sort_order: o.sort_order,
  }));
}

export interface AreaPricingOptionRow {
  area_id: string;
  key: string;
  label: string;
  note: string | null;
  price_ngn: number;
  sort_order: number;
}

/**
 * Per-area option rows merged onto the area list the caller already has.
 * An area with no rows gets the launch structure as defaults, so it is priced
 * on the current table rather than silently at zero.
 */
export function attachPricingOptions<T extends { id: string }>(
  areas: T[],
  rows: AreaPricingOptionRow[],
): Array<T & { pricing_options: AcademyPricingOption[] }> {
  const byArea = new Map<string, AreaPricingOptionRow[]>();
  for (const r of rows) {
    const list = byArea.get(r.area_id) ?? [];
    list.push(r);
    byArea.set(r.area_id, list);
  }
  return areas.map((a) => {
    const stored = (byArea.get(a.id) ?? [])
      .filter((r) => isPricingKey(r.key))
      .sort((x, y) => x.sort_order - y.sort_order)
      .map((r) => ({
        key: r.key as AcademyPricingKey,
        label: r.label,
        note: r.note,
        price_ngn: Number(r.price_ngn),
        sort_order: r.sort_order,
      }));
    const options = ACADEMY_PRICING_STRUCTURE.map((def) =>
      stored.find((o) => o.key === def.key) ?? def,
    );
    return { ...a, pricing_options: options };
  });
}

/**
 * Tuition for a set of areas in one format: the stored per-area price,
 * falling back to the launch definition where the option row is missing.
 */
export function tuitionForFormat(
  areaIds: Array<{ id: string }>,
  key: AcademyPricingKey,
  rows: AreaPricingOptionRow[],
): number {
  const def = pricingDefinition(key).price_ngn;
  return areaIds.reduce((sum, a) => {
    const row = rows.find((r) => r.area_id === a.id && r.key === key);
    return sum + (row ? Number(row.price_ngn) : def);
  }, 0);
}

const PLAN_CADENCES = new Set(['weekly', 'biweekly', 'monthly']);

/**
 * The shape of an applicant's tuition plan: how many instalments, the amount
 * after any one-off discount, and what the FIRST instalment costs. This is the
 * single source for the plan rows, the quote and the amount verified at submit.
 */
export function tuitionPlanShape(input: {
  tuition: number;
  preference: 'one_off' | 'installment';
  installmentsCount: number | null;
  feeFrequency: string | null;
  oneOffDiscountPct: number | null;
}) {
  const payUpfront =
    input.preference === 'one_off' || !PLAN_CADENCES.has(String(input.feeFrequency ?? 'monthly'));
  const count = payUpfront ? 1 : Math.min(12, Math.max(1, Number(input.installmentsCount ?? 1)));
  const discountPct = input.preference === 'one_off' ? Number(input.oneOffDiscountPct ?? 0) : 0;
  const discounted = Math.round(input.tuition * (1 - discountPct / 100) * 100) / 100;
  const unit = Math.round((discounted / count) * 100) / 100;
  const first = count === 1 ? discounted : unit;
  return { count, discountPct, discounted, unit, firstDueNgn: input.tuition > 0 ? first : 0 };
}

/** Parse `area_selections: [{slug, key}]` into {slug: key}; 'invalid' on a bad or duplicate entry. */
export function parseAreaSelections(value: unknown): Record<string, AcademyPricingKey> | 'invalid' | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Record<string, AcademyPricingKey> = {};
  for (const item of value) {
    const slug = String((item as { slug?: unknown })?.slug ?? '').trim();
    const key = String((item as { key?: unknown })?.key ?? '').trim();
    if (!slug || !isPricingKey(key)) return 'invalid';
    if (out[slug]) return 'invalid';
    out[slug] = key;
  }
  return out;
}

/** Tuition when each area carries its own format — the sum of the chosen subs. */
export function tuitionForSelections(
  areas: Array<{ id: string; slug: string }>,
  selections: Record<string, AcademyPricingKey>,
  rows: AreaPricingOptionRow[],
): number {
  return areas.reduce((sum, a) => {
    const key = selections[a.slug] ?? ACADEMY_PRICING_FALLBACK_KEY;
    const row = rows.find((r) => r.area_id === a.id && r.key === key);
    return sum + (row ? Number(row.price_ngn) : pricingDefinition(key).price_ngn);
  }, 0);
}
