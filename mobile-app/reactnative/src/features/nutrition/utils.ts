// ── Nutrition — Formatters & honest-precision helpers ────────────────────────
// The display rules live here so every surface (dish row, detail, cart, vendor
// confirm) renders provenance identically. THE central rule: never emit a bare
// number — always pair it with source + confidence.

import type {
  NutrientValue,
  NutritionStatus,
  TrafficLight,
  TrafficLights,
  AllergenDeclarationType,
} from './types';

// ─── Status labels (buyer-facing, honest precision) ──────────────────────────
// v2: the label is driven by the honesty STATUS, never the raw grounding. The
// cardinal rule — approval ≠ measurement — is encoded here: RESTAURANT_CONFIRMED
// shows a point value but ALWAYS carries the "(estimate)" qualifier; only EXACT
// (a real label) may read as a precise figure.
export const STATUS_LABEL: Record<NutritionStatus, string> = {
  AI_ESTIMATE: 'AI estimate',
  RESTAURANT_CONFIRMED: 'restaurant-confirmed (estimate)',
  EXACT: 'from label',
  STALE: 'recalculating',
};

/**
 * ONLY `EXACT` (a real packaged-goods label) is a true single-exact figure and
 * renders as a bare point value ("540 kcal · from label"). `RESTAURANT_CONFIRMED`
 * shows a point value too, but keeps the "(estimate)" qualifier — approving is
 * not measuring. `AI_ESTIMATE` renders as a range. This is the honest-precision
 * gate: a precise *and unqualified* display is earned only by a real label.
 */
export function isExact(status: NutritionStatus): boolean {
  return status === 'EXACT';
}

/**
 * Whether to render a point value (vs a range). EXACT and RESTAURANT_CONFIRMED
 * both show a point value; AI_ESTIMATE (and STALE) show a range. The "(estimate)"
 * qualifier for RESTAURANT_CONFIRMED is applied separately via STATUS_LABEL —
 * the point value alone is never enough to imply exactness.
 */
export function isPointValue(status: NutritionStatus): boolean {
  return status === 'EXACT' || status === 'RESTAURANT_CONFIRMED';
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * Format a nutrient value honestly given the profile STATUS + a unit.
 * Point value (EXACT / RESTAURANT_CONFIRMED) → "540 kcal". AI_ESTIMATE →
 * "≈520–580 kcal" (falls back to "≈540 kcal" when no range is supplied). The
 * caller appends the status badge ("from label" / "restaurant-confirmed
 * (estimate)" / "AI estimate") — those are never optional.
 */
export function formatNutrient(
  v: NutrientValue,
  unit: string,
  status: NutritionStatus,
): string {
  if (isPointValue(status)) {
    return `${round(v.value)} ${unit}`;
  }
  if (v.low != null && v.high != null && v.high > v.low) {
    return `≈${round(v.low)}–${round(v.high)} ${unit}`;
  }
  return `≈${round(v.value)} ${unit}`;
}

/** Short macro display, e.g. "32 g" point value or "≈30 g" estimated range. */
export function formatMacro(v: NutrientValue, status: NutritionStatus): string {
  return formatNutrient(v, 'g', status);
}

// ─── Traffic lights ─────────────────────────────────────────────────────────
export const TRAFFIC_COLOR: Record<TrafficLight, string> = {
  // Pulled from the palette's semantic anchors so dots stay on-brand.
  green: '#16A34A',
  amber: '#EAB308',
  red: '#DC2626',
};

export const TRAFFIC_BG: Record<TrafficLight, string> = {
  green: 'rgba(22,163,74,0.10)',
  amber: 'rgba(234,179,8,0.12)',
  red: 'rgba(220,38,38,0.08)',
};

export const TRAFFIC_LABEL: Record<TrafficLight, string> = {
  green: 'Low',
  amber: 'Med',
  red: 'High',
};

const SEVERITY: Record<TrafficLight, number> = { green: 0, amber: 1, red: 2 };

/** Pick the more severe of two lights (used for cart worst-case aggregation). */
export function worseLight(a: TrafficLight, b: TrafficLight): TrafficLight {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export function worstTrafficLights(lights: TrafficLights[]): TrafficLights {
  return lights.reduce<TrafficLights>(
    (acc, l) => ({
      sodium_mg: worseLight(acc.sodium_mg, l.sodium_mg),
      sugar_g: worseLight(acc.sugar_g, l.sugar_g),
      sat_fat_g: worseLight(acc.sat_fat_g, l.sat_fat_g),
    }),
    { sodium_mg: 'green', sugar_g: 'green', sat_fat_g: 'green' },
  );
}

// ─── Allergen presentation ──────────────────────────────────────────────────
export const DECLARATION_LABEL: Record<AllergenDeclarationType, string> = {
  CONTAINS: 'Contains',
  MAY_CONTAIN: 'May contain',
  FREE_FROM: 'Free from',
};
