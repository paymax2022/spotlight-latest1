// ── Bus provider marketplace — mock store ────────────────────────────────────
// In-memory seed for the interstate PROVIDER MARKETPLACE so the whole flow works
// offline (EXPO_PUBLIC_BUS_USE_MOCK). One shared store backs BOTH the customer
// search/directory and the provider dashboard, so a route/departure a provider
// adds immediately shows up in customer search — matching the go-live backend.
// All money is integer kobo. Fares here are illustrative seeds only.

import type {
  BusTrip,
  BusProviderListItem,
  BusProviderDetail,
  BusProviderRoute,
  BusProviderMe,
  BusProviderProfile,
  BusProviderSchedule,
  BusManifestEntry,
  BusSearchParams,
  BusProviderRegisterRequest,
  BusProviderUpdateRequest,
  BusRouteCreateRequest,
  BusRouteUpdateRequest,
  BusScheduleCreateRequest,
} from '../types/busProvider.types';

const now = () => Date.now();
const isoAhead = (ms: number) => new Date(now() + ms).toISOString();
const H = 3_600_000;

interface StoreProvider {
  id: string;
  businessName: string;
  contactPhone: string;
  contactEmail: string | null;
  baseState: string;
  description: string | null;
  verified: boolean;
  ratingAvg: number;
}
interface StoreRoute {
  id: string;
  providerId: string;
  fromState: string;
  toState: string;
  fromCity: string;
  toCity: string;
  busType: string;
  baseFareKobo: number;
  amenities: string[];
}
interface StoreSchedule {
  id: string;
  routeId: string;
  departureTime: string;
  totalSeats: number;
  seatsAvailable: number;
  fareKobo: number;
}

// The signed-in operator (provider dashboard) uses this fixed id in mock mode.
const ME_ID = 'prov_me';

const providers: StoreProvider[] = [
  { id: 'prov_gig', businessName: 'GIG Mobility',  contactPhone: '+2348030000001', contactEmail: 'hello@gigm.com',  baseState: 'Lagos',      description: 'Interstate luxury coaches.', verified: true,  ratingAvg: 4.7 },
  { id: 'prov_abc', businessName: 'ABC Transport', contactPhone: '+2348030000002', contactEmail: 'info@abc.com',    baseState: 'Lagos',      description: 'Nationwide fleet since 1993.', verified: true, ratingAvg: 4.5 },
  { id: 'prov_gig2', businessName: 'God is Good',  contactPhone: '+2348030000003', contactEmail: null,              baseState: 'Rivers',     description: 'Comfort across the South.',   verified: false, ratingAvg: 4.6 },
  { id: 'prov_city', businessName: 'City Hopper',  contactPhone: '+2348030000004', contactEmail: 'ride@cityhopper.ng', baseState: 'Lagos',   description: 'Intra-city shuttles across the metro.', verified: true, ratingAvg: 4.4 },
];

const routes: StoreRoute[] = [
  // Inter-state (between two states)
  { id: 'rt_gig_1', providerId: 'prov_gig', fromState: 'Lagos', toState: 'FCT - Abuja', fromCity: 'Jibowu',  toCity: 'Utako',     busType: 'Luxury 30-seater', baseFareKobo: 18_500_00, amenities: ['AC', 'WiFi', 'USB charging', 'Reclining seats'] },
  { id: 'rt_abc_1', providerId: 'prov_abc', fromState: 'Lagos', toState: 'Oyo',         fromCity: 'Ojota',   toCity: 'Challenge', busType: '18-seater Coaster', baseFareKobo: 4_200_00,  amenities: ['AC'] },
  { id: 'rt_gig2_1', providerId: 'prov_gig2', fromState: 'Rivers', toState: 'Lagos',    fromCity: 'Port Harcourt', toCity: 'Jibowu', busType: 'Luxury 30-seater', baseFareKobo: 22_000_00, amenities: ['AC', 'WiFi'] },
  // Intra-state (within one state, city → city)
  { id: 'rt_city_1', providerId: 'prov_city', fromState: 'Lagos', toState: 'Lagos', fromCity: 'Ikeja',          toCity: 'Ibeju-Lekki', busType: '14-seater Shuttle', baseFareKobo: 2_500_00, amenities: ['AC', 'USB charging'] },
  { id: 'rt_city_2', providerId: 'prov_city', fromState: 'Lagos', toState: 'Lagos', fromCity: 'Lagos Mainland', toCity: 'Eti-Osa',     busType: '14-seater Shuttle', baseFareKobo: 3_000_00, amenities: ['AC', 'WiFi'] },
  { id: 'rt_abc_intra', providerId: 'prov_abc', fromState: 'Oyo', toState: 'Oyo', fromCity: 'Ibadan',          toCity: 'Ogbomosho',   busType: '18-seater Coaster', baseFareKobo: 1_800_00, amenities: ['AC'] },
];

