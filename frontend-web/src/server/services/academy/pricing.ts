// The Film Academy training formats — the list an applicant chooses between
// under each area of interest ("Weekend (No Boarding)", "1 month - Boarding",
// …) — are admin-managed rows in academy_pricing_formats. Each training then
// carries one price row per format in academy_area_pricing_options.
//
// What lives here is the ARITHMETIC and the MERGE, not the membership: which
// formats exist, what they are called and in what order they are shown is the
// catalogue's business (see ./formats.ts), because the operator has to be able
// to rename a label, reorder the list, retire a format or add one without a
// migration and a deploy. That is the whole point of this file's shape: every
// function below is handed the formats it should price against.
//
// ACADEMY_LAUNCH_FORMATS is the seed for that table and the answer for a
// database where the migration has not run yet (a fresh local stack). It is
// deliberately NOT a whitelist any more: nothing here refuses a key the
// operator created.

export type AcademyPricingKey = string;

/** One managed training format, as stored in academy_pricing_formats. */
export interface AcademyPricingFormat {
  key: string;
  label: string;
  note: string | null;
  sort_order: number;
  is_active: boolean;
  /** Naira. What a training is charged for this format when it has no row yet. */
  default_price_ngn: number;
}

/**
 * One format AS SERVED TO A CLIENT: the format's own identity plus that
 * training's price. This is the wire shape the applicant accordions, the
 * tuition planner and the admin editor all render.
 */
export interface AcademyPricingOption {
  key: string;
  label: string;
  note: string | null;
  price_ngn: number;
  sort_order: number;
}

// The wording the operator launched on, and still sees on a database that has
// not run 20271800000000 (mirrors that migration's seed and the five rows it
// documents). Notes stayed null because the launch copy puts the 30-days /
// non-Lagos context in the apply-form caption, not in the price line.
export const ACADEMY_LAUNCH_FORMATS: AcademyPricingFormat[] = [
  { key: 'weekend_day',        label: 'Weekend (No Boarding)',   note: null, sort_order: 10, is_active: true, default_price_ngn: 50000 },
  { key: 'weekend_boarding',   label: 'Weekend (With Boarding)', note: null, sort_order: 20, is_active: true, default_price_ngn: 80000 },
  { key: 'weekday_day',        label: 'Week days (No Boarding)', note: null, sort_order: 30, is_active: true, default_price_ngn: 100000 },
  { key: 'weekday_boarding',   label: 'Week days (Boarding)',    note: null, sort_order: 40, is_active: true, default_price_ngn: 150000 },
  { key: 'full_time_boarding', label: '1 month - Boarding',      note: null, sort_order: 50, is_active: true, default_price_ngn: 200000 },
];

/** What an applicant pays at application time. */
export const ACADEMY_DELIVERABLES = [
  '4 weeks with 80% Practical Movie projects',
  'Potential talent management contract and signing into Timeless Movies Production',
  'Assistance to produce your own movie, and to set up & manage a YouTube channel',
];

/** Costs the tuition does NOT cover, shown next to every price. */
export const ACADEMY_FEE_EXCLUSIONS = [
  'Feeding',
  'Project fees: script print-out, make-up, props & set design, location (₦20,000 per movie project)',
];

/**
 * How many priced areas one application may carry, per batch.
 *
 * Enforced on the SERVER because the cap is a commercial rule, not a UI nicety:
 * a form that stops at this number is not what decides. An application that
 * slipped past it would be charged for every area it named.
 *
 * Applied to the DEDUPLICATED list, and travelled with the catalogue so a
 * public page quotes the same cap instead of keeping its own copy. Existing
 * applications above it are left alone — the cap governs new submissions.
 */
export const MAX_INTEREST_AREAS_PER_APPLICATION = 2;

