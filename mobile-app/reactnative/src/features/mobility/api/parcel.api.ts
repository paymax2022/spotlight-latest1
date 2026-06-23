// ── Parcel delivery — API wrapper ────────────────────────────────────────────
// Typed data layer the parcel screens code against. Mirrors mobility.api.ts:
// mock-flagged, BASE = '/api/finance', Idempotency-Key on money mutations.
// Flip EXPO_PUBLIC_MOBILITY_USE_MOCK=false (or EXPO_PUBLIC_PARCEL_USE_MOCK) once
// the Go endpoints land.
//
// IRON RULES: all money is integer kobo; book/cancel carry an Idempotency-Key;
// fares/insurance come from the SERVER — never computed here.

import { api } from '@/api/client';
import type {
  Parcel,
  ParcelEstimate,
  ParcelEstimateRequest,
  ParcelBookRequest,
  CourierParcelRequest,
} from '../types/modes.types';
import {
  mockParcelEstimate,
  makeParcel,
  parcelStore,
  advanceMockParcel,
  MOCK_PARCEL_HISTORY,
  MOCK_COURIER,
  mockCourierRequests,
} from './parcel.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_PARCEL_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/finance';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// ─── Estimate ─────────────────────────────────────────────────────────────────
export async function estimateParcel(req: ParcelEstimateRequest): Promise<ParcelEstimate> {
  if (USE_MOCK) {
    await delay(420);
    return mockParcelEstimate(req);
  }
  return unwrap<ParcelEstimate>(
    await api.post(`${BASE}/mobility/parcels/estimate`, {
      pickup: req.pickup,
      dropoff: req.dropoff,
      category: req.category,
      size: req.size,
      speed: req.speed,
      declared_value_kobo: req.declaredValueKobo,
    }),
  );
}

// ─── Book (money mutation → escrow → Idempotency-Key) ──────────────────────────
export async function bookParcel(req: ParcelBookRequest): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(900);
    const est = mockParcelEstimate(req);
    const parcel = makeParcel({
      pickup: req.pickup,
      dropoff: req.dropoff,
      category: req.category,
      size: req.size,
      speed: req.speed,
      declaredValueKobo: req.declaredValueKobo,
      fareKobo: est.totalKobo,
      receiverName: req.receiverName,
      receiverPhone: req.receiverPhone,
      photoUrl: req.photoUrl ?? null,
      phase: 'created',
    });
    parcelStore.active = parcel;
    return parcel;
  }
  return unwrap<Parcel>(
    await api.post(
      `${BASE}/mobility/parcels`,
      {
        pickup: req.pickup,
        dropoff: req.dropoff,
        category: req.category,
        size: req.size,
        speed: req.speed,
        declared_value_kobo: req.declaredValueKobo,
        receiver_name: req.receiverName,
        receiver_phone: req.receiverPhone,
        photo_url: req.photoUrl,
        prohibited_ack: req.prohibitedAck,
        payment_method: req.paymentMethod,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getParcel(id: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(260);
    if (parcelStore.active?.id === id) return advanceMockParcel(parcelStore.active);
    const found = MOCK_PARCEL_HISTORY.find((p) => p.id === id);
    if (!found) throw new Error('Parcel not found');
    return found;
  }
  return unwrap<Parcel>(await api.get(`${BASE}/mobility/parcels/${id}`));
}

export async function getParcels(): Promise<Parcel[]> {
  if (USE_MOCK) {
    await delay();
    const list = [...MOCK_PARCEL_HISTORY];
    if (parcelStore.active) list.unshift(advanceMockParcel(parcelStore.active));
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<Parcel[]>(await api.get(`${BASE}/mobility/parcels`));
}

export async function cancelParcel(id: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(500);
    const p = parcelStore.active;
    if (p) {
      p.phase = 'cancelled';
      p.paymentStatus = 'refunded';
      parcelStore.active = null;
    }
    return p ?? makeParcel({ phase: 'cancelled', paymentStatus: 'refunded' });
  }
  return unwrap<Parcel>(await api.post(`${BASE}/mobility/parcels/${id}/cancel`, {}));
}

// ─── Rating (reuses the shared trip-ratings service) ───────────────────────────
export async function rateParcel(id: string, stars: number, comment?: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    if (parcelStore.active?.id === id) parcelStore.active.rated = true;
    const h = MOCK_PARCEL_HISTORY.find((p) => p.id === id);
    if (h) h.rated = true;
    return;
  }
  await api.post(`${BASE}/mobility/parcels/${id}/rate`, { stars, comment });
}

// ═══════════════════════════════════════════════════════════════════════════════
// COURIER (driver) endpoints
// ═══════════════════════════════════════════════════════════════════════════════
export async function getCourierRequests(): Promise<CourierParcelRequest[]> {
  if (USE_MOCK) {
    await delay(360);
    return mockCourierRequests();
  }
  return unwrap<CourierParcelRequest[]>(await api.get(`${BASE}/driver/parcels/requests`));
}

export async function acceptCourierRequest(id: string, idempotencyKey: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(600);
    return makeParcel({ id, phase: 'courier_assigned', courier: MOCK_COURIER });
  }
  return unwrap<Parcel>(await api.post(`${BASE}/driver/parcels/${id}/accept`, {}, idemHeader(idempotencyKey)));
}

export async function courierVerifyPickupPin(id: string, pin: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(400);
    if (!/^\d{4}$/.test(pin)) {
      const err = new Error('Incorrect pickup PIN. Ask the sender for the 4-digit code.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_PIN';
      err.status = 422;
      throw err;
    }
    return makeParcel({ id, phase: 'pickup_pin_verified', courier: MOCK_COURIER });
  }
  return unwrap<Parcel>(await api.post(`${BASE}/driver/parcels/${id}/verify-pickup-pin`, { pin }));
}

export async function courierPickedUp(id: string, photoUrl: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(500);
    return makeParcel({ id, phase: 'in_transit', courier: MOCK_COURIER, photoUrl });
  }
  return unwrap<Parcel>(await api.post(`${BASE}/driver/parcels/${id}/picked-up`, { photo_url: photoUrl }));
}

export async function courierVerifyDropoff(id: string, pin: string, proofUrl: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(500);
    if (!/^\d{4}$/.test(pin)) {
      const err = new Error('Incorrect delivery PIN. Ask the receiver for the 4-digit code.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_PIN';
      err.status = 422;
      throw err;
    }
    return makeParcel({ id, phase: 'delivered', courier: MOCK_COURIER, proofUrl, paymentStatus: 'settled', deliveredAt: new Date().toISOString(), pickupPin: null, dropoffPin: null });
  }
  return unwrap<Parcel>(await api.post(`${BASE}/driver/parcels/${id}/verify-dropoff`, { pin, proof_url: proofUrl }));
}

export function clearMockActiveParcel(): void {
  if (USE_MOCK) parcelStore.active = null;
}

export { USE_MOCK };
