// ── Car hire — API wrapper ───────────────────────────────────────────────────
// Mock-flagged, BASE = '/api/v1'. Book escrows fare+deposit; extend
// escrows the delta; complete settles the driver split and releases the deposit.
// Money mutations carry an Idempotency-Key. Fare + deposit come from the SERVER.

import { api } from '@/api/client';
import type {
  CarHireBooking,
  CarHireQuote,
  CarHireQuoteRequest,
  CarHireBookRequest,
  CarHireExtendRequest,
} from '../types/modes.types';
import {
  mockCarHireQuote,
  makeCarHireBooking,
  carHireStore,
  MOCK_CARHIRE_HISTORY,
} from './carhire.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_CARHIRE_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/v1';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export async function quoteCarHire(req: CarHireQuoteRequest): Promise<CarHireQuote> {
  if (USE_MOCK) {
    await delay(420);
    return mockCarHireQuote(req);
  }
  return unwrap<CarHireQuote>(
    await api.post(`${BASE}/mobility/car-hire/quote`, {
      hire_type: req.hireType,
      vehicle_class: req.vehicleClass,
      start_at: req.startAt,
      duration_hours: req.durationHours,
      chauffeur: req.chauffeur,
    }),
  );
}

export async function bookCarHire(req: CarHireBookRequest): Promise<CarHireBooking> {
  if (USE_MOCK) {
    await delay(900);
    const booking = makeCarHireBooking(req, { phase: 'confirmed' });
    carHireStore.active = booking;
    return booking;
  }
  return unwrap<CarHireBooking>(
    await api.post(
      `${BASE}/mobility/car-hire/book`,
      {
        hire_type: req.hireType,
        vehicle_class: req.vehicleClass,
        start_at: req.startAt,
        duration_hours: req.durationHours,
        chauffeur: req.chauffeur,
        payment_method: req.paymentMethod,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getCarHire(id: string): Promise<CarHireBooking> {
  if (USE_MOCK) {
    await delay(260);
    if (carHireStore.active?.id === id) return carHireStore.active;
    const found = MOCK_CARHIRE_HISTORY.find((b) => b.id === id);
    if (!found) throw new Error('Booking not found');
    return found;
  }
  return unwrap<CarHireBooking>(await api.get(`${BASE}/mobility/car-hire/${id}`));
}

export async function getCarHireBookings(): Promise<CarHireBooking[]> {
  if (USE_MOCK) {
    await delay();
    const list = [...MOCK_CARHIRE_HISTORY];
    if (carHireStore.active) list.unshift(carHireStore.active);
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<CarHireBooking[]>(await api.get(`${BASE}/mobility/car-hire`));
}

// ─── Extend (money mutation → escrow delta → Idempotency-Key) ──────────────────
export async function extendCarHire(id: string, req: CarHireExtendRequest): Promise<CarHireBooking> {
  if (USE_MOCK) {
    await delay(700);
    const b = carHireStore.active;
    if (b) {
      const hourly = Math.round(b.fareKobo / Math.max(1, b.durationHours));
      b.durationHours += req.extraHours;
      b.fareKobo += hourly * req.extraHours;
      b.phase = 'extended';
    }
    return b!;
  }
  return unwrap<CarHireBooking>(
    await api.post(`${BASE}/mobility/car-hire/${id}/extend`, { extra_hours: req.extraHours }, idemHeader(req.idempotencyKey)),
  );
}

// ─── Complete (settle driver split, release deposit; Idempotency-Key) ──────────
export async function completeCarHire(id: string, idempotencyKey: string): Promise<CarHireBooking> {
  if (USE_MOCK) {
    await delay(700);
    const b = carHireStore.active;
    if (b) {
      b.phase = 'completed';
      b.paymentStatus = 'settled';
      b.completedAt = new Date().toISOString();
    }
    return b!;
  }
  return unwrap<CarHireBooking>(
    await api.post(`${BASE}/mobility/car-hire/${id}/complete`, {}, idemHeader(idempotencyKey)),
  );
}

export function clearMockActiveCarHire(): void {
  if (USE_MOCK) carHireStore.active = null;
}

export { USE_MOCK };