/** A copy, ordered the way the operator ordered it. Never sorts in place. */
export function orderFormats(formats: AcademyPricingFormat[]): AcademyPricingFormat[] {
  return [...formats]
    .filter((f) => f && typeof f.key === 'string' && f.key.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

/** The formats a NEW application may be priced in: the on-offer ones, in order. */
export function activeFormats(formats: AcademyPricingFormat[]): AcademyPricingFormat[] {
  const offered = orderFormats(formats).filter((f) => f.is_active);
  // An empty or unreadable catalogue must not empty the apply form: fall back
  // to the launch structure, which is what every environment was seeded with.
  return offered.length > 0 ? offered : orderFormats(ACADEMY_LAUNCH_FORMATS).filter((f) => f.is_active);
}

export function activeFormatKeys(formats: AcademyPricingFormat[]): Set<string> {
  return new Set(activeFormats(formats).map((f) => f.key));
}

/**
 * The format priced for a client that never chose one — the old web form and
 * the old mobile build send no key. It used to be the literal 'weekend_day',
 * the cheapest launch format; now it is the cheapest FORMAT ON OFFER, so an
 * operator who withdraws the weekend format does not silently price a legacy
 * submission above what the screen showed. Ties break on the operator's order.
 */
export function fallbackFormat(formats: AcademyPricingFormat[]): AcademyPricingFormat {
  const offered = activeFormats(formats);
  return offered.reduce((cheapest, f) =>
    (f.default_price_ngn < cheapest.default_price_ngn ? f : cheapest), offered[0]);
}

export function fallbackFormatKey(formats: AcademyPricingFormat[]): string {
  return fallbackFormat(formats).key;
}

/** The format's own row; falls back to the first on-offer format for an
 * unknown key, which callers must have already rejected at the boundary. */
export function pricingDefinition(key: string, formats: AcademyPricingFormat[]): AcademyPricingFormat {
  return orderFormats(formats).find((f) => f.key === key) ?? activeFormats(formats)[0];
}

/** The five launch rows to seed for a freshly created area — today: every
 * format the operator has on offer, at its own default price. */
export function defaultPricingRows(
  areaId: string,
  formats: AcademyPricingFormat[],
): Array<{ area_id: string; key: string; label: string; note: string | null; price_ngn: number; sort_order: number }> {
  return activeFormats(formats).map((f) => ({
    area_id: areaId,
    key: f.key,
    label: f.label,
    note: f.note,
    price_ngn: f.default_price_ngn,
    sort_order: f.sort_order,
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
 * Per-area prices merged onto the area list the caller already has.
 *
 * Identity (label, note) comes from the managed catalogue; money comes
 * from the stored row, falling back to the format's default price where that
 * training has no row yet — which is exactly the state a format sits in for the
 * seconds after an operator adds it, and for any training created while the
 * seed insert failed.
 *
 * By default a row whose format is retired is NOT projected: an applicant must
 * never be offered a withdrawn format. The admin console passes
 * `includeInactive` — an operator who retires a format still has to see the
 * prices it carries and be able to bring it back. A past application keeps its
 * own snapshot either way, and the status screen reads the rows directly rather
 * than this projection.
 */
export function attachPricingOptions<T extends { id: string }>(
  areas: T[],
  rows: AreaPricingOptionRow[],
  formats: AcademyPricingFormat[],
  opts: { includeInactive?: boolean } = {},
): Array<T & { pricing_options: AcademyPricingOption[] }> {
  const byArea = new Map<string, AreaPricingOptionRow[]>();
  for (const r of rows) {
    const list = byArea.get(r.area_id) ?? [];
    list.push(r);
    byArea.set(r.area_id, list);
  }
  const offered = opts.includeInactive ? orderFormats(formats) : activeFormats(formats);
  return areas.map((a) => {
    const stored = byArea.get(a.id) ?? [];
    const options: AcademyPricingOption[] = offered.map((f) => {
      const row = stored.find((r) => r.key === f.key);
      return {
        key: f.key,
        label: f.label,
        note: f.note,
        price_ngn: row ? Number(row.price_ngn) : f.default_price_ngn,
        sort_order: f.sort_order,
      };
    });
    return { ...a, pricing_options: options };
  });
}

/**
 * Tuition for a set of areas in one format: the stored per-area price,
 * falling back to the format's default where the option row is missing.
 */
export function tuitionForFormat(
  areaIds: Array<{ id: string }>,
  key: string,
  rows: AreaPricingOptionRow[],
  formats: AcademyPricingFormat[],
): number {
  const def = pricingDefinition(key, formats).default_price_ngn;
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

/**
 * Parse `area_selections: [{slug, key}]` into {slug: key}; 'invalid' on a bad,
 * duplicate or NOT-ON-OFFER entry.
 *
 * The allowed keys are passed in because the operator owns the list: a key the
 * admin retired, mistyped into the request, or never created must not reach the
 * money path. Callers get it from activeFormatKeys(getTrainingFormats()).
 */
export function parseAreaSelections(
  value: unknown,
  allowedKeys: Set<string>,
): Record<string, string> | 'invalid' | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Record<string, string> = {};
  for (const item of value) {
    const slug = String((item as { slug?: unknown })?.slug ?? '').trim();
    const key = String((item as { key?: unknown })?.key ?? '').trim();
    if (!slug || !allowedKeys.has(key)) return 'invalid';
    if (out[slug]) return 'invalid';
    out[slug] = key;
  }
  return out;
}

/** Tuition when each area carries its own format — the sum of the chosen subs. */
export function tuitionForSelections(
  areas: Array<{ id: string; slug: string }>,
  selections: Record<string, string>,
  rows: AreaPricingOptionRow[],
  formats: AcademyPricingFormat[],
): number {
  const fallback = fallbackFormat(formats);
  return areas.reduce((sum, a) => {
    const key = selections[a.slug] ?? fallback.key;
    const row = rows.find((r) => r.area_id === a.id && r.key === key);
    return sum + (row ? Number(row.price_ngn) : pricingDefinition(key, formats).default_price_ngn);
  }, 0);
}

/**
 * The public catalogue's format list: identity without money, because each
 * training carries its own prices in pricing_options. A marketing page renders
 * this, so it must be the same list the application endpoint would accept.
 */
export function pricingStructureFor(
  formats: AcademyPricingFormat[],
): Array<Omit<AcademyPricingOption, 'price_ngn'>> {
  return activeFormats(formats).map(({ key, label, note, sort_order }) => ({
    key,
    label,
    note,
    sort_order,
  }));
}
