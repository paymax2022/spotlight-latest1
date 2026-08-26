// ── Paymax Mobility — API wrapper ────────────────────────────────────────────
// Typed data layer the screens code against. Mirrors fx.api.ts: mock-flagged.
// Flip EXPO_PUBLIC_MOBILITY_USE_MOCK=false once the Go endpoints under
// /api/finance/transport land.
//
// IRON RULES honoured here:
//  • all money is integer kobo;
//  • every money mutation (request/accept-counter/rate) carries an Idempotency-Key;
//  • fare floors/ceilings/commission come from the SERVER — never computed here.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  MobilityHome,
  PricingConfig,
  RideEstimate,
  RideEstimateRequest,
  RideRequest,
  Trip,
  FareOffer,
  ShareLink,
  RateDraft,
  Rating,
  ServiceType,
  TrustedContact,
  SafetyIncident,
  DriverProfile,
  OnboardingSubmitDraft,
  DocumentDraft,
  VehicleDraft,
  DriverRideRequest,
  DriverEarnings,
  Kobo,
  LatLng,
} from '../types/mobility.types';
import {
  mockEstimate,
  mockPricingConfig,
  makeTrip,
  mockStore,
  MOCK_QUICK_TILES,
  MOCK_HISTORY,
  MOCK_DRIVER,
  MOCK_VEHICLE,
  MOCK_TRUSTED_CONTACTS,
  mockDriver,
  mockDriverRequests,
  mockEarnings,
} from './mobility.mock';

// ─── Feature flag: mock by default; flip to hit the Go backend ─────────────────
const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK, true);

// Go backend mounts the mobility + driver route groups directly under
// /api/finance (siblings of the legacy /transport group). The frontend-web Next
// proxies /api/v1/mobility/* → /api/finance/mobility/* and /api/v1/driver/* →
// /api/finance/driver/*, so BASE is /api/v1 and each call appends /mobility/...
// or /driver/... — e.g. /api/v1/mobility/home.
const BASE = '/api/v1';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// The backend returns trips as a nested envelope
//   { trip: {...}, driver: {...}, vehicle: {...}, fareOffer: {...} }
// (all camelCase). The screens expect a FLAT Trip with driver/vehicle/fareOffer
// attached, so collapse the envelope here. If a plain (already-flat) trip is
// returned we pass it through unchanged.
type TripEnvelope = {
  trip?: Partial<Trip>;
  driver?: Trip['driver'];
  vehicle?: Trip['vehicle'];
  fareOffer?: Trip['fareOffer'];
};
// Live trips carry flat pickupAddress/destAddress strings (no coordinates in
// the payload); screens type against full Place objects. Synthesize a Place
// from the flat address when the nested one is absent so Trip.pickup/dest are
// ALWAYS present — the type stays strict and no screen needs a guard.
function ensurePlaces(trip: Partial<Trip>): Trip {
  return {
    ...(trip as Trip),
    pickup: trip.pickup ?? { lat: 0, lng: 0, address: trip.pickupAddress ?? '' },
    dest: trip.dest ?? { lat: 0, lng: 0, address: trip.destAddress ?? '' },
  };
}

function flattenTrip(raw: TripEnvelope | Trip | null | undefined): Trip {
  const env = (raw ?? {}) as TripEnvelope & Partial<Trip>;
  // Flat shape already: no nested `trip` key → the object *is* the trip.
  if (!env.trip) return ensurePlaces(env as Partial<Trip>);
  return ensurePlaces({
    ...(env.trip as Trip),
    driver: env.driver ?? env.trip.driver ?? null,
    vehicle: env.vehicle ?? env.trip.vehicle ?? null,
    fareOffer: env.fareOffer ?? env.trip.fareOffer ?? null,
  });
}

