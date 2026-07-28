// ── Paymax Mobility — Mock seed data + deterministic engines ─────────────────
// Realistic fixtures so loading/empty/populated states render in USE_MOCK mode.
// All money is integer kobo. The "pricing engine" here mimics the SERVER: the
// client screens only ever read the values it returns, never recompute floors.

import type {
  PricingConfig,
  ServiceType,
  RideEstimate,
  RideEstimateRequest,
  Trip,
  Driver,
  Vehicle,
  SavedPlace,
  Place,
  QuickTile,
  DriverProfile,
  DriverRideRequest,
  DriverEarnings,
  TrustedContact,
} from '../types/mobility.types';
import { haversineMeters } from '../utils/mobilityFormatters';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const isoAhead = (msAhead: number) => new Date(now() + msAhead).toISOString();

// ─── Pricing config (server-owned; client renders ranges from this) ───────────
const PER_SERVICE: Record<ServiceType, Omit<PricingConfig, 'zone' | 'serviceType' | 'currency' | 'serviceAvailable'>> = {
  economy: { baseFareKobo: 500_00, perKmKobo: 220_00, perMinKobo: 35_00, minFareKobo: 900_00,  surgeMultiplier: 1.0, fareFloorPct: 0.85, fareCeilingPct: 1.30 },
  comfort: { baseFareKobo: 700_00, perKmKobo: 280_00, perMinKobo: 45_00, minFareKobo: 1_300_00, surgeMultiplier: 1.0, fareFloorPct: 0.85, fareCeilingPct: 1.30 },
  premium: { baseFareKobo: 1_200_00, perKmKobo: 380_00, perMinKobo: 60_00, minFareKobo: 2_200_00, surgeMultiplier: 1.0, fareFloorPct: 0.88, fareCeilingPct: 1.30 },
  xl:      { baseFareKobo: 1_000_00, perKmKobo: 340_00, perMinKobo: 55_00, minFareKobo: 1_900_00, surgeMultiplier: 1.0, fareFloorPct: 0.85, fareCeilingPct: 1.30 },
};

export function mockPricingConfig(serviceType: ServiceType, zone = 'lagos-mainland'): PricingConfig {
  return {
    zone,
    serviceType,
    currency: 'NGN',
    serviceAvailable: true,
    ...PER_SERVICE[serviceType],
  };
}

/** Deterministic estimate engine (haversine + avg speed) — stands in for the
 *  maps adapter + fare engine on the server. Floors/ceilings come from config. */
export function mockEstimate(req: RideEstimateRequest): RideEstimate {
  const straight = haversineMeters(req.pickup, req.dest);
  // road factor so it isn't a straight line
  const distanceM = Math.max(800, Math.round(straight * 1.32));
  const avgSpeedMps = 7.5; // ~27 km/h urban
  const durationS = Math.max(180, Math.round(distanceM / avgSpeedMps));
  const cfg = PER_SERVICE[req.serviceType];
  const km = distanceM / 1000;
  const min = durationS / 60;
  const raw = cfg.baseFareKobo + Math.round(cfg.perKmKobo * km) + Math.round(cfg.perMinKobo * min);
  const surge = cfg.surgeMultiplier;
  const systemFareKobo = Math.max(cfg.minFareKobo, Math.round(raw * surge));
  return {
    distanceM,
    durationS,
    systemFareKobo,
    offerMinKobo: Math.round(systemFareKobo * cfg.fareFloorPct),
    offerMaxKobo: Math.round(systemFareKobo * cfg.fareCeilingPct),
    surgeMultiplier: surge,
    currency: 'NGN',
    polyline: `mock:${req.pickup.lat},${req.pickup.lng}>${req.dest.lat},${req.dest.lng}`,
  };
}

// ─── Saved & recent places (Lagos) ─────────────────────────────────────────────
export const MOCK_SAVED_PLACES: SavedPlace[] = [
  { id: 'sp_home', label: 'Home',   address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.4730, icon: 'Home' },
  { id: 'sp_work', label: 'Work',   address: 'Plot 5, Idejo St, Victoria Island', lat: 6.4281, lng: 3.4219, icon: 'Briefcase' },
];