const schedules: StoreSchedule[] = [
  { id: 'sch_gig_1a', routeId: 'rt_gig_1', departureTime: isoAhead(6 * H),  totalSeats: 30, seatsAvailable: 24, fareKobo: 18_500_00 },
  { id: 'sch_gig_1b', routeId: 'rt_gig_1', departureTime: isoAhead(30 * H), totalSeats: 30, seatsAvailable: 30, fareKobo: 18_500_00 },
  { id: 'sch_abc_1a', routeId: 'rt_abc_1', departureTime: isoAhead(4 * H),  totalSeats: 18, seatsAvailable: 11, fareKobo: 4_200_00 },
  // Intra-state departures
  { id: 'sch_city_1a', routeId: 'rt_city_1', departureTime: isoAhead(2 * H), totalSeats: 14, seatsAvailable: 9, fareKobo: 2_500_00 },
  { id: 'sch_city_2a', routeId: 'rt_city_2', departureTime: isoAhead(3 * H), totalSeats: 14, seatsAvailable: 6, fareKobo: 3_000_00 },
  { id: 'sch_abc_intra_a', routeId: 'rt_abc_intra', departureTime: isoAhead(5 * H), totalSeats: 18, seatsAvailable: 15, fareKobo: 1_800_00 },
];

const manifests: Record<string, BusManifestEntry[]> = {
  sch_gig_1a: [
    { id: 'bk_1', seatNumber: 'A1', passengerName: 'Tunde Bello', passengerPhone: '+2348020000001', fareKobo: 18_500_00, paymentStatus: 'settled', bookedAt: isoAhead(-2 * H) },
    { id: 'bk_2', seatNumber: 'B3', passengerName: 'Ada Obi',     passengerPhone: '+2348020000002', fareKobo: 18_500_00, paymentStatus: 'settled', bookedAt: isoAhead(-1 * H) },
  ],
};

// ─── Mappers to API-facing (camelCase) shapes ──────────────────────────────────
const nextDeparture = (routeId: string): string | null => {
  const upcoming = schedules
    .filter((s) => s.routeId === routeId)
    .map((s) => s.departureTime)
    .sort();
  return upcoming[0] ?? null;
};

const toRoute = (r: StoreRoute): BusProviderRoute => ({
  id: r.id,
  fromState: r.fromState,
  toState: r.toState,
  fromCity: r.fromCity,
  toCity: r.toCity,
  busType: r.busType,
  baseFareKobo: r.baseFareKobo,
  amenities: r.amenities,
  nextDepartureTime: nextDeparture(r.id),
});

const toListItem = (p: StoreProvider): BusProviderListItem => ({
  id: p.id,
  businessName: p.businessName,
  baseState: p.baseState,
  verified: p.verified,
  ratingAvg: p.ratingAvg,
  routeCount: routes.filter((r) => r.providerId === p.id).length,
});

const toProfile = (p: StoreProvider): BusProviderProfile => ({
  id: p.id,
  businessName: p.businessName,
  contactPhone: p.contactPhone,
  contactEmail: p.contactEmail,
  baseState: p.baseState,
  description: p.description,
  verified: p.verified,
  ratingAvg: p.ratingAvg,
});

