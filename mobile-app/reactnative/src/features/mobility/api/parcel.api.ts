// Typed data layer the parcel screens code against. Mirrors mobility.api.ts:
// mock-flagged, BASE = '/api/v1', Idempotency-Key on money mutations.
// the Go endpoints land.
// fares/insurance come from the SERVER — never computed here.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  Parcel,
  ParcelPhase,
  ParcelEstimate,
  ParcelEstimateRequest,
  ParcelBookRequest,
  CourierParcelRequest,
} from '../types/modes.types';
import {
  buildParcelCardDirectBody,
  normalizeParcelStatus,
  parcelCardDirectStatusPath,
  PARCEL_CARD_DIRECT_BASE,
  type CardDirectIntent,
  type CardDirectStatus,
  type ParcelCardDirectInput,
} from '../utils/cardDirect';
import {
  toCourierActionPhase,
  toCourierHistory,
  toCourierRequests,
  toParcel,
  toParcelList,
  type CourierDelivery,
} from '../utils/parcelWire';
import {
  mockParcelEstimate,
  makeParcel,
  parcelStore,
  advanceMockParcel,
  MOCK_PARCEL_HISTORY,
  MOCK_COURIER,
  mockCourierRequests,
  mockBookRefusal,
  mockRefusal,
} from './parcel.mock';

const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_PARCEL_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK, true);

const BASE = '/api/v1';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

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

export async function bookParcel(req: ParcelBookRequest): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(900);
    mockBookRefusal(req);
    const est = mockParcelEstimate(req);
    const premium = req.insure ? est.insuranceKobo : 0;
    const parcel = makeParcel({
      pickup: req.pickup,
      dropoff: req.dropoff,
      category: req.category,
      size: req.size,
      speed: req.speed,
      declaredValueKobo: req.declaredValueKobo,
      fareKobo: est.fareKobo,
      receiverName: req.receiverName,
      receiverPhone: req.receiverPhone,
      photoUrl: req.photoUrl ?? null,
      phase: 'created',
      insuranceOpted: !!req.insure,
      insurancePaidKobo: premium,
      insuranceStatus: req.insure ? 'held' : req.declaredValueKobo > 0 ? 'declined' : 'none',
    });
    parcelStore.active = parcel;
    return parcel;
  }
  // Go returns the flat parcel (status, pickupAddress…) — see utils/parcelWire.
  return toParcel(
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
        ...(req.expectedFareKobo != null ? { expected_fare_kobo: req.expectedFareKobo } : {}),
        ...(req.routeToken ? { route_token: req.routeToken } : {}),
        ...(req.insure ? { insure: true, expected_insurance_kobo: req.expectedInsuranceKobo } : {}),
      },
      idemHeader(req.idempotencyKey),
    ).then((res) => unwrap<unknown>(res)),
  );
}

// ── Card-direct (pay by debit card, never the wallet KYC-tier gate) ─────────
// backend/internal/transport/paystackcheckout (parcel domain). Same pattern as
// initiateRidePaystack/getRidePaystackStatus in mobility.api.ts: the server
// quotes + freezes the amount, Paystack collects it, the server verifies and
// books. The wallet rail (bookParcel) keeps its KYC gate unchanged.

export type ParcelCardDirectIntent = CardDirectIntent;
export type ParcelCardDirectStatus = CardDirectStatus & { parcelId?: string };