export const MOCK_RECENT_PLACES: Place[] = [
  { address: 'Murtala Muhammed Airport (MM2), Ikeja', lat: 6.5774, lng: 3.3210 },
  { address: 'Ikeja City Mall, Alausa', lat: 6.6186, lng: 3.3585 },
  { address: 'The Palms Shopping Mall, Lekki', lat: 6.4396, lng: 3.4509 },
];

const DEFAULT_PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.4730 };
const DEFAULT_DEST: Place = { address: 'Plot 5, Idejo St, Victoria Island', lat: 6.4281, lng: 3.4219 };

// ─── Quick tiles ────────────────────────────────────────────────────────────────
export const MOCK_QUICK_TILES: QuickTile[] = [
  { id: 'ride',     label: 'Ride now',  icon: 'Car',          serviceType: 'economy', enabled: true },
  { id: 'schedule', label: 'Schedule',  icon: 'CalendarClock', enabled: false },
  { id: 'parcel',   label: 'Send parcel', icon: 'Package',     enabled: false },
  { id: 'airport',  label: 'Airport',   icon: 'Plane',        serviceType: 'comfort', enabled: true },
];

// ─── Drivers / vehicles ────────────────────────────────────────────────────────
export const MOCK_DRIVER: Driver = {
  id: 'drv_1',
  name: 'Emeka Obi',
  photoUrl: null,
  rating: 4.92,
  tripsCount: 1287,
  verified: true,
  phoneMasked: '+234 ••• ••• 4421',
};

export const MOCK_VEHICLE: Vehicle = {
  id: 'veh_1',
  make: 'Toyota',
  model: 'Corolla',
  year: 2021,
  color: 'Silver',
  plateNumber: 'LND-238-KJA',
  category: 'economy',
  capacity: 4,
};

// ─── Trusted contacts ──────────────────────────────────────────────────────────
export const MOCK_TRUSTED_CONTACTS: TrustedContact[] = [
  { id: 'tc_1', name: 'Ada (sister)', phone: '+2348030000001' },
  { id: 'tc_2', name: 'Tunde', phone: '+2348030000002' },
];

// ─── Rider active trip (mutable, advanced by the mock API) ─────────────────────
export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const est = mockEstimate({ pickup: DEFAULT_PICKUP, dest: DEFAULT_DEST, serviceType: 'economy' });
  return {
    id: `trip_${now()}`,
    phase: 'requested',
    status: 'requested',
    serviceType: 'economy',
    pricingMode: 'instant',
    pickup: DEFAULT_PICKUP,
    dest: DEFAULT_DEST,
    distanceM: est.distanceM,
    durationS: est.durationS,
    fareKobo: est.systemFareKobo,
    systemFareKobo: est.systemFareKobo,
    surgeMultiplier: est.surgeMultiplier,
    currency: 'NGN',
    paymentMethod: 'wallet',
    paymentStatus: 'escrowed',
    tripPin: String(1000 + Math.floor(Math.random() * 9000)),
    driver: null,
    vehicle: null,
    fareOffer: null,
    driverEtaS: null,
    polyline: est.polyline,
    shareToken: null,
    safetyHold: false,
    createdAt: iso(),
    startedAt: null,
    completedAt: null,
    rated: false,
    ...overrides,
  };
}

// Singleton mutable store for the rider's active trip in mock mode.
export const mockStore: { activeTrip: Trip | null } = { activeTrip: null };