const toSchedule = (s: StoreSchedule): BusProviderSchedule => ({
  id: s.id,
  routeId: s.routeId,
  departureTime: s.departureTime,
  totalSeats: s.totalSeats,
  seatsAvailable: s.seatsAvailable,
  fareKobo: s.fareKobo,
});

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER (search + directory)
// ═══════════════════════════════════════════════════════════════════════════════
export function mockSearchTrips(params: BusSearchParams): BusTrip[] {
  const from = params.fromState.toLowerCase();
  const to = params.toState.toLowerCase();
  const kind = params.tripKind ?? (from === to ? 'intra' : 'inter');
  const fromCity = params.fromCity?.trim().toLowerCase();
  const toCity = params.toCity?.trim().toLowerCase();
  return schedules
    .map((s) => {
      const route = routes.find((r) => r.id === s.routeId);
      if (!route) return null;
      const provider = providers.find((p) => p.id === route.providerId);
      if (!provider) return null;
      const routeIsIntra = route.fromState.toLowerCase() === route.toState.toLowerCase();
      // Trip-kind guard: intra shows only same-state routes; inter only cross-state.
      if (kind === 'intra' && !routeIsIntra) return null;
      if (kind === 'inter' && routeIsIntra) return null;
      if (route.fromState.toLowerCase() !== from) return null;
      if (route.toState.toLowerCase() !== to) return null;
      // Intra-state city/terminal filters — bidirectional substring so a
      // broader LGA pick (e.g. "Ibadan") still matches a route city, and vice
      // versa. Optional on both ends.
      const cityMatch = (routeCity: string, sel?: string) => {
        if (!sel) return true;
        const rc = routeCity.toLowerCase();
        return rc.includes(sel) || sel.includes(rc);
      };
      if (!cityMatch(route.fromCity, fromCity)) return null;
      if (!cityMatch(route.toCity, toCity)) return null;
      if (params.providerId && provider.id !== params.providerId) return null;
      const trip: BusTrip = {
        scheduleId: s.id,
        routeId: route.id,
        provider: { id: provider.id, businessName: provider.businessName, verified: provider.verified, ratingAvg: provider.ratingAvg },
        fromState: route.fromState,
        toState: route.toState,
        fromCity: route.fromCity,
        toCity: route.toCity,
        busType: route.busType,
        departureTime: s.departureTime,
        seatsAvailable: s.seatsAvailable,
        fareKobo: s.fareKobo,
        amenities: route.amenities,
      };
      return trip;
    })
    .filter((t): t is BusTrip => t !== null)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

export function mockListProviders(state?: string, q?: string): BusProviderListItem[] {
  const s = state?.toLowerCase();
  const term = q?.trim().toLowerCase();
  return providers
    .filter((p) => (!s || p.baseState.toLowerCase() === s) && (!term || p.businessName.toLowerCase().includes(term)))
    .map(toListItem);
}

export function mockProviderDetail(id: string): BusProviderDetail {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error('Provider not found');
  return { provider: toListItem(p), routes: routes.filter((r) => r.providerId === id).map(toRoute) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER (dashboard + management)
// ═══════════════════════════════════════════════════════════════════════════════
export function mockProviderMe(): BusProviderMe {
  const p = providers.find((x) => x.id === ME_ID);
  if (!p) return { provider: null, routes: [], upcomingSchedules: [] };
  const myRoutes = routes.filter((r) => r.providerId === ME_ID);
  const myRouteIds = new Set(myRoutes.map((r) => r.id));
  return {
    provider: toProfile(p),
    routes: myRoutes.map(toRoute),
    upcomingSchedules: schedules.filter((s) => myRouteIds.has(s.routeId)).sort((a, b) => a.departureTime.localeCompare(b.departureTime)).map(toSchedule),
  };
}

export function mockRegisterProvider(req: BusProviderRegisterRequest): BusProviderProfile {
  const existing = providers.find((x) => x.id === ME_ID);
  const profile: StoreProvider = existing ?? {
    id: ME_ID,
    businessName: req.businessName,
    contactPhone: req.contactPhone,
    contactEmail: req.contactEmail ?? null,
    baseState: req.baseState,
    description: req.description ?? null,
    verified: false,
    ratingAvg: 0,
  };
  if (!existing) providers.push(profile);
  else Object.assign(profile, {
    businessName: req.businessName, contactPhone: req.contactPhone,
    contactEmail: req.contactEmail ?? null, baseState: req.baseState, description: req.description ?? null,
  });
  return toProfile(profile);
}

export function mockUpdateProvider(req: BusProviderUpdateRequest): BusProviderProfile {
  const p = providers.find((x) => x.id === ME_ID);
  if (!p) throw new Error('Provider not found');
  if (req.businessName !== undefined) p.businessName = req.businessName;
  if (req.contactPhone !== undefined) p.contactPhone = req.contactPhone;
  if (req.contactEmail !== undefined) p.contactEmail = req.contactEmail;
  if (req.baseState !== undefined) p.baseState = req.baseState;
  if (req.description !== undefined) p.description = req.description;
  return toProfile(p);
}

export function mockAddRoute(req: BusRouteCreateRequest): BusProviderRoute {
  const route: StoreRoute = {
    id: `rt_me_${now()}`,
    providerId: ME_ID,
    fromState: req.fromState,
    toState: req.toState,
    fromCity: req.fromCity,
    toCity: req.toCity,
    busType: req.busType,
    baseFareKobo: req.baseFareKobo,
    amenities: req.amenities ?? [],
  };
  routes.push(route);
  return toRoute(route);
}

export function mockUpdateRoute(id: string, req: BusRouteUpdateRequest): BusProviderRoute {
  const r = routes.find((x) => x.id === id && x.providerId === ME_ID);
  if (!r) throw new Error('Route not found');
  Object.assign(r, {
    ...(req.fromState !== undefined && { fromState: req.fromState }),
    ...(req.toState !== undefined && { toState: req.toState }),
    ...(req.fromCity !== undefined && { fromCity: req.fromCity }),
    ...(req.toCity !== undefined && { toCity: req.toCity }),
    ...(req.busType !== undefined && { busType: req.busType }),
    ...(req.baseFareKobo !== undefined && { baseFareKobo: req.baseFareKobo }),
    ...(req.amenities !== undefined && { amenities: req.amenities }),
  });
  return toRoute(r);
}

export function mockAddSchedule(routeId: string, req: BusScheduleCreateRequest): BusProviderSchedule {
  const schedule: StoreSchedule = {
    id: `sch_me_${now()}`,
    routeId,
    departureTime: req.departureTime,
    totalSeats: req.totalSeats,
    seatsAvailable: req.totalSeats,
    fareKobo: req.fareKobo,
  };
  schedules.push(schedule);
  return toSchedule(schedule);
}

export function mockManifest(scheduleId: string): BusManifestEntry[] {
  return manifests[scheduleId] ?? [];
}