// ─── Home ─────────────────────────────────────────────────────────────────────
export async function getHome(): Promise<MobilityHome> {
  if (USE_MOCK) {
    await delay();
    return {
      activeTrip: mockStore.activeTrip,
      profile: { name: 'Ada', photoUrl: null, rating: 4.9 },
      quickTiles: MOCK_QUICK_TILES.map((t) => t.id),
      safetyReminder: 'Always confirm the plate number and your trip PIN before getting in.',
    };
  }
  // Backend home is snake_case: { active_trip, profile, quick_tiles, safety_reminder }
  // (Go gin.H keys — see backend/internal/transport/customer_handler.go:Home).
  // active_trip is a trip envelope (or null); flatten it for the screens.
  const body = unwrap<{
    active_trip?: TripEnvelope | null;
    activeTrip?: TripEnvelope | null;
    profile?: MobilityHome['profile'];
    quick_tiles?: string[];
    quickTiles?: string[];
    safety_reminder?: string;
    safetyReminder?: string;
  }>(await api.get(`${BASE}/mobility/home`));
  const active = body?.active_trip ?? body?.activeTrip;
  return {
    activeTrip: active ? flattenTrip(active) : null,
    profile: body?.profile ?? null,
    quickTiles: body?.quick_tiles ?? body?.quickTiles ?? [],
    safetyReminder: body?.safety_reminder ?? body?.safetyReminder ?? '',
  };
}

// ─── Pricing config ─────────────────────────────────────────────────────────────
export async function getPricingConfig(
  serviceType: ServiceType,
  zone?: string,
): Promise<PricingConfig> {
  if (USE_MOCK) {
    await delay(200);
    return mockPricingConfig(serviceType, zone);
  }
  return unwrap<PricingConfig>(
    await api.get(`${BASE}/mobility/config/pricing`, { params: { zone, service_type: serviceType } }),
  );
}

// ─── Estimate ─────────────────────────────────────────────────────────────────
export async function estimateRide(req: RideEstimateRequest): Promise<RideEstimate> {
  if (USE_MOCK) {
    await delay(420);
    return mockEstimate(req);
  }
  return unwrap<RideEstimate>(
    await api.post(`${BASE}/mobility/rides/estimate`, {
      pickup: req.pickup,
      dest: req.dest,
      service_type: req.serviceType,
    }),
  );
}

// ─── Request a ride (money mutation → escrow → Idempotency-Key) ────────────────
export async function requestRide(req: RideRequest): Promise<Trip> {
  if (USE_MOCK) {
    await delay(900);
    const est = mockEstimate({ pickup: req.pickup, dest: req.dest, serviceType: req.serviceType });
    const isOffer = req.pricingMode === 'offer';
    const trip = makeTrip({
      serviceType: req.serviceType,
      pricingMode: req.pricingMode,
      pickup: req.pickup,
      dest: req.dest,
      distanceM: est.distanceM,
      durationS: est.durationS,
      systemFareKobo: est.systemFareKobo,
      fareKobo: isOffer ? (req.offerKobo ?? est.systemFareKobo) : est.systemFareKobo,
      surgeMultiplier: est.surgeMultiplier,
      paymentMethod: req.paymentMethod,
      polyline: est.polyline,
      phase: isOffer ? 'fare_negotiating' : 'requested',
      status: 'requested',
      fareOffer: isOffer
        ? {
            id: `offer_${Date.now()}`,
            tripId: 'pending',
            riderOfferKobo: req.offerKobo ?? est.systemFareKobo,
            driverCounterKobo: null,
            status: 'pending',
            createdAt: new Date().toISOString(),
          }
        : null,
    });
    mockStore.activeTrip = trip;
    return trip;
  }
  return flattenTrip(
    unwrap<TripEnvelope>(
      await api.post(
        `${BASE}/mobility/rides/request`,
        {
          pickup: req.pickup,
          dest: req.dest,
          service_type: req.serviceType,
          pricing_mode: req.pricingMode,
          offer_kobo: req.offerKobo,
          payment_method: req.paymentMethod,
        },
        idemHeader(req.idempotencyKey),
      ),
    ),
  );
}

