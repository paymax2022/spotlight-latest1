// Maps the Go parcel API's wire shapes onto the app's Parcel types. Mirrors
// ensurePlaces/flattenTrip in mobility.api.ts: the screens code against one
// shape, and this is the only place that knows the server's.
//
// The server (backend/internal/transport/parcel.go) returns, today:
//   detail/book/accept  flat: status, pickupAddress/dropoffAddress, courierId
//   list                { parcels: [...] }    (no speed, no receiver)
//   courier requests    { requests: [...] }   (id, flat addresses)
//   rider actions       { ok, status }
// An enriched shape is being added (courier object, coordinates, paymentStatus,
// deliveredAt, rated, rider net earnings). Both are accepted, field by field,
// so the app and the server can land in either order. Nothing here invents a
// number: a missing net earning stays null rather than becoming fare × 0.8.
//
// Pure (no RN imports) so node --test can run it.

import type {
  Courier,
  CourierParcelRequest,
  Parcel,
  ParcelCategory,
  ParcelPhase,
  ParcelSize,
  ParcelSpeed,
  Place,
} from '../types/modes.types';

type Raw = Record<string, unknown>;

const PHASES: readonly ParcelPhase[] = [
  'created',
  'courier_assigned',
  'pickup_pin_verified',
  'picked_up',
  'in_transit',
  'dropoff_verified',
  'delivered',
  'failed',
  'disputed',
  'cancelled',
];

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const kobo = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/** Server `status` (or an already-mapped `phase`) → ParcelPhase. */
export function parcelPhaseFrom(raw: Raw): ParcelPhase {
  const s = str(raw.phase) ?? str(raw.status);
  return s && (PHASES as readonly string[]).includes(s) ? (s as ParcelPhase) : 'created';
}

/**
 * A nested `pickup: {address,lat,lng}` wins; otherwise the flat
 * `pickupAddress` + optional `pickupLat`/`pickupLng`. Missing coordinates are
 * 0,0 exactly as ensurePlaces does — check `hasCoords` before plotting.
 */
export function placeFrom(raw: Raw, side: 'pickup' | 'dropoff'): Place {
  const nested = raw[side];
  if (isObj(nested) && str(nested.address) != null) {
    return { address: String(nested.address), lat: num(nested.lat) ?? 0, lng: num(nested.lng) ?? 0 };
  }
  return {
    address: str(raw[`${side}Address`]) ?? '',
    lat: num(raw[`${side}Lat`]) ?? 0,
    lng: num(raw[`${side}Lng`]) ?? 0,
  };
}

export const hasCoords = (p: Place): boolean => p.lat !== 0 || p.lng !== 0;

/** Only a real courier object becomes a Courier — a bare courierId has no name to show. */
export function courierFrom(raw: Raw): Courier | null {
  const c = raw.courier;
  if (!isObj(c)) return null;
  const id = str(c.id) ?? str(raw.courierId);
  const name = str(c.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    photoUrl: str(c.photoUrl),
    rating: num(c.rating) ?? 0,
    vehicle: str(c.vehicle) ?? '',
    phoneMasked: str(c.phoneMasked),
  };
}

/**
 * The server settles the courier atomically with `delivered` and refunds on
 * `cancelled`, so the lifecycle implies the escrow state when the server does
 * not say it outright.
 */
export function paymentStatusFrom(raw: Raw, phase: ParcelPhase): Parcel['paymentStatus'] {
  const s = str(raw.paymentStatus);
  if (s === 'escrowed' || s === 'settled' || s === 'refunded' || s === 'failed') return s;
  if (phase === 'delivered') return 'settled';
  if (phase === 'cancelled') return 'refunded';
  return 'escrowed';
}

/** Detail / book / accept body → Parcel. Also accepts an already-normalised Parcel. */
export function toParcel(body: unknown): Parcel {
  const raw: Raw = isObj(body) ? (isObj(body.parcel) ? body.parcel : body) : {};
  const phase = parcelPhaseFrom(raw);
  const insuranceStatus = str(raw.insuranceStatus);
  return {
    id: str(raw.id) ?? '',
    phase,
    pickup: placeFrom(raw, 'pickup'),
    dropoff: placeFrom(raw, 'dropoff'),
    category: (str(raw.category) ?? 'other') as ParcelCategory,
    size: (str(raw.size) ?? 'small') as ParcelSize,
    speed: (str(raw.speed) ?? 'standard') as ParcelSpeed,
    declaredValueKobo: kobo(raw.declaredValueKobo) ?? 0,
    fareKobo: kobo(raw.fareKobo) ?? 0,
    currency: 'NGN',
    receiverName: str(raw.receiverName) ?? '',
    receiverPhone: str(raw.receiverPhone) ?? '',
    photoUrl: str(raw.photoUrl),
    pickupPin: str(raw.pickupPin),
    dropoffPin: str(raw.dropoffPin),
    proofUrl: str(raw.proofUrl),
    courier: courierFrom(raw),
    paymentStatus: paymentStatusFrom(raw, phase),
    createdAt: str(raw.createdAt) ?? '',
    deliveredAt: str(raw.deliveredAt),
    rated: raw.rated === true,
    ...(typeof raw.insuranceOpted === 'boolean' ? { insuranceOpted: raw.insuranceOpted } : {}),
    ...(kobo(raw.insurancePaidKobo) != null ? { insurancePaidKobo: kobo(raw.insurancePaidKobo)! } : {}),
    ...(insuranceStatus ? { insuranceStatus: insuranceStatus as Parcel['insuranceStatus'] } : {}),
  };
}

