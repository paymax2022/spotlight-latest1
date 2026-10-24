// The applicant's area-option picks on the apply screen. Pure, so the rules can
// be tested without rendering. Display-only: the server re-validates and
// re-prices every selection, and is the authority on the area cap.

import { naira, optionPrice } from './optionPricing';
import type {
  FilmAcademyAreaOption, FilmAcademyInterestArea, FilmAcademySelection, FilmAcademySelectedOption,
} from './types';

export interface AreaPick {
  area: FilmAcademyInterestArea;
  option: FilmAcademyAreaOption;
  boarding: boolean;
}

/** An area with no active options cannot be applied for. */
export function hasOptions(area: FilmAcademyInterestArea): boolean {
  return (area.options?.length ?? 0) > 0;
}

/** True when at least one option of the area can be taken with boarding. */
export function offersBoarding(area: FilmAcademyInterestArea): boolean {
  return (area.options ?? []).some((o) => o.price_with_boarding_ngn !== null);
}

/** Whether tapping this area may open the picker: already picked, or room under the cap. */
export function canAddArea(picks: AreaPick[], area: FilmAcademyInterestArea, max: number): boolean {
  if (!hasOptions(area)) return false;
  if (picks.some((p) => p.area.slug === area.slug)) return true;
  return picks.length < max;
}

function isValidPick(p: AreaPick): boolean {
  return (
    p.area.options.some((o) => o.id === p.option.id) &&
    optionPrice(p.option, p.boarding) !== null
  );
}

/**
 * Adds or replaces the pick for its area (keeping its position). An invalid
 * pick, or a new area over the cap, returns `picks` unchanged.
 */
export function upsertPick(picks: AreaPick[], next: AreaPick, max: number): AreaPick[] {
  if (!isValidPick(next)) return picks;
  const i = picks.findIndex((p) => p.area.slug === next.area.slug);
  if (i >= 0) return picks.map((p, j) => (j === i ? next : p));
  if (picks.length >= max) return picks;
  return [...picks, next];
}

export function removePick(picks: AreaPick[], slug: string): AreaPick[] {
  return picks.filter((p) => p.area.slug !== slug);
}

/**
 * Re-binds picks to the latest offered areas: drops a pick whose area the batch
 * no longer offers, whose option is gone, or whose boarding is no longer
 * available; refreshes area/option objects so prices are current; enforces the cap.
 */
export function reconcilePicks(
  picks: AreaPick[],
  offered: FilmAcademyInterestArea[],
  max: number = Number.POSITIVE_INFINITY,
): AreaPick[] {
  const bySlug = new Map(offered.map((a) => [a.slug, a]));
  const out: AreaPick[] = [];
  for (const p of picks) {
    if (out.length >= max) break;
    const area = bySlug.get(p.area.slug);
    const option = area?.options.find((o) => o.id === p.option.id);
    if (!area || !option) continue;
    const fresh = { area, option, boarding: p.boarding };
    if (isValidPick(fresh)) out.push(fresh);
  }
  return out;
}

/** The wire payload. Prices are never sent; `boarding` is a real boolean. */
export function toSelections(picks: AreaPick[]): FilmAcademySelection[] {
  return picks.map((p) => ({ area: p.area.slug, option_id: p.option.id, boarding: p.boarding === true }));
}

/** Coerces the application's `selected_options` snapshot; malformed entries are dropped. */
export function normaliseSelectedOptions(raw: unknown): FilmAcademySelectedOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FilmAcademySelectedOption[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || !r.area_slug) continue;
    out.push({
      area_slug: String(r.area_slug),
      option_id: String(r.option_id ?? ''),
      label: String(r.label ?? ''),
      duration_label: r.duration_label == null ? null : String(r.duration_label),
      boarding: r.boarding === true,
      price_ngn: naira(r.price_ngn),
    });
  }
  return out;
}
