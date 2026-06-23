// ── Bus booking — API wrapper ────────────────────────────────────────────────
// Mock-flagged, BASE = '/api/finance'. Booking is a money mutation (escrow →
// settle operator on issue) and carries an Idempotency-Key. Fares are
// admin-approved on the SERVER — never computed here.

import { api } from '@/api/client';
import type {
  BusRoute,
  BusSchedule,
  BusSeatMap,
  BusTicket,
  BusBookRequest,
} from '../types/modes.types';
import {
  mockBusRoutes,
  mockBusSchedules,
  mockSeatMap,
  busTicketStore,
  makeBusTicket,
} from './bus.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_BUS_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/finance';
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

export async function getSchedules(routeId: string, date: string): Promise<BusSchedule[]> {
  if (USE_MOCK) {
    await delay(380);
    return mockBusSchedules(routeId);
  }
  return unwrap<BusSchedule[]>(await api.get(`${BASE}/mobility/bus/schedules`, { params: { route_id: routeId, date } }));
}

export async function getSeatMap(scheduleId: string): Promise<BusSeatMap> {
  if (USE_MOCK) {
    await delay(300);
    return mockSeatMap(scheduleId);
  }
  return unwrap<BusSeatMap>(await api.get(`${BASE}/mobility/bus/schedules/${scheduleId}/seats`));
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
