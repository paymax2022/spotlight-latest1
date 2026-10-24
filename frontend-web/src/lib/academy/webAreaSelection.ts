/**
 * Area selection rules for the WEB Film Academy apply page.
 *
 * The web form is deliberately NOT ported to the per-area option picker. When
 * area options are enabled (GET /api/academy/apply → `areaOptionsEnabled`), an
 * area that has at least one option can only be priced through a chosen option,
 * which the server requires — so a legacy `areas_of_interest` submit naming it
 * would be refused with a 400, possibly AFTER the applicant paid the
 * application fee. Such areas are therefore app-only on the web: shown
 * disabled, never selectable, never submitted, never in the running total.
 *
 * Pure; the server remains the pricing authority — the total here is display
 * only.
 */

export type WebAreaOption = {
  id: string;
  label: string;
  duration_label: string | null;
  price_no_boarding_ngn: number;
  price_with_boarding_ngn: number | null;
};

export type WebInterestArea = {
  slug: string;
  label: string;
  description: string | null;
  /** Legacy tuition in whole naira (payable on acceptance). */
  fee_ngn: number;
  /** Active options; absent on servers that predate area options. */
  options?: WebAreaOption[];
};

export const APP_ONLY_AREA_TEXT = 'Choose this area in the Paymax app';

/** True when the area must be chosen in the app (it has options and they are on). */
export function isAppOnlyArea(area: WebInterestArea, areaOptionsEnabled: boolean): boolean {
  return areaOptionsEnabled && Array.isArray(area.options) && area.options.length > 0;
}

/**
 * The slugs that may actually be sent as `areas_of_interest`: selected, offered
 * (present in `areas`) and not app-only. Order follows the selection.
 */
export function submittableAreaSlugs(
  selected: string[],
  areas: WebInterestArea[],
  areaOptionsEnabled: boolean,
): string[] {
  const allowed = new Set(
    areas.filter((a) => !isAppOnlyArea(a, areaOptionsEnabled)).map((a) => a.slug),
  );
  return selected.filter((slug) => allowed.has(slug));
}

/** Display-only legacy tuition total over the submittable areas. */
export function legacyTuitionTotal(
  selected: string[],
  areas: WebInterestArea[],
  areaOptionsEnabled: boolean,
): number {
  const slugs = new Set(submittableAreaSlugs(selected, areas, areaOptionsEnabled));
  return areas
    .filter((a) => slugs.has(a.slug))
    .reduce((sum, a) => {
      const fee = Number(a.fee_ngn);
      return Number.isFinite(fee) && fee > 0 ? sum + fee : sum;
    }, 0);
}