/** Pull the array out of `{ <key>: [...] }`, a `{ data: ... }` envelope, or a bare array. */
export function listFrom(body: unknown, key: string): Raw[] {
  if (Array.isArray(body)) return body.filter(isObj);
  if (!isObj(body)) return [];
  const inner = body[key];
  if (Array.isArray(inner)) return inner.filter(isObj);
  if (body.data !== undefined) return listFrom(body.data, key);
  return [];
}

/** List body (`{parcels:[…]}` or a bare array) → Parcel[]. */
export function toParcelList(body: unknown): Parcel[] {
  return listFrom(body, 'parcels').map(toParcel);
}

/** One open courier request → CourierParcelRequest (`id` → `parcelId`). */
export function toCourierRequest(raw: Raw): CourierParcelRequest {
  return {
    parcelId: str(raw.parcelId) ?? str(raw.id) ?? '',
    pickup: placeFrom(raw, 'pickup'),
    dropoff: placeFrom(raw, 'dropoff'),
    category: (str(raw.category) ?? 'other') as ParcelCategory,
    size: (str(raw.size) ?? 'small') as ParcelSize,
    speed: (str(raw.speed) ?? 'standard') as ParcelSpeed,
    distanceM: num(raw.distanceM) ?? 0,
    fareKobo: kobo(raw.fareKobo) ?? 0,
    estCourierNetKobo: kobo(raw.estCourierNetKobo) ?? kobo(raw.courierNetKobo),
    currency: 'NGN',
    expiresAt: str(raw.expiresAt),
  };
}

export function toCourierRequests(body: unknown): CourierParcelRequest[] {
  return listFrom(body, 'requests').map(toCourierRequest).filter((r) => r.parcelId !== '');
}

/**
 * A rider action's body → the phase the parcel is now in. Today it is
 * `{ok,status}`; a server that returns the whole parcel works too.
 */
export function toCourierActionPhase(body: unknown, fallback: ParcelPhase): ParcelPhase {
  const raw: Raw = isObj(body) ? (isObj(body.parcel) ? body.parcel : body) : {};
  return str(raw.status) || str(raw.phase) ? parcelPhaseFrom(raw) : fallback;
}

// ── Rider screen step ───────────────────────────────────────────────────────

export type CourierStep =
  | 'navigate_pickup'
  | 'verify_pickup'
  | 'photo'
  | 'navigate_dropoff'
  | 'verify_dropoff'
  | 'done'
  | 'closed';

/** Which leg the rider is on, so a local "I've arrived" applies to one leg only. */
export function courierLeg(phase: ParcelPhase): 'pickup' | 'dropoff' | null {
  if (phase === 'created' || phase === 'courier_assigned') return 'pickup';
  if (phase === 'picked_up' || phase === 'in_transit') return 'dropoff';
  return null;
}

/**
 * The rider screen's step, derived from the server phase so it resumes after a
 * restart. `arrived` is the only local bit: "I've arrived" has no server
 * transition, so it just advances the navigate step to the PIN step.
 */
export function courierStepFor(phase: ParcelPhase, arrived: boolean): CourierStep {
  switch (phase) {
    case 'created':
    case 'courier_assigned':
      return arrived ? 'verify_pickup' : 'navigate_pickup';
    case 'pickup_pin_verified':
      return 'photo';
    case 'picked_up':
    case 'in_transit':
      return arrived ? 'verify_dropoff' : 'navigate_dropoff';
    case 'dropoff_verified':
    case 'delivered':
      return 'done';
    default:
      return 'closed';
  }
}

// ── Courier history / earnings ──────────────────────────────────────────────

export interface CourierDelivery {
  parcelId: string;
  dropoff: Place;
  phase: ParcelPhase;
  fareKobo: number;
  /** What the rider was paid, from the server. null when the server did not say. */
  netKobo: number | null;
  deliveredAt: string | null;
}

export function toCourierDelivery(raw: Raw): CourierDelivery {
  return {
    parcelId: str(raw.parcelId) ?? str(raw.id) ?? '',
    dropoff: placeFrom(raw, 'dropoff'),
    phase: parcelPhaseFrom(raw),
    fareKobo: kobo(raw.fareKobo) ?? 0,
    netKobo: kobo(raw.courierNetKobo) ?? kobo(raw.netKobo) ?? kobo(raw.earningsKobo),
    deliveredAt: str(raw.deliveredAt),
  };
}

/** History body (`{parcels:[…]}`, `{deliveries:[…]}` or a bare array). */
export function toCourierHistory(body: unknown): CourierDelivery[] {
  const items = listFrom(body, 'parcels');
  const list = items.length ? items : listFrom(body, 'deliveries');
  return list.map(toCourierDelivery).filter((d) => d.parcelId !== '');
}

export interface CourierEarningsSummary {
  delivered: CourierDelivery[];
  /** Sum of server-reported nets; null if any delivered item lacks one. */
  netKobo: number | null;
  grossKobo: number;
}

/** Totals only what the server reported — never a client-side commission. */
export function summariseCourierEarnings(history: CourierDelivery[]): CourierEarningsSummary {
  const delivered = history.filter((d) => d.phase === 'delivered');
  const grossKobo = delivered.reduce((s, d) => s + d.fareKobo, 0);
  const netKobo = delivered.every((d) => d.netKobo != null)
    ? delivered.reduce((s, d) => s + (d.netKobo as number), 0)
    : null;
  return { delivered, netKobo, grossKobo };
}
