// ── Restaurant & Delivery — Delivery-fee MOCK calculator ─────────────────────
// Pure, deterministic mirror of backend/internal/restaurant/deliveryfee.go so the
// food checkout can quote a distance/time-based delivery fee fully offline. The
// SERVER stays authoritative on placeOrder — this only powers the pre-payment
// estimate (and the mock when EXPO_PUBLIC_FOOD_USE_MOCK !== 'false').
//
//   Fee = round((base + extra-distance + extra-time) × demand)
//         + night + weather + handling − promo, clamped to [min, max].
//
// Money is integer kobo throughout (never floats for the result lines).

import type { LatLng } from './types';

/** Mirrors restaurant.DeliveryFeeConfig (every field admin-editable server-side). */
export interface DeliveryFeeConfig {
  baseFeeKobo: number;
  freeDistanceKm: number;
  perKmKobo: number;
  freeMinutes: number;
  perMinuteKobo: number;
  demandMultiplier: number;
  nightFeeKobo: number;
  weatherFeeKobo: number;
  handlingFeeKobo: number;
  promoDiscountKobo: number;
  avgSpeedKmph: number;
  roadFactor: number;
  minFeeKobo: number;
  /** 0 = no cap. */
  maxFeeKobo: number;
}

/** Matches restaurant.DefaultDeliveryFeeConfig() — the seeded global defaults. */
export const DEFAULT_DELIVERY_CONFIG: DeliveryFeeConfig = {
  baseFeeKobo: 80000, // ₦800 base
  freeDistanceKm: 2,
  perKmKobo: 15000, // ₦150 / km after 2 km
  freeMinutes: 25,
  perMinuteKobo: 5000, // ₦50 / min after 25 min
  demandMultiplier: 1.0,
  nightFeeKobo: 0,
  weatherFeeKobo: 0,
  handlingFeeKobo: 0,
  promoDiscountKobo: 0,
  avgSpeedKmph: 20,
  roadFactor: 1.3,
  minFeeKobo: 80000,
  maxFeeKobo: 0,
};

/** Transparent line-by-line result — same shape as the backend breakdown JSON. */
export interface DeliveryFeeBreakdown {
  distance_km: number;
  eta_minutes: number;
  base_kobo: number;
  distance_kobo: number;
  time_kobo: number;
  surge_kobo: number;
  night_kobo: number;
  weather_kobo: number;
  handling_kobo: number;
  promo_kobo: number;
  total_kobo: number;
}

/** Full quote envelope — same shape the /delivery-quote endpoint returns. */
export interface DeliveryQuote {
  delivery_fee_kobo: number;
  flat_fallback: boolean;
  breakdown?: DeliveryFeeBreakdown;
}

/** How the delivery fee should be shown, and what to add to the estimate. */
export interface DeliveryFeeView {
  /** Kobo to include in the estimated total. 0 only when `known` is false. */
  feeKobo: number;
  /** True when this is a real number the SERVER returned. */
  known: boolean;
  /** True when the number is not distance-based, so it may move at checkout. */
  estimated: boolean;
}

/**
 * Turn a quote into what the summary should display.
 *
 * The rule this encodes: a quote is a SERVER price and is always used.
 * `flat_fallback` means "not distance-based" — it does NOT mean "discard".
 *
 * Checkout used to require `!flat_fallback` before trusting the quote and
 * otherwise fell back to `restaurant.deliveryFeeKobo`, a field with no database
 * column and no DTO behind it, so the fallback was always 0. The server returns
 * flat_fallback whenever the restaurant has no coordinates — 653 of 697 in the
 * dev DB — so the normal path threw away a real ₦500 and rendered ₦0, while
 * PlaceOrder went on charging the server-computed fee.
 *
 * With no quote at all the fee is UNKNOWN, not free: callers must render that
 * as a placeholder, never as ₦0.
 */
export function resolveDeliveryFee(quote?: DeliveryQuote | null): DeliveryFeeView {
  if (!quote || typeof quote.delivery_fee_kobo !== 'number' || !Number.isFinite(quote.delivery_fee_kobo)) {
    return { feeKobo: 0, known: false, estimated: true };
  }
  return {
    feeKobo: Math.trunc(quote.delivery_fee_kobo),
    known: true,
    estimated: Boolean(quote.flat_fallback),
  };
}

/**
 * Great-circle (straight-line) distance between two lat/lng points in kilometres.
 * Mirrors restaurant.HaversineKm.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const earthKm = 6371.0;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Round to integer kobo, matching Go's roundKobo (round-half-away-from-zero). */
function roundKobo(v: number): number {
  if (v < 0) return -Math.round(-v);
  return Math.round(v);
}

/**
 * Apply the configurable formula to the restaurant→delivery straight-line distance
 * (road factor + ETA derived inside). Pure + deterministic; mirrors
 * restaurant.ComputeDeliveryFee. Returns the line-by-line breakdown.
 */
export function computeDeliveryFeeMock(
  restaurantLoc: LatLng,
  deliveryLoc: LatLng,
  cfg: DeliveryFeeConfig = DEFAULT_DELIVERY_CONFIG,
  flags: { night?: boolean; weather?: boolean } = {},
): DeliveryFeeBreakdown {
  let straightLineKm = haversineKm(restaurantLoc, deliveryLoc);
  if (straightLineKm < 0) straightLineKm = 0;

  let roadFactor = cfg.roadFactor;
  if (roadFactor < 1) roadFactor = 1;
  const roadKm = straightLineKm * roadFactor;
  const eta = cfg.avgSpeedKmph > 0 ? (roadKm / cfg.avgSpeedKmph) * 60.0 : 0;

  const extraKm = Math.max(0, roadKm - cfg.freeDistanceKm);
  const distanceKobo = roundKobo(cfg.perKmKobo * extraKm);

  const extraMin = Math.max(0, eta - cfg.freeMinutes);
  const timeKobo = roundKobo(cfg.perMinuteKobo * extraMin);

  const core = cfg.baseFeeKobo + distanceKobo + timeKobo;
  let mult = cfg.demandMultiplier;
  if (mult <= 0) mult = 1;
  const afterDemand = roundKobo(core * mult);
  const surge = afterDemand - core;

  const nightKobo = flags.night ? cfg.nightFeeKobo : 0;
  const weatherKobo = flags.weather ? cfg.weatherFeeKobo : 0;

  let total = afterDemand + nightKobo + weatherKobo + cfg.handlingFeeKobo - cfg.promoDiscountKobo;

  // Clamp: floor at min (and never below 0), cap at max when set.
  if (total < cfg.minFeeKobo) total = cfg.minFeeKobo;
  if (cfg.maxFeeKobo > 0 && total > cfg.maxFeeKobo) total = cfg.maxFeeKobo;
  if (total < 0) total = 0;

  return {
    distance_km: Math.round(roadKm * 100) / 100,
    eta_minutes: Math.round(eta * 10) / 10,
    base_kobo: cfg.baseFeeKobo,
    distance_kobo: distanceKobo,
    time_kobo: timeKobo,
    surge_kobo: surge,
    night_kobo: nightKobo,
    weather_kobo: weatherKobo,
    handling_kobo: cfg.handlingFeeKobo,
    promo_kobo: cfg.promoDiscountKobo,
    total_kobo: total,
  };
}