// ─── Fare negotiation ───────────────────────────────────────────────────────────
/** Rider makes (or updates) an offer. Server validates the range → 422 if out of bounds. */
export async function makeOffer(tripId: string, offerKobo: Kobo): Promise<FareOffer> {
  if (USE_MOCK) {
    await delay(500);
    const trip = mockStore.activeTrip;
    const offer: FareOffer = {
      id: `offer_${Date.now()}`,
      tripId,
      riderOfferKobo: offerKobo,
      driverCounterKobo: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    if (trip) {
      trip.phase = 'fare_negotiating';
      trip.fareOffer = offer;
    }
    return offer;
  }
  return unwrap<FareOffer>(await api.post(`${BASE}/mobility/rides/${tripId}/offer`, { offer_kobo: offerKobo }));
}

/** Rider accepts a driver's counter; server re-escrows the delta. Idempotent.
 *  The backend responds with the accepted FareOffer (NOT a trip), so we re-fetch
 *  the trip afterwards to hand the screens the full, flattened Trip they read
 *  (phase / driver / vehicle / fareOffer). */
export async function acceptCounter(tripId: string, idempotencyKey: string): Promise<Trip> {
  if (USE_MOCK) {
    await delay(700);
    const trip = mockStore.activeTrip;
    if (trip && trip.fareOffer?.driverCounterKobo != null) {
      trip.fareKobo = trip.fareOffer.driverCounterKobo;
      trip.fareOffer.status = 'accepted';
      trip.phase = 'driver_assigned';
      trip.status = 'accepted';
      trip.driver = MOCK_DRIVER;
      trip.vehicle = MOCK_VEHICLE;
      trip.driverEtaS = 240;
    }
    return trip!;
  }
  // Backend returns the FareOffer; discard it and re-read the trip so callers
  // get the updated Trip (phase advances to driver_assigned on the server).
  await api.post(`${BASE}/mobility/rides/${tripId}/accept-counter`, {}, idemHeader(idempotencyKey));
  return getTrip(tripId);
}

// ─── Trip read ────────────────────────────────────────────────────────────────
export async function getTrip(tripId: string): Promise<Trip> {
  if (USE_MOCK) {
    await delay(260);
    if (mockStore.activeTrip?.id === tripId) return advanceMockTrip(mockStore.activeTrip);
    const found = MOCK_HISTORY.find((t) => t.id === tripId);
    if (!found) throw new Error('Trip not found');
    return found;
  }
  return flattenTrip(unwrap<TripEnvelope>(await api.get(`${BASE}/mobility/rides/${tripId}`)));
}

export async function getActiveTrip(): Promise<Trip | null> {
  if (USE_MOCK) {
    await delay(220);
    return mockStore.activeTrip ? advanceMockTrip(mockStore.activeTrip) : null;
  }
  // Backend returns { activeTrip: null } (or the field absent) when the rider is
  // idle, and { activeTrip: {...envelope} } during a live trip.
  const body = unwrap<{ activeTrip?: TripEnvelope | null }>(await api.get(`${BASE}/mobility/rides/active`));
  return body?.activeTrip ? flattenTrip(body.activeTrip) : null;
}

export async function cancelRide(tripId: string, reason: string): Promise<Trip> {
  if (USE_MOCK) {
    await delay(500);
    const trip = mockStore.activeTrip;
    if (trip) {
      trip.phase = 'cancelled';
      trip.status = 'cancelled';
      trip.paymentStatus = 'refunded';
      mockStore.activeTrip = null;
    }
    return trip ?? makeTrip({ phase: 'cancelled', status: 'cancelled' });
  }
  return unwrap<Trip>(await api.post(`${BASE}/mobility/rides/${tripId}/cancel`, { reason }));
}

// ─── Safety ───────────────────────────────────────────────────────────────────
export async function shareTrip(tripId: string): Promise<ShareLink> {
  if (USE_MOCK) {
    await delay(400);
    const token = `shr_${Math.random().toString(36).slice(2, 10)}`;
    if (mockStore.activeTrip) mockStore.activeTrip.shareToken = token;
    return { token, url: `https://paymax.app/t/${token}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  }
  // Backend returns { shareToken, url, expiresAt }; map shareToken → token.
  const body = unwrap<{ shareToken: string; url: string; expiresAt: string }>(
    await api.post(`${BASE}/mobility/rides/${tripId}/share`, {}),
  );
  return { token: body.shareToken, url: body.url, expiresAt: body.expiresAt };
}

export async function triggerSos(
  tripId: string,
  loc: LatLng,
  description?: string,
): Promise<SafetyIncident> {
  if (USE_MOCK) {
    await delay(450);
    if (mockStore.activeTrip) mockStore.activeTrip.safetyHold = true;
    return { id: `inc_${Date.now()}`, tripId, type: 'sos', status: 'open', createdAt: new Date().toISOString() };
  }
  return unwrap<SafetyIncident>(
    await api.post(`${BASE}/mobility/rides/${tripId}/sos`, { lat: loc.lat, lng: loc.lng, description }),
  );
}

export async function getTrustedContacts(): Promise<TrustedContact[]> {
  if (USE_MOCK) {
    await delay(220);
    return [...MOCK_TRUSTED_CONTACTS];
  }
  // Backend wraps the list: { contacts: [...] }.
  const body = unwrap<{ contacts?: TrustedContact[] }>(await api.get(`${BASE}/mobility/trusted-contacts`));
  return body?.contacts ?? [];
}

export async function addTrustedContact(name: string, phone: string): Promise<TrustedContact> {
  if (USE_MOCK) {
    await delay(350);
    const created = { id: `tc_${Date.now()}`, name, phone };
    MOCK_TRUSTED_CONTACTS.push(created);
    return created;
  }
  return unwrap<TrustedContact>(await api.post(`${BASE}/mobility/trusted-contacts`, { name, phone }));
}

export async function deleteTrustedContact(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    const i = MOCK_TRUSTED_CONTACTS.findIndex((c) => c.id === id);
    if (i >= 0) MOCK_TRUSTED_CONTACTS.splice(i, 1);
    return;
  }
  await api.delete(`${BASE}/mobility/trusted-contacts/${id}`);
}

// ─── Rating (money mutation when tipping → Idempotency-Key) ────────────────────
export async function rateTrip(tripId: string, draft: RateDraft, idempotencyKey: string): Promise<Rating> {
  if (USE_MOCK) {
    await delay(600);
    if (mockStore.activeTrip?.id === tripId) mockStore.activeTrip.rated = true;
    const h = MOCK_HISTORY.find((t) => t.id === tripId);
    if (h) h.rated = true;
    return {
      id: `rate_${Date.now()}`,
      tripId,
      stars: draft.stars,
      comment: draft.comment ?? null,
      tipKobo: draft.tipKobo ?? 0,
      createdAt: new Date().toISOString(),
    };
  }
  return unwrap<Rating>(
    await api.post(
      `${BASE}/mobility/rides/${tripId}/rate`,
      { stars: draft.stars, comment: draft.comment, tip_kobo: draft.tipKobo },
      idemHeader(idempotencyKey),
    ),
  );
}

// ─── History ──────────────────────────────────────────────────────────────────
export async function getHistory(): Promise<Trip[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_HISTORY].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  // Backend wraps the list: { trips: [...] }. History rows are flat trips —
  // run them through flattenTrip so pickup/dest Places are always present.
  const body = unwrap<{ trips?: Partial<Trip>[] }>(await api.get(`${BASE}/mobility/history`));
  return (body?.trips ?? []).map((t) => flattenTrip(t as Trip));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVER endpoints
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDriverMe(): Promise<DriverProfile> {
  if (USE_MOCK) {
    await delay(280);
    return { ...mockDriver.profile };
  }
  return unwrap<DriverProfile>(await api.get(`${BASE}/driver/me`));
}

export async function submitDriverOnboarding(draft: OnboardingSubmitDraft): Promise<DriverProfile> {
  if (USE_MOCK) {
    await delay(700);
    mockDriver.profile = {
      ...mockDriver.profile,
      phone: draft.phone,
      email: draft.email,
      photoUrl: draft.photoUrl ?? null,
      serviceCategories: draft.serviceCategories,
      verificationStatus: 'submitted',
    };
    return { ...mockDriver.profile };
  }
  return unwrap<DriverProfile>(
    await api.post(`${BASE}/driver/onboarding/submit`, {
      phone: draft.phone,
      email: draft.email,
      photo_url: draft.photoUrl,
      service_categories: draft.serviceCategories,
    }),
  );
}

// ─── Driver document upload → R2 presign ───────────────────────────────────────
// Mirrors the health-intake attachment flow (features/health/api.ts): request a
// presigned R2 PUT URL from the backend, then the caller PUTs the file binary to
// it and submits the resulting object key via uploadDriverDocument(). No storage
// backend is invented here — this reuses the same R2 presign pattern (Cloudflare
// R2, bucket spotlight-open-mic) the rest of the app uses.
//
// Request body is snake_case; the response is camelCase (matches the rest of the
// mobility contract). In mock mode we return a mock:// URL so the client PUT is a
// no-op and the flow still exercises end-to-end.
export interface DriverDocPresign {
  /** Presigned PUT URL the client uploads the raw bytes to. */
  uploadUrl: string;
  /** Object key/URL to persist against the document once the PUT succeeds. */
  fileUrl: string;
}

export async function presignDriverDocument(input: {
  docType: DocumentDraft['docType'];
  fileName: string;
  mimeType: string;
}): Promise<DriverDocPresign> {
  if (USE_MOCK) {
    await delay(260);
    const key = `driver/documents/${input.docType}-${Date.now()}-${input.fileName}`;
    return { uploadUrl: `mock://r2/${key}`, fileUrl: key };
  }
  return unwrap<DriverDocPresign>(
    await api.post(`${BASE}/driver/documents/presign`, {
      doc_type: input.docType,
      file_name: input.fileName,
      mime_type: input.mimeType,
    }),
  );
}

/**
 * Full driver-document upload: presign → PUT the picked file to R2 → submit the
 * resulting object key via uploadDriverDocument(). Returns the updated profile.
 * `file` is a PickedUpload from the shared registration filePicker (image or
 * document). Mock uploadUrls are no-ops so mock dev still round-trips.
 */
export async function uploadDriverDocumentFile(input: {
  docType: DocumentDraft['docType'];
  file: { uri: string; name: string; mimeType: string };
  expiryDate?: string;
}): Promise<DriverProfile> {
  const { docType, file, expiryDate } = input;
  const { uploadUrl, fileUrl } = await presignDriverDocument({
    docType,
    fileName: file.name,
    mimeType: file.mimeType,
  });
  // Live: PUT the binary to the presigned R2 URL. Mock URLs are skipped.
  if (!uploadUrl.startsWith('mock://')) {
    const blob = await (await fetch(file.uri)).blob();
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': file.mimeType },
    });
    if (!res.ok) throw new Error(`R2 upload failed (${res.status})`);
  }
  return uploadDriverDocument({ docType, fileUrl, expiryDate });
}

