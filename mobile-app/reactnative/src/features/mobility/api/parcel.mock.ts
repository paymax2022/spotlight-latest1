// All money is integer kobo. The "pricing engine" mimics the SERVER: the client
// only ever reads the values it returns, never recomputes fares.

import type {
  ParcelBookRequest,
  Parcel,
  ParcelEstimate,
  ParcelEstimateRequest,
  ParcelCategory,
  ParcelSize,
  ParcelSpeed,
  CourierParcelRequest,
  Courier,
  Place,
} from '../types/modes.types';
import { haversineMeters } from '../utils/mobilityFormatters';
import { advanceParcelPhase } from '../utils/parcelMockAdvance';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const isoAhead = (ms: number) => new Date(now() + ms).toISOString();
const pin = () => String(1000 + Math.floor(Math.random() * 9000));

const SIZE_MULT: Record<ParcelSize, number> = { small: 1, medium: 1.4, large: 2.1 };
const SPEED_MULT: Record<ParcelSpeed, number> = { standard: 1, express: 1.5, same_day: 2.2 };

const DEFAULT_PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DEFAULT_DROPOFF: Place = { address: 'Ikeja City Mall, Alausa', lat: 6.6186, lng: 3.3585 };

export const MOCK_COURIER: Courier = {
  id: 'cou_1',
  name: 'Bashir Lawal',
  photoUrl: null,
  rating: 4.89,
  vehicle: 'Bike • LND-902-AKD',
  phoneMasked: '+234 ••• ••• 7781',
};

/** Deterministic estimate engine — stands in for the server fare engine. */
export function mockParcelEstimate(req: ParcelEstimateRequest): ParcelEstimate {
  const straight = haversineMeters(req.pickup, req.dropoff);
  const distanceM = Math.max(800, Math.round(straight * 1.3));
  const durationS = Math.max(600, Math.round(distanceM / 6));
  const base = 600_00; // ₦600 base
  const perKm = 130_00;
  const km = distanceM / 1000;
  const raw = base + Math.round(perKm * km);
  const fareFor = (size: ParcelSize, speed: ParcelSpeed) => Math.round(raw * SIZE_MULT[size] * SPEED_MULT[speed]);
  const fareKobo = fareFor(req.size, req.speed);
  const minPremiumKobo = 2000_00; // the insurer's minimum premium
  const insuranceKobo = req.declaredValueKobo > 0 ? Math.max(Math.round(req.declaredValueKobo * 0.005), minPremiumKobo) : 0;
  const sizes: ParcelSize[] = ['small', 'medium', 'large'];
  const speeds: ParcelSpeed[] = ['standard', 'express', 'same_day'];
  return {
    distanceM,
    durationS,
    fareKobo,
    insuranceKobo,
    totalKobo: fareKobo + insuranceKobo,
    currency: 'NGN',
    options: sizes.flatMap((size) => speeds.map((speed) => ({ size, speed, fareKobo: fareFor(size, speed) }))),
    insurance: {
      productCode: 'mycover:sti-git-on-demand',
      productName: 'On Demand Goods In Transit',
      underwriter: 'Sovereign Trust Insurance Plc',
      provider: 'mycover',
      minPremiumKobo,
      indicative: true,
    },
  };
}

export function makeParcel(overrides: Partial<Parcel> = {}): Parcel {
  const est = mockParcelEstimate({
    pickup: DEFAULT_PICKUP,
    dropoff: DEFAULT_DROPOFF,
    category: 'documents',
    size: 'small',
    speed: 'standard',
    declaredValueKobo: 0,
  });
  return {
    id: `pcl_${now()}`,
    phase: 'created',
    pickup: DEFAULT_PICKUP,
    dropoff: DEFAULT_DROPOFF,
    category: 'documents',
    size: 'small',
    speed: 'standard',
    declaredValueKobo: 0,
    fareKobo: est.totalKobo,
    currency: 'NGN',
    receiverName: 'Chioma Eze',
    receiverPhone: '+2348030000010',
    photoUrl: null,
    pickupPin: pin(),
    dropoffPin: pin(),
    proofUrl: null,
    courier: null,
    paymentStatus: 'escrowed',
    createdAt: iso(),
    deliveredAt: null,
    rated: false,
    ...overrides,
  };
}

