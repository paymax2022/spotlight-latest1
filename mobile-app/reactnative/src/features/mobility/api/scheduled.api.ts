// ── Schedule your logistics movement — API wrapper ───────────────────────────
// Typed data layer for advance-booking across ride hailing, ride sharing, parcel
// (intra + inter-state), airport pickup and advance bus seat booking. Mirrors
// parcel.api.ts / bus.api.ts: mock-flagged, camelCase types, {code,message}
// MobilityError normalisation, Idempotency-Key on create + cancel (persisted so
// an app-kill mid-request retries with the SAME key instead of double-booking).
//
// Backend contract (SWARM_INTEGRATION_CONTRACT.md): base
// /api/finance/mobility/scheduled. Money is charged/escrowed at DISPATCH time
// (not at booking) — this screen only ever shows an estimate, never a payment
// sheet. IRON RULES: all money is integer kobo; never computed on the client.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { getSecureItem, setSecureItem, deleteSecureItem } from '@/lib/secureStorage';

const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_SCHEDULED_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK, true);

const BASE = '/api/finance/mobility/scheduled';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// ─── Types (camelCase; mirrors ScheduledBooking from the OpenAPI contract) ─────
export type ScheduledMode =
  | 'ride_hail'
  | 'ride_share'
  | 'parcel_intra'
  | 'parcel_inter'
  | 'airport_pickup'
  | 'bus';

export type ScheduledStatus =
  | 'scheduled'
  | 'dispatch_pending'
  | 'dispatched'
  | 'completed'
  | 'cancelled'
  | 'failed_no_driver'
  | 'expired';

export type MaterializedKind = 'trip' | 'parcel' | 'bus_ticket';

export interface ScheduledPlace {
  label: string;
  lat: number;
  lng: number;
}

export type PricingMode = 'fixed' | 'negotiated';
export type VehicleClass = 'economy' | 'executive' | 'suv' | 'luxury' | 'van';

export interface RideModePayload {
  pricingMode: PricingMode;
  vehicleClass: VehicleClass;
}

export interface ParcelModePayload {
  dimensions: string;      // free-text e.g. "30x20x15 cm"
  weightKg: number;
  interState: boolean;
}

export interface AirportModePayload {
  flightNumber?: string;
  arrivalTime?: string;    // ISO — when set, pickup is derived (+45m) server-side
  terminal?: string;
}

export interface BusModePayload {
  scheduleId: string;
  seatNumber: string;
}

export type ScheduledModePayload =
  | RideModePayload
  | ParcelModePayload
  | AirportModePayload
  | BusModePayload
  | Record<string, unknown>;