export async function uploadDriverDocument(draft: DocumentDraft): Promise<DriverProfile> {
  if (USE_MOCK) {
    await delay(500);
    const docs = mockDriver.profile.documents.filter((d) => d.docType !== draft.docType);
    docs.push({
      id: `doc_${Date.now()}`,
      docType: draft.docType,
      fileUrl: draft.fileUrl,
      status: 'uploaded',
      expiryDate: draft.expiryDate ?? null,
    });
    mockDriver.profile = { ...mockDriver.profile, documents: docs };
    return { ...mockDriver.profile };
  }
  await api.post(`${BASE}/driver/documents`, {
    doc_type: draft.docType,
    file_url: draft.fileUrl,
    expiry_date: draft.expiryDate,
  });
  return getDriverMe();
}

export async function addDriverVehicle(draft: VehicleDraft): Promise<DriverProfile> {
  if (USE_MOCK) {
    await delay(550);
    mockDriver.profile = {
      ...mockDriver.profile,
      vehicle: { id: `veh_${Date.now()}`, ...draft },
    };
    return { ...mockDriver.profile };
  }
  await api.post(`${BASE}/driver/vehicle`, {
    plate_number: draft.plateNumber,
    make: draft.make,
    model: draft.model,
    year: draft.year,
    color: draft.color,
    category: draft.category,
    capacity: draft.capacity,
  });
  return getDriverMe();
}