export async function initiateParcelPaystack(
  req: ParcelCardDirectInput & { idempotencyKey: string },
): Promise<ParcelCardDirectIntent> {
  if (USE_MOCK) {
    await delay(600);
    if (req.insure) mockRefusal(422, 'INSURANCE_CARD_NOT_SUPPORTED');
    return {
      reference: `parcelorder-${req.idempotencyKey}`,
      authorizationUrl: `https://paystack.test/mock/${req.idempotencyKey}`,
      amountKobo: 0,
      status: 'pending',
    };
  }
  return unwrap<ParcelCardDirectIntent>(
    await api.post(
      `${BASE}${PARCEL_CARD_DIRECT_BASE}/initiate`,
      buildParcelCardDirectBody(req),
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getParcelPaystackStatus(reference: string): Promise<ParcelCardDirectStatus> {
  if (USE_MOCK) {
    await delay(400);
    return { reference, status: 'confirmed', amountKobo: 0, parcelId: parcelStore.active?.id ?? 'mock-parcel-1' };
  }
  return normalizeParcelStatus(
    unwrap<{ reference: string; status: CardDirectStatus['status']; amountKobo?: number; parcelId?: string }>(
      await api.get(`${BASE}${parcelCardDirectStatusPath(reference)}`),
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
  return toParcel(unwrap<unknown>(await api.get(`${BASE}/mobility/parcels/${id}`)));
}

export async function getParcels(): Promise<Parcel[]> {
  if (USE_MOCK) {
    await delay();
    const list = [...MOCK_PARCEL_HISTORY];
    if (parcelStore.active) list.unshift(advanceMockParcel(parcelStore.active));
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  // { parcels: [...] } on the wire.
  return toParcelList(unwrap<unknown>(await api.get(`${BASE}/mobility/parcels`)));
}

// The server answers { ok, status, refund_status } — not a parcel — so callers
// refetch the detail if they need it.
export async function cancelParcel(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const p = parcelStore.active;
    if (p) {
      p.phase = 'cancelled';
      p.paymentStatus = 'refunded';
      parcelStore.active = null;
    }
    return;
  }
  await api.post(`${BASE}/mobility/parcels/${id}/cancel`, {});
}

export async function rateParcel(
  id: string,
  stars: number,
  idempotencyKey: string,
  comment?: string,
  tipKobo?: number,
): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    if (parcelStore.active?.id === id) parcelStore.active.rated = true;
    const h = MOCK_PARCEL_HISTORY.find((p) => p.id === id);
    if (h) h.rated = true;
    return;
  }
  await api.post(
    `${BASE}/mobility/parcels/${id}/rate`,
    { stars, comment, tip_kobo: tipKobo },
    idemHeader(idempotencyKey),
  );
}

// COURIER (driver) endpoints
export async function getCourierRequests(): Promise<CourierParcelRequest[]> {
  if (USE_MOCK) {
    await delay(360);
    return mockCourierRequests();
  }
  // { requests: [{ id, pickupAddress, … }] } on the wire.
  return toCourierRequests(unwrap<unknown>(await api.get(`${BASE}/driver/parcels/requests`)));
}

export async function acceptCourierRequest(id: string, idempotencyKey: string): Promise<Parcel> {
  if (USE_MOCK) {
    await delay(600);
    return makeParcel({ id, phase: 'courier_assigned', courier: MOCK_COURIER });
  }
  return toParcel(unwrap<unknown>(await api.post(`${BASE}/driver/parcels/${id}/accept`, {}, idemHeader(idempotencyKey))));
}

// Rider actions answer { ok, status }: each returns the phase the parcel is now in.
export async function courierVerifyPickupPin(id: string, pin: string): Promise<ParcelPhase> {
  if (USE_MOCK) {
    await delay(400);
    if (!/^\d{4}$/.test(pin)) {
      const err = new Error('Incorrect pickup PIN. Ask the sender for the 4-digit code.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_PIN';
      err.status = 422;
      throw err;
    }
    return 'pickup_pin_verified';
  }
  return toCourierActionPhase(
    unwrap<unknown>(await api.post(`${BASE}/driver/parcels/${id}/verify-pickup-pin`, { pin })),
    'pickup_pin_verified',
  );
}

export async function courierPickedUp(id: string, photoUrl: string): Promise<ParcelPhase> {
  if (USE_MOCK) {
    await delay(500);
    return 'in_transit';
  }
  return toCourierActionPhase(
    unwrap<unknown>(await api.post(`${BASE}/driver/parcels/${id}/picked-up`, { photo_url: photoUrl })),
    'in_transit',
  );
}

export async function courierVerifyDropoff(id: string, pin: string, proofUrl: string): Promise<ParcelPhase> {
  if (USE_MOCK) {
    await delay(500);
    if (!/^\d{4}$/.test(pin)) {
      const err = new Error('Incorrect delivery PIN. Ask the receiver for the 4-digit code.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_PIN';
      err.status = 422;
      throw err;
    }
    return 'delivered';
  }
  return toCourierActionPhase(
    unwrap<unknown>(await api.post(`${BASE}/driver/parcels/${id}/verify-dropoff`, { pin, proof_url: proofUrl })),
    'delivered',
  );
}

/**
 * The rider's own deliveries with what they were paid (server-computed net).
 * Returns null when the server has no history endpoint yet (404), so the
 * earnings screen can say so instead of totalling the wrong list.
 */
export async function getCourierHistory(): Promise<CourierDelivery[] | null> {
  if (USE_MOCK) {
    await delay(320);
    return MOCK_PARCEL_HISTORY.map((p) => ({
      parcelId: p.id,
      dropoff: p.dropoff,
      phase: p.phase,
      fareKobo: p.fareKobo,
      netKobo: null,
      deliveredAt: p.deliveredAt,
    }));
  }
  try {
    return toCourierHistory(unwrap<unknown>(await api.get(`${BASE}/driver/parcels/history`)));
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

export function clearMockActiveParcel(): void {
  if (USE_MOCK) parcelStore.active = null;
}

export { USE_MOCK };