export interface ScheduledBooking {
  id: string;
  marketId: string;
  mode: ScheduledMode;
  status: ScheduledStatus;
  scheduledPickupAt: string;    // ISO
  leadTimeMinutes: number;
  timezone: string;
  pickup: ScheduledPlace | null;
  dropoff: ScheduledPlace | null;
  modePayload: ScheduledModePayload;
  estimatedFareKobo: number | null;
  currency: 'NGN';
  paymentMethod: string;
  materializedRef: string | null;
  materializedKind: MaterializedKind | null;
  dispatchAttempts: number;
  lastDispatchError: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface CreateScheduledRequest {
  mode: ScheduledMode;
  scheduledPickupAt: string;
  leadTimeMinutes?: number;
  pickup: ScheduledPlace;
  dropoff: ScheduledPlace;
  modePayload: ScheduledModePayload;
  paymentMethod?: string;
}

export interface CreateScheduledResult {
  booking: ScheduledBooking;
  estimatedFareKobo: number;
}

export type ScheduledFilter = 'upcoming' | 'past' | 'all';

export interface ListScheduledParams {
  filter?: ScheduledFilter;
  cursor?: string;
  limit?: number;
}

export interface ListScheduledResult {
  items: ScheduledBooking[];
  nextCursor: string | null;
}

export interface RescheduleRequest {
  scheduledPickupAt?: string;
  leadTimeMinutes?: number;
  pickup?: ScheduledPlace;
  dropoff?: ScheduledPlace;
  modePayload?: ScheduledModePayload;
}

export interface EstimateScheduledRequest {
  mode: ScheduledMode;
  scheduledPickupAt: string;
  pickup: ScheduledPlace;
  dropoff: ScheduledPlace;
  modePayload: ScheduledModePayload;
}

export interface EstimateScheduledResult {
  estimatedFareKobo: number;
  currency: 'NGN';
  distanceM?: number;
  durationS?: number;
}

// ─── Idempotency-Key persistence ────────────────────────────────────────────
// Persisted via the app's existing secure storage (expo-secure-store, web
// localStorage fallback — see src/lib/secureStorage.ts) so an app-kill mid
// create/cancel request retries with the SAME key instead of risking a
// duplicate booking or a duplicate cancel side-effect. Keyed by a caller-chosen
// scope (a draft token for create, the booking id for cancel) so concurrent
// drafts/cancels never collide.
const IDEM_PREFIX = 'sched_idem_';

function newKey(prefix: string): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const rand = typeof g.crypto?.randomUUID === 'function'
    ? g.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

/**
 * Fetch the persisted Idempotency-Key for `scope`, generating and persisting a
 * fresh one on first use. Call `clearIdempotencyKey(scope)` once the mutation
 * that used it has definitively succeeded (or definitively, non-retryably
 * failed) so the next attempt for that scope starts clean.
 */
export async function getOrCreateIdempotencyKey(scope: string, prefix = 'sched'): Promise<string> {
  const storageKey = `${IDEM_PREFIX}${scope}`;
  const existing = await getSecureItem(storageKey);
  if (existing) return existing;
  const key = newKey(prefix);
  await setSecureItem(storageKey, key);
  return key;
}

export async function clearIdempotencyKey(scope: string): Promise<void> {
  await deleteSecureItem(`${IDEM_PREFIX}${scope}`);
}

// ─── Mock store (deterministic; walkable without the Go backend) ───────────
let mockSeq = 0;
const mockBookings = new Map<string, ScheduledBooking>();

function estimateFareFor(mode: ScheduledMode): number {
  switch (mode) {
    case 'ride_hail': return 350_000;
    case 'ride_share': return 220_000;
    case 'parcel_intra': return 180_000;
    case 'parcel_inter': return 650_000;
    case 'airport_pickup': return 900_000;
    case 'bus': return 1_200_000;
    default: return 250_000;
  }
}

function makeMockBooking(req: CreateScheduledRequest, idempotencyKey: string): ScheduledBooking {
  mockSeq += 1;
  const now = new Date().toISOString();
  const fare = estimateFareFor(req.mode);
  const booking: ScheduledBooking = {
    id: `sched_mock_${mockSeq}`,
    marketId: 'NG',
    mode: req.mode,
    status: 'scheduled',
    scheduledPickupAt: req.scheduledPickupAt,
    leadTimeMinutes: req.leadTimeMinutes ?? 30,
    timezone: 'Africa/Lagos',
    pickup: req.pickup,
    dropoff: req.dropoff,
    modePayload: req.modePayload,
    estimatedFareKobo: fare,
    currency: 'NGN',
    paymentMethod: req.paymentMethod ?? 'wallet',
    materializedRef: null,
    materializedKind: null,
    dispatchAttempts: 0,
    lastDispatchError: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    completedAt: null,
    cancelledAt: null,
  };
  mockBookings.set(booking.id, booking);
  return booking;
}

function seedMockHistoryOnce() {
  if (mockBookings.size > 0) return;
  const now = Date.now();
  const upcoming = makeMockBooking(
    {
      mode: 'airport_pickup',
      scheduledPickupAt: new Date(now + 3 * 3_600_000).toISOString(),
      pickup: { label: 'Home — 14 Admiralty Way, Lekki', lat: 6.4459, lng: 3.473 },
      dropoff: { label: 'Murtala Muhammed International Airport (MMIA)', lat: 6.5774, lng: 3.3212 },
      modePayload: { flightNumber: 'BA075', arrivalTime: new Date(now + 2.25 * 3_600_000).toISOString(), terminal: 'International' } as AirportModePayload,
    },
    'seed-1',
  );
  upcoming.status = 'scheduled';

  const past = makeMockBooking(
    {
      mode: 'ride_hail',
      scheduledPickupAt: new Date(now - 26 * 3_600_000).toISOString(),
      pickup: { label: 'Ikeja City Mall, Alausa', lat: 6.6186, lng: 3.3585 },
      dropoff: { label: 'Victoria Island, Lagos', lat: 6.4281, lng: 3.4219 },
      modePayload: { pricingMode: 'fixed', vehicleClass: 'economy' } as RideModePayload,
    },
    'seed-2',
  );
  past.status = 'completed';
  past.materializedRef = 'trip_mock_991';
  past.materializedKind = 'trip';
  past.dispatchedAt = new Date(now - 25 * 3_600_000).toISOString();
  past.completedAt = new Date(now - 24 * 3_600_000).toISOString();

  const failed = makeMockBooking(
    {
      mode: 'parcel_inter',
      scheduledPickupAt: new Date(now - 5 * 3_600_000).toISOString(),
      pickup: { label: 'Ikeja, Lagos', lat: 6.6018, lng: 3.3515 },
      dropoff: { label: 'Wuse 2, Abuja', lat: 9.0765, lng: 7.4951 },
      modePayload: { dimensions: '40x30x20 cm', weightKg: 6, interState: true } as ParcelModePayload,
    },
    'seed-3',
  );
  failed.status = 'failed_no_driver';
  failed.lastDispatchError = 'No courier accepted the inter-state parcel within the fallback window.';
}

// ─── Estimate ────────────────────────────────────────────────────────────────
export async function estimateScheduled(req: EstimateScheduledRequest): Promise<EstimateScheduledResult> {
  if (USE_MOCK) {
    await delay(360);
    return { estimatedFareKobo: estimateFareFor(req.mode), currency: 'NGN' };
  }
  return unwrap<EstimateScheduledResult>(
    await api.post(`${BASE}/estimate`, {
      mode: req.mode,
      scheduled_pickup_at: req.scheduledPickupAt,
      pickup: req.pickup,
      dropoff: req.dropoff,
      mode_payload: req.modePayload,
    }),
  );
}

// ─── Create (money-adjacent → escrow happens at dispatch, but the endpoint
// still requires an Idempotency-Key so a retried submit never double-books) ──
export async function createScheduled(
  req: CreateScheduledRequest,
  idempotencyKey: string,
): Promise<CreateScheduledResult> {
  if (USE_MOCK) {
    await delay(700);
    seedMockHistoryOnce();
    const booking = makeMockBooking(req, idempotencyKey);
    return { booking, estimatedFareKobo: booking.estimatedFareKobo ?? 0 };
  }
  const raw = unwrap<{
    booking?: ScheduledBooking;
    estimated_fare_kobo?: number;
    id?: string;
  } & Record<string, unknown>>(
    await api.post(
      BASE,
      {
        mode: req.mode,
        scheduled_pickup_at: req.scheduledPickupAt,
        lead_time_minutes: req.leadTimeMinutes,
        pickup: req.pickup,
        dropoff: req.dropoff,
        mode_payload: req.modePayload,
        payment_method: req.paymentMethod,
      },
      idemHeader(idempotencyKey),
    ),
  );
  // Backend returns the booking fields at top-level alongside estimated_fare_kobo.
  const booking = (raw.booking ?? raw) as unknown as ScheduledBooking;
  return { booking, estimatedFareKobo: raw.estimated_fare_kobo ?? booking.estimatedFareKobo ?? 0 };
}

// ─── List ────────────────────────────────────────────────────────────────────
export async function listScheduled(params?: ListScheduledParams): Promise<ListScheduledResult> {
  if (USE_MOCK) {
    await delay(300);
    seedMockHistoryOnce();
    const now = Date.now();
    const all = [...mockBookings.values()].sort(
      (a, b) => +new Date(b.scheduledPickupAt) - +new Date(a.scheduledPickupAt),
    );
    const filter = params?.filter ?? 'all';
    const items = all.filter((b) => {
      if (filter === 'all') return true;
      const isPast = +new Date(b.scheduledPickupAt) < now || ['completed', 'cancelled', 'expired'].includes(b.status);
      return filter === 'past' ? isPast : !isPast;
    });
    return { items, nextCursor: null };
  }
  const res = await api.get(BASE, { params: { filter: params?.filter, cursor: params?.cursor, limit: params?.limit } });
  const raw = (res.data?.data ?? res.data) as { items?: ScheduledBooking[]; next_cursor?: string | null } | ScheduledBooking[];
  if (Array.isArray(raw)) return { items: raw, nextCursor: null };
  return { items: raw.items ?? [], nextCursor: raw.next_cursor ?? null };
}

// ─── Detail ──────────────────────────────────────────────────────────────────
export async function getScheduled(id: string): Promise<ScheduledBooking> {
  if (USE_MOCK) {
    await delay(220);
    seedMockHistoryOnce();
    const found = mockBookings.get(id);
    if (!found) throw new Error('Scheduled trip not found');
    return found;
  }
  return unwrap<ScheduledBooking>(await api.get(`${BASE}/${id}`));
}

// ─── Reschedule / edit (only while status === 'scheduled') ─────────────────
export async function rescheduleScheduled(id: string, req: RescheduleRequest): Promise<ScheduledBooking> {
  if (USE_MOCK) {
    await delay(450);
    const b = mockBookings.get(id);
    if (!b) throw new Error('Scheduled trip not found');
    if (b.status !== 'scheduled') {
      const err = new Error('This trip can no longer be edited.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_STATE';
      err.status = 409;
      throw err;
    }
    if (req.scheduledPickupAt) b.scheduledPickupAt = req.scheduledPickupAt;
    if (req.leadTimeMinutes != null) b.leadTimeMinutes = req.leadTimeMinutes;
    if (req.pickup) b.pickup = req.pickup;
    if (req.dropoff) b.dropoff = req.dropoff;
    if (req.modePayload) b.modePayload = req.modePayload;
    b.updatedAt = new Date().toISOString();
    return b;
  }
  return unwrap<ScheduledBooking>(
    await api.patch(`${BASE}/${id}`, {
      scheduled_pickup_at: req.scheduledPickupAt,
      lead_time_minutes: req.leadTimeMinutes,
      pickup: req.pickup,
      dropoff: req.dropoff,
      mode_payload: req.modePayload,
    }),
  );
}

// ─── Cancel (Idempotency-Key; refunds via settlement if already escrowed) ──
export async function cancelScheduled(
  id: string,
  idempotencyKey: string,
  reason?: string,
): Promise<ScheduledBooking> {
  if (USE_MOCK) {
    await delay(500);
    const b = mockBookings.get(id);
    if (!b) throw new Error('Scheduled trip not found');
    if (!['scheduled', 'dispatch_pending'].includes(b.status)) {
      const err = new Error('This trip can no longer be cancelled.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_STATE';
      err.status = 409;
      throw err;
    }
    b.status = 'cancelled';
    b.cancelReason = reason ?? null;
    b.cancelledAt = new Date().toISOString();
    b.updatedAt = b.cancelledAt;
    return b;
  }
  return unwrap<ScheduledBooking>(
    await api.post(`${BASE}/${id}/cancel`, { reason }, idemHeader(idempotencyKey)),
  );
}

export { USE_MOCK };