export async function setDriverStatus(
  status: 'online' | 'offline',
  loc?: LatLng,
): Promise<DriverProfile> {
  if (USE_MOCK) {
    await delay(300);
    if (mockDriver.profile.verificationStatus !== 'approved') {
      const err = new Error('Only approved drivers can go online.') as Error & { code?: string; status?: number };
      err.code = 'NOT_PERMITTED';
      err.status = 403;
      throw err;
    }
    mockDriver.profile = { ...mockDriver.profile, online: status === 'online' };
    return { ...mockDriver.profile };
  }
  await api.patch(`${BASE}/driver/status`, { status, lat: loc?.lat, lng: loc?.lng });
  return getDriverMe();
}

export async function getDriverRequests(): Promise<DriverRideRequest[]> {
  if (USE_MOCK) {
    await delay(360);
    return mockDriverRequests();
  }
  return unwrap<DriverRideRequest[]>(await api.get(`${BASE}/driver/requests`));
}

export async function acceptDriverRequest(tripId: string, idempotencyKey: string): Promise<Trip> {
  if (USE_MOCK) {
    await delay(600);
    return makeTrip({ id: tripId, phase: 'driver_assigned', status: 'accepted', driver: MOCK_DRIVER, vehicle: MOCK_VEHICLE });
  }
  return unwrap<Trip>(await api.post(`${BASE}/driver/requests/${tripId}/accept`, {}, idemHeader(idempotencyKey)));
}

