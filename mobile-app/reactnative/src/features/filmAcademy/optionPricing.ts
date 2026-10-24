// Display-side pricing for Film Academy area options. NAIRA, not kobo.
// Informational only: the server re-prices every selection from the database
// and never trusts an amount sent from here.

import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from './types';

/** Price of an option, or null when boarding is requested but not offered. */
export function optionPrice(o: FilmAcademyAreaOption, boarding: boolean): number | null {
  if (!boarding) return o.price_no_boarding_ngn;
  return o.price_with_boarding_ngn ?? null;
}

/** Lowest no-boarding price across the area's options (all returned options are active); null if none. */
export function fromPrice(area: FilmAcademyInterestArea): number | null {
  const prices = (area.options ?? []).map((o) => o.price_no_boarding_ngn);
  return prices.length ? Math.min(...prices) : null;
}

export function summarise(
  picks: { area: FilmAcademyInterestArea; option: FilmAcademyAreaOption; boarding: boolean }[],
): { lines: { label: string; price: number }[]; total: number } {
  const lines = picks.map((p) => ({
    label: `${p.area.label} — ${p.option.label}${p.boarding ? ' (boarding)' : ''}`,
    // Boarding unavailable falls back to the no-boarding price rather than NaN.
    price: optionPrice(p.option, p.boarding) ?? p.option.price_no_boarding_ngn,
  }));
  return { lines, total: lines.reduce((s, l) => s + l.price, 0) };
}
