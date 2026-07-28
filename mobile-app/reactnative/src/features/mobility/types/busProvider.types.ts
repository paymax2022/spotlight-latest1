// ── Bus provider marketplace — types ─────────────────────────────────────────
// camelCase types matching the backend's camelCase responses for the interstate
// bus PROVIDER MARKETPLACE. Money is always integer kobo (never floats). Fares
// are server-owned; the client only displays them and (for providers) proposes
// base fares that the backend validates.

import type { Kobo } from './mobility.types';

// ─── Shared provider summary (search chips + provider cards) ───────────────────
export interface BusProviderSummary {
  id: string;
  businessName: string;
  verified: boolean;
  ratingAvg: number;
}

// ─── Customer: interstate trip search (GET /bus/search) ────────────────────────
export type BusTripProvider = BusProviderSummary;

export interface BusTrip {
  scheduleId: string;
  routeId: string;
  provider: BusTripProvider;
  fromState: string;
  toState: string;
  fromCity: string;
  toCity: string;
  busType: string;
  departureTime: string;     // ISO
  seatsAvailable: number;
  fareKobo: Kobo;
  amenities: string[];
}

export type BusTripKind = 'inter' | 'intra';

export interface BusSearchParams {
  fromState: string;
  toState: string;
  /** 'inter' = between two states; 'intra' = within one state (city→city). */
  tripKind?: BusTripKind;
  /** Intra-state city/terminal filters (within the single chosen state). */
  fromCity?: string;
  toCity?: string;
  providerId?: string;
  date?: string;             // YYYY-MM-DD
}

// ─── Customer: provider directory (GET /bus/providers) ─────────────────────────
export interface BusProviderListItem {
  id: string;
  businessName: string;
  baseState: string;
  verified: boolean;
  ratingAvg: number;
  routeCount: number;
}

// ─── Customer: provider detail (GET /bus/providers/:id) ────────────────────────
export interface BusProviderRoute {
  id: string;
  fromState: string;
  toState: string;
  fromCity: string;
  toCity: string;
  busType: string;
  baseFareKobo: Kobo;
  amenities: string[];
  nextDepartureTime: string | null;   // ISO or null when none scheduled
}

export interface BusProviderDetail {
  provider: BusProviderListItem;
  routes: BusProviderRoute[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER-SIDE (the operator managing their own marketplace listing)
// ═══════════════════════════════════════════════════════════════════════════════

/** The signed-in operator's own provider profile. */
export interface BusProviderProfile {
  id: string;
  businessName: string;
  contactPhone: string;
  contactEmail: string | null;
  baseState: string;
  description: string | null;
  verified: boolean;
  ratingAvg: number;
}

/** A schedule/departure attached to one of the provider's own routes. */
export interface BusProviderSchedule {
  id: string;
  routeId: string;
  departureTime: string;     // ISO
  totalSeats: number;
  seatsAvailable: number;
  fareKobo: Kobo;
}

/** GET /bus/provider/me — null provider means "not yet registered". */
export interface BusProviderMe {
  provider: BusProviderProfile | null;
  routes: BusProviderRoute[];
  upcomingSchedules: BusProviderSchedule[];
}

export interface BusProviderRegisterRequest {
  businessName: string;
  contactPhone: string;
  contactEmail?: string;
  baseState: string;
  description?: string;
}

export interface BusProviderUpdateRequest {
  businessName?: string;
  contactPhone?: string;
  contactEmail?: string;
  baseState?: string;
  description?: string;
}

export interface BusRouteCreateRequest {
  fromState: string;
  toState: string;
  fromCity: string;
  toCity: string;
  busType: string;
  baseFareKobo: Kobo;
  amenities?: string[];
}

export interface BusRouteUpdateRequest {
  fromState?: string;
  toState?: string;
  fromCity?: string;
  toCity?: string;
  busType?: string;
  baseFareKobo?: Kobo;
  amenities?: string[];
}

export interface BusScheduleCreateRequest {
  departureTime: string;     // ISO
  totalSeats: number;
  fareKobo: Kobo;
}

/** One passenger row on a departure manifest (GET /bus/provider/bookings). */
export interface BusManifestEntry {
  id: string;
  seatNumber: string;
  passengerName: string;
  passengerPhone: string;
  fareKobo: Kobo;
  paymentStatus: 'settled' | 'refunded' | 'failed';
  bookedAt: string;
}