export const parcelStore: { active: Parcel | null } = { active: null };

export const MOCK_PARCEL_HISTORY: Parcel[] = [
  makeParcel({
    id: 'pcl_h1', phase: 'delivered', category: 'electronics', size: 'medium', speed: 'express',
    fareKobo: 2_400_00, paymentStatus: 'settled', courier: MOCK_COURIER, pickupPin: null, dropoffPin: null,
    proofUrl: 'mock://proof/1', createdAt: iso(86_400_000 * 3), deliveredAt: iso(86_400_000 * 3 - 5_400_000), rated: true,
  }),
  makeParcel({
    id: 'pcl_h2', phase: 'cancelled', fareKobo: 0, paymentStatus: 'refunded',
    pickupPin: null, dropoffPin: null, createdAt: iso(86_400_000 * 8), rated: false,
  }),
];

/** Advances a parcel through its state machine over time (a new object when it moves). */
export function advanceMockParcel(p: Parcel): Parcel {
  return advanceParcelPhase(p, now(), MOCK_COURIER);
}

export function mockCourierRequests(): CourierParcelRequest[] {
  const mk = (id: string, pk: Place, dp: Place, category: ParcelCategory, size: ParcelSize, speed: ParcelSpeed): CourierParcelRequest => {
    const est = mockParcelEstimate({ pickup: pk, dropoff: dp, category, size, speed, declaredValueKobo: 0 });
    return {
      parcelId: id,
      pickup: pk, dropoff: dp, category, size, speed,
      distanceM: est.distanceM,
      fareKobo: est.fareKobo,
      estCourierNetKobo: Math.round(est.fareKobo * 0.8),
      currency: 'NGN',
      expiresAt: isoAhead(45_000),
    };
  };
  return [
    mk('pcl_req_1', DEFAULT_PICKUP, DEFAULT_DROPOFF, 'documents', 'small', 'express'),
    mk('pcl_req_2', { address: 'The Palms, Lekki', lat: 6.4396, lng: 3.4509 }, { address: 'Yaba, Lagos', lat: 6.5095, lng: 3.3711 }, 'electronics', 'medium', 'standard'),
  ];
}

// ── Booking refusals (mock) ─────────────────────────────────────────────────
// The server's insurance refusals in the axios error shape, so the screen's
// handling can be exercised on the mock build. A QA knob picks one:
//   globalThis.__PARCEL_MOCK_BOOK_ERROR__ = 'INSURANCE_PROFILE_INCOMPLETE'
// (one-shot: it clears after firing). Mock builds only — the live path never reads it.

export function mockRefusal(status: number, code: string, details: Record<string, unknown> = {}): never {
  const err = new Error(code) as Error & { response: { status: number; data: Record<string, unknown> } };
  err.response = { status, data: { code, error: code, ...details } };
  throw err;
}

const MOCK_REFUSALS: Record<string, (req: ParcelBookRequest) => never> = {
  INSURANCE_PROFILE_INCOMPLETE: () => mockRefusal(422, 'INSURANCE_PROFILE_INCOMPLETE', { missing: ['gender', 'date_of_birth', 'address'] }),
  INSURANCE_DECLARED_VALUE_REQUIRED: () => mockRefusal(422, 'INSURANCE_DECLARED_VALUE_REQUIRED'),
  INSUFFICIENT_FUNDS: () => mockRefusal(402, 'INSUFFICIENT_FUNDS'),
  IDEMPOTENCY_KEY_CONFLICT: () => mockRefusal(409, 'IDEMPOTENCY_KEY_CONFLICT'),
  FARE_CHANGED: (req) => mockRefusal(409, 'FARE_CHANGED', {
    insurance_kobo: (req.expectedInsuranceKobo ?? 0) + 500_00,
    expected_insurance_kobo: req.expectedInsuranceKobo ?? 0,
  }),
};

export function mockBookRefusal(req: ParcelBookRequest): void {
  const g = globalThis as { __PARCEL_MOCK_BOOK_ERROR__?: string };
  const code = g.__PARCEL_MOCK_BOOK_ERROR__;
  if (!code || !MOCK_REFUSALS[code]) return;
  g.__PARCEL_MOCK_BOOK_ERROR__ = undefined;
  MOCK_REFUSALS[code](req);
}
