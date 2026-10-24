// Display-side pricing for Film Academy area options. NAIRA, not kobo.
// Informational only: the server re-prices every selection from the database
// and never trusts an amount sent from here.

import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from './types';

/**
 * Safe naira coercion. null/''/non-numeric/negative/non-finite => null, so a
 * missing price can never become 0 (a free option) or NaN. Rounds to whole naira.
 */
export function naira(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Normalise raw server options; options with no usable base price are dropped. */
export function normaliseOptions(raw: unknown): FilmAcademyAreaOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FilmAcademyAreaOption[] = [];
  for (const o of raw as Record<string, unknown>[]) {
    const base = naira(o?.price_no_boarding_ngn);
    if (base === null) continue;
    out.push({
      id: String(o.id),
      label: String(o.label ?? ''),
      duration_label: (o.duration_label as string | null | undefined) ?? null,
      price_no_boarding_ngn: base,
      price_with_boarding_ngn: naira(o.price_with_boarding_ngn),
    });
  }
  return out;
}

/** Price of an option, or null when boarding is requested but not offered. */
export function optionPrice(o: FilmAcademyAreaOption, boarding: boolean): number | null {
  if (!boarding) return o.price_no_boarding_ngn;
  return o.price_with_boarding_ngn ?? null;
}

/** Lowest no-boarding price across the area's options (all returned options are active); null if none. */
export function fromPrice(area: FilmAcademyInterestArea): number | null {
  const prices = (area.options ?? [])
    .map((o) => o.price_no_boarding_ngn)
    .filter((p) => Number.isFinite(p));
  return prices.length ? Math.min(...prices) : null;
}

/** Picks that want boarding where it is not offered are excluded, never mispriced. */
export function summarise(
  picks: { area: FilmAcademyInterestArea; option: FilmAcademyAreaOption; boarding: boolean }[],
): { lines: { label: string; price: number }[]; total: number } {
  const lines: { label: string; price: number }[] = [];
  for (const p of picks) {
    const price = optionPrice(p.option, p.boarding);
    if (price === null) continue;
    lines.push({
      label: `${p.area.label} — ${p.option.label}${p.boarding ? ' (boarding)' : ''}`,
      price,
    });
  }
  return { lines, total: lines.reduce((s, l) => s + l.price, 0) };
}