export async function counterDriverRequest(tripId: string, counterKobo: Kobo): Promise<FareOffer> {
  if (USE_MOCK) {
    await delay(450);
    return {
      id: `offer_${Date.now()}`,
      tripId,
      riderOfferKobo: 0,
      driverCounterKobo: counterKobo,
      status: 'countered',
      createdAt: new Date().toISOString(),
    };
  }
  return unwrap<FareOffer>(await api.post(`${BASE}/driver/requests/${tripId}/counter`, { counter_kobo: counterKobo }));
}

export async function driverArrive(tripId: string): Promise<Trip> {
  if (USE_MOCK) { await delay(350); return makeTrip({ id: tripId, phase: 'driver_arriving', status: 'accepted', driver: MOCK_DRIVER, vehicle: MOCK_VEHICLE, driverEtaS: 60 }); }
  return unwrap<Trip>(await api.post(`${BASE}/driver/trips/${tripId}/arrive`, {}));
}

export async function driverVerifyPin(tripId: string, pin: string): Promise<Trip> {
  if (USE_MOCK) {
    await delay(400);
    if (!/^\d{4}$/.test(pin)) {
      const err = new Error('Incorrect PIN. Ask the rider for their 4-digit trip PIN.') as Error & { code?: string; status?: number };
      err.code = 'INVALID_PIN';
      err.status = 422;
      throw err;
    }
    return makeTrip({ id: tripId, phase: 'pin_verified', status: 'accepted', driver: MOCK_DRIVER, vehicle: MOCK_VEHICLE });
  }
  return unwrap<Trip>(await api.post(`${BASE}/driver/trips/${tripId}/verify-pin`, { pin }));
}