// ─── Rider history ───────────────────────────────────────────────────────────
export const MOCK_HISTORY: Trip[] = [
  makeTrip({
    id: 'trip_h1', phase: 'completed', status: 'completed',
    fareKobo: 2_350_00, systemFareKobo: 2_350_00, paymentStatus: 'settled',
    driver: MOCK_DRIVER, vehicle: MOCK_VEHICLE, tripPin: null,
    createdAt: iso(86_400_000 * 2), startedAt: iso(86_400_000 * 2),
    completedAt: iso(86_400_000 * 2 - 1_500_000), rated: true,
  }),
  makeTrip({
    id: 'trip_h2', phase: 'completed', status: 'completed', serviceType: 'comfort',
    fareKobo: 4_100_00, systemFareKobo: 3_900_00, pricingMode: 'offer', paymentStatus: 'settled',
    driver: { ...MOCK_DRIVER, id: 'drv_2', name: 'Grace Bello', rating: 4.88 },
    vehicle: { ...MOCK_VEHICLE, id: 'veh_2', make: 'Kia', model: 'Sportage', color: 'Black', plateNumber: 'AKD-554-LAG' },
    tripPin: null, createdAt: iso(86_400_000 * 6), completedAt: iso(86_400_000 * 6 - 2_100_000), rated: false,
  }),
  makeTrip({
    id: 'trip_h3', phase: 'cancelled', status: 'cancelled',
    fareKobo: 0, paymentStatus: 'refunded', tripPin: null,
    createdAt: iso(86_400_000 * 9), rated: false,
  }),
];

// ─── Driver profile (mutable) ──────────────────────────────────────────────────
export const mockDriver: { profile: DriverProfile } = {
  profile: {
    id: 'drv_me',
    name: 'Test Driver',
    phone: null,
    email: null,
    photoUrl: null,
    verificationStatus: 'not_started',
    rejectionReason: null,
    online: false,
    serviceCategories: [],
    commission: { tier: 'standard', platformPct: 20, driverPct: 80 },
    documents: [],
    vehicle: null,
    rating: 0,
  },
};

// ─── Driver dispatch feed ──────────────────────────────────────────────────────
export function mockDriverRequests(): DriverRideRequest[] {
  const base = (id: string, pickup: Place, dest: Place, service: ServiceType): DriverRideRequest => {
    const est = mockEstimate({ pickup, dest, serviceType: service });
    const riderOffer = id === 'req_2' ? Math.round(est.systemFareKobo * 0.92) : null;
    const fareForNet = riderOffer ?? est.systemFareKobo;
    return {
      tripId: id,
      pickup, dest,
      distanceM: est.distanceM,
      durationS: est.durationS,
      pickupDistanceM: 600 + Math.floor(Math.random() * 2200),
      serviceType: service,
      pricingMode: riderOffer ? 'offer' : 'instant',
      systemFareKobo: est.systemFareKobo,
      riderOfferKobo: riderOffer,
      counterMinKobo: est.offerMinKobo,
      counterMaxKobo: est.offerMaxKobo,
      estDriverNetKobo: Math.round(fareForNet * 0.8),
      currency: 'NGN',
      rider: { name: id === 'req_1' ? 'Chidi A.' : 'Funke O.', rating: 4.8 },
      expiresAt: isoAhead(45_000),
    };
  };
  return [
    base('req_1', DEFAULT_PICKUP, MOCK_RECENT_PLACES[2], 'economy'),
    base('req_2', { address: 'Ikoyi Club 1938', lat: 6.4520, lng: 3.4360 }, DEFAULT_DEST, 'comfort'),
  ];
}

export function mockEarnings(): DriverEarnings {
  return {
    grossKobo: 184_500_00,
    platformFeeKobo: 36_900_00,
    netKobo: 147_600_00,
    tripsCompleted: 96,
    cancelRatePct: 3.1,
    commission: mockDriver.profile.commission,
    currency: 'NGN',
    today: { grossKobo: 18_200_00, tripsCompleted: 9 },
    recentTrips: [
      { tripId: 'trip_h1', completedAt: iso(3_600_000 * 2), fareKobo: 2_350_00, netKobo: 1_880_00, pickupLabel: 'Lekki Phase 1', destLabel: 'Victoria Island' },
      { tripId: 'trip_h2', completedAt: iso(3_600_000 * 4), fareKobo: 4_100_00, netKobo: 3_280_00, pickupLabel: 'Ikoyi', destLabel: 'The Palms, Lekki' },
      { tripId: 'trip_h3', completedAt: iso(3_600_000 * 7), fareKobo: 1_500_00, netKobo: 1_200_00, pickupLabel: 'Alausa', destLabel: 'Ikeja City Mall' },
    ],
  };
}
