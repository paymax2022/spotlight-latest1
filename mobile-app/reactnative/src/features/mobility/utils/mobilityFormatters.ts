// ── Paymax Mobility — Formatters & helpers ───────────────────────────────────
// All money is integer kobo. Display helpers convert to major units (NGN).

import type { Kobo, LatLng, MobilityError, MobilityErrorCode } from '../types/mobility.types';

// ─── Money ──────────────────────────────────────────────────────────────────
/** Format kobo as a Naira string, e.g. 1_581_43 → "₦1,581.43". */
export function formatNaira(kobo: Kobo, opts?: { decimals?: boolean }): string {
  const major = kobo / 100;
  const decimals = opts?.decimals === false ? 0 : 2;
  return `₦${major.toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Whole-naira display for fares, e.g. 1_581_43 → "₦1,581". */
export function formatNairaWhole(kobo: Kobo): string {
  return formatNaira(Math.round(kobo / 100) * 100, { decimals: false });
}

/** Render an inclusive fare range, e.g. "₦1,800 – ₦2,600". */
export function formatFareRange(minKobo: Kobo, maxKobo: Kobo): string {
  return `${formatNairaWhole(minKobo)} – ${formatNairaWhole(maxKobo)}`;
}

/** Convert a Naira major-unit numeric input to integer kobo. Never store floats. */
export function nairaToKobo(naira: number): Kobo {
  return Math.round(naira * 100);
}

// ─── Distance / duration ───────────────────────────────────────────────────────
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null) return '—';
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

// ─── Idempotency ────────────────────────────────────────────────────────────────
/** Generate an Idempotency-Key for a money mutation (matches fx pattern). */
export function newIdempotencyKey(prefix = 'mob'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Geo (deterministic mock estimates — never used for real pricing) ──────────
const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ─── Error mapping ────────────────────────────────────────────────────────────
/** Normalise an axios/mock error into a typed MobilityError with a code. */
export function toMobilityError(err: unknown): MobilityError {
  const e = err as {
    response?: { status?: number; data?: { error?: string; code?: MobilityErrorCode } };
    message?: string;
    code?: MobilityErrorCode;
    status?: number;
  };
  const status = e?.response?.status ?? e?.status;
  const code = e?.response?.data?.code ?? e?.code;
  const message =
    e?.response?.data?.error ?? e?.message ?? 'Something went wrong. Please try again.';
  const out = new Error(message) as MobilityError;
  out.code = code;
  out.status = status;
  return out;
}

/** True when the error means dispatch found no available driver. */
export function isNoDriverError(err: MobilityError): boolean {
  return err.code === 'NO_DRIVER_FOUND' || err.status === 404;
}

/** True when the offer violated a server-side fare/profit floor or ceiling. */
export function isFareBoundError(err: MobilityError): boolean {
  return (
    err.code === 'FARE_BELOW_FLOOR' ||
    err.code === 'FARE_ABOVE_CEILING' ||
    err.code === 'DRIVER_PROFIT_FLOOR' ||
    err.status === 422
  );
}

/** Human-friendly message for a fare-bound rejection, given the server range. */
export function fareBoundMessage(
  err: MobilityError,
  minKobo: Kobo,
  maxKobo: Kobo,
): string {
  if (err.code === 'FARE_BELOW_FLOOR' || err.code === 'DRIVER_PROFIT_FLOOR') {
    return `That offer is too low. The minimum fair offer is ${formatNairaWhole(minKobo)}.`;
  }
  if (err.code === 'FARE_ABOVE_CEILING') {
    return `That offer is above the allowed range (max ${formatNairaWhole(maxKobo)}).`;
  }
  return err.message;
}

export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
