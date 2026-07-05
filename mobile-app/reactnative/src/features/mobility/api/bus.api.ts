// ── Bus booking — API wrapper ────────────────────────────────────────────────
// Mock-flagged, BASE = '/api/v1'. Booking is a money mutation (escrow →
// settle operator on issue) and carries an Idempotency-Key. Fares are
// admin-approved on the SERVER — never computed here.

import { api } from '@/api/client';
import type {
  BusRoute,
  BusSchedule,
  BusSeat,
  BusSeatMap,
  BusTicket,
  BusBookRequest,
} from '../types/modes.types';
import type {
  BusTrip,
  BusSearchParams,
  BusProviderListItem,
  BusProviderDetail,
} from '../types/busProvider.types';
import {
  mockBusRoutes,
  mockBusSchedules,
  mockSeatMap,
  busTicketStore,
  makeBusTicket,
} from './bus.mock';
import {
  mockSearchTrips,
  mockListProviders,
  mockProviderDetail,
} from './busProvider.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_BUS_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/v1';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export async function searchRoutes(origin: string, dest: string): Promise<BusRoute[]> {
  if (USE_MOCK) {
    await delay(420);
    return mockBusRoutes(origin, dest);
  }
  return unwrap<BusRoute[]>(await api.get(`${BASE}/mobility/bus/routes`, { params: { origin, dest } }));
}

// ─── Marketplace: interstate trip search (provider-aware) ──────────────────────
// GET /bus/search?fromState&toState&providerId&date → { trips: BusTrip[] }.
// Each trip carries its provider (businessName + verified + rating) so results
// can be grouped/badged per operator. Fares are server-owned (kobo).
export async function searchTrips(params: BusSearchParams): Promise<BusTrip[]> {
  if (USE_MOCK) {
    await delay(420);
    return mockSearchTrips(params);
  }
  // Query params are camelCase to match the Go handler (c.Query("fromState") …).
  const res = await api.get(`${BASE}/mobility/bus/search`, {
    params: {
      fromState: params.fromState,
      toState: params.toState,
      ...(params.tripKind ? { tripKind: params.tripKind } : {}),
      ...(params.fromCity ? { fromCity: params.fromCity } : {}),
      ...(params.toCity ? { toCity: params.toCity } : {}),
      ...(params.providerId ? { providerId: params.providerId } : {}),
      ...(params.date ? { date: params.date } : {}),
    },
  });
  return (res.data?.trips ?? res.data?.data?.trips ?? []) as BusTrip[];
}

// GET /bus/providers?state&q → { providers: BusProviderListItem[] }
export async function listProviders(state?: string, q?: string): Promise<BusProviderListItem[]> {
  if (USE_MOCK) {
    await delay(360);
    return mockListProviders(state, q);
  }
  const res = await api.get(`${BASE}/mobility/bus/providers`, {
    params: { ...(state ? { state } : {}), ...(q ? { q } : {}) },
  });
  return (res.data?.providers ?? res.data?.data?.providers ?? []) as BusProviderListItem[];
}

// GET /bus/providers/:id → { provider, routes: BusProviderRoute[] }
export async function getProviderDetail(id: string): Promise<BusProviderDetail> {
  if (USE_MOCK) {
    await delay(320);
    return mockProviderDetail(id);
  }
  const res = await api.get(`${BASE}/mobility/bus/providers/${id}`);
  return (res.data?.data ?? res.data) as BusProviderDetail;
}

export async function getSchedules(routeId: string, date: string): Promise<BusSchedule[]> {
  if (USE_MOCK) {
    await delay(380);
    return mockBusSchedules(routeId);
  }
  return unwrap<BusSchedule[]>(await api.get(`${BASE}/mobility/bus/schedules`, { params: { route_id: routeId, date } }));
}

// Backend seat-map payload (GET /mobility/bus/schedules/:id/seats):
// { schedule_id, total_seats, taken: number[], available: number }.
// A seat is taken if its (1-based) number appears in `taken`. We map this onto
// the UI-facing BusSeatMap so the seat-picker screen stays declarative. The
// seat-map endpoint does not carry the fare (fares come from the schedule list);
// fareKobo defaults to 0 and the booking screens read it from their own source.
interface BackendSeatMap {
  schedule_id: string;
  total_seats: number;
  taken: number[];
  available: number;
}

export async function getSeatMap(scheduleId: string): Promise<BusSeatMap> {
  if (USE_MOCK) {
    await delay(300);
    return mockSeatMap(scheduleId);
  }
  const res = await api.get(`${BASE}/mobility/bus/schedules/${scheduleId}/seats`);
  const raw = (res.data?.data ?? res.data) as BackendSeatMap;
  const taken = new Set(raw.taken ?? []);
  const seats: BusSeat[] = Array.from({ length: raw.total_seats ?? 0 }, (_, i) => {
    const n = i + 1;
    return { number: String(n), available: !taken.has(n) };
  });
  return {
    scheduleId: raw.schedule_id ?? scheduleId,
    columns: 4,
    seats,
    fareKobo: 0,
    currency: 'NGN',
  };
}

// ─── Book (money mutation → escrow → settle operator → QR; Idempotency-Key) ────
export async function bookBus(req: BusBookRequest): Promise<BusTicket> {
  if (USE_MOCK) {
    await delay(900);
    const ticket = makeBusTicket(req);
    busTicketStore.tickets.unshift(ticket);
    return ticket;
  }
  return unwrap<BusTicket>(
    await api.post(
      `${BASE}/mobility/bus/book`,
      {
        schedule_id: req.scheduleId,
        seat_number: req.seatNumber,
        passenger_name: req.passengerName,
        passenger_phone: req.passengerPhone,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getTickets(): Promise<BusTicket[]> {
  if (USE_MOCK) {
    await delay();
    return [...busTicketStore.tickets].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<BusTicket[]>(await api.get(`${BASE}/mobility/bus/tickets`));
}

export async function getTicket(id: string): Promise<BusTicket> {
  if (USE_MOCK) {
    await delay(220);
    const found = busTicketStore.tickets.find((t) => t.id === id);
    if (!found) throw new Error('Ticket not found');
    return found;
  }
  return unwrap<BusTicket>(await api.get(`${BASE}/mobility/bus/tickets/${id}`));
}

export async function cancelTicket(id: string): Promise<BusTicket> {
  if (USE_MOCK) {
    await delay(500);
    const t = busTicketStore.tickets.find((x) => x.id === id);
    if (t) {
      t.phase = 'refunded';
      t.paymentStatus = 'refunded';
      t.qrCode = null;
    }
    return t!;
  }
  return unwrap<BusTicket>(await api.post(`${BASE}/mobility/bus/tickets/${id}/cancel`, {}));
}

export { USE_MOCK };