export async function driverStart(tripId: string): Promise<Trip> {
  if (USE_MOCK) { await delay(350); return makeTrip({ id: tripId, phase: 'in_progress', status: 'picked_up', driver: MOCK_DRIVER, vehicle: MOCK_VEHICLE, startedAt: new Date().toISOString() }); }
  return unwrap<Trip>(await api.post(`${BASE}/driver/trips/${tripId}/start`, {}));
}

export async function driverComplete(tripId: string): Promise<Trip> {
  if (USE_MOCK) { await delay(500); return makeTrip({ id: tripId, phase: 'completed', status: 'completed', paymentStatus: 'settled', driver: MOCK_DRIVER, vehicle: MOCK_VEHICLE, completedAt: new Date().toISOString(), tripPin: null }); }
  return unwrap<Trip>(await api.post(`${BASE}/driver/trips/${tripId}/complete`, {}));
}

export async function getDriverEarnings(): Promise<DriverEarnings> {
  if (USE_MOCK) { await delay(380); return mockEarnings(); }
  return unwrap<DriverEarnings>(await api.get(`${BASE}/driver/earnings`));
}

export async function driverSos(loc: LatLng, tripId?: string): Promise<SafetyIncident> {
  if (USE_MOCK) { await delay(400); return { id: `inc_${Date.now()}`, tripId: tripId ?? null, type: 'sos', status: 'open', createdAt: new Date().toISOString() }; }
  return unwrap<SafetyIncident>(await api.post(`${BASE}/driver/sos`, { trip_id: tripId, lat: loc.lat, lng: loc.lng }));
}

// ─── Mock trip auto-advance (drives the rider-side state machine on poll) ──────
// Advances the singleton active trip through phases over time so the rider
// screens can demo searching → assigned → arriving → in-progress without a driver.
function advanceMockTrip(trip: Trip): Trip {
  if (['completed', 'cancelled', 'no_show'].includes(trip.phase)) return trip;
  const ageMs = Date.now() - new Date(trip.createdAt).getTime();

  // Negotiating: simulate a driver counter ~6s after a rider offer.
  if (trip.phase === 'fare_negotiating' && trip.fareOffer && trip.fareOffer.status === 'pending' && ageMs > 6_000) {
    const counter = Math.round(trip.fareOffer.riderOfferKobo * 1.08);
    trip.fareOffer = { ...trip.fareOffer, driverCounterKobo: counter, status: 'countered' };
    return trip;
  }
  if (trip.phase === 'fare_negotiating') return trip;

  // Instant flow: requested → assigned (8s) → arriving (16s) → (rider stays here
  // until driver verifies PIN; in-progress reached via verify in driver app).
  if (trip.phase === 'requested' && ageMs > 8_000) {
    trip.phase = 'driver_assigned';
    trip.status = 'accepted';
    trip.driver = MOCK_DRIVER;
    trip.vehicle = MOCK_VEHICLE;
    trip.driverEtaS = 300;
  }
  if (trip.phase === 'driver_assigned' && ageMs > 16_000) {
    trip.phase = 'driver_arriving';
    trip.driverEtaS = 90;
  }
  if (trip.phase === 'driver_arriving' && ageMs > 30_000) {
    trip.phase = 'in_progress';
    trip.status = 'picked_up';
    trip.startedAt = trip.startedAt ?? new Date().toISOString();
  }
  if (trip.phase === 'in_progress' && ageMs > 50_000) {
    trip.phase = 'completed';
    trip.status = 'completed';
    trip.paymentStatus = 'settled';
    trip.completedAt = new Date().toISOString();
    trip.tripPin = null;
  }
  return trip;
}

/** Clears the mock active trip (used after rider finishes the completed flow). */
export function clearMockActiveTrip(): void {
  if (USE_MOCK) mockStore.activeTrip = null;
}

export { USE_MOCK };
