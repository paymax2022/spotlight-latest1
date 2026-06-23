// ── Event Transport — API wrapper ────────────────────────────────────────────
// Typed data layer the event-transport screens code against. Mirrors
// parcel.api.ts: mock-flagged, BASE = '/api/finance', Idempotency-Key on money
// mutations. Flip EXPO_PUBLIC_MOBILITY_USE_MOCK=false (or
// EXPO_PUBLIC_EVENT_USE_MOCK) once the Go endpoints land.
//
// IRON RULES: all money is integer kobo; create/book carry an Idempotency-Key;
// fares/totals come from the SERVER — never computed here.

import { api } from '@/api/client';
import type {
  EventTransportOffer,
  OfferCreateRequest,
  BookRequest,
  EventBooking,
} from '../types/event.types';
import {
  eventStore,
  ensureBookingSeed,
  mockOffersForEvent,
  mockOffer,
  makeOffer,
  makeBookingFromRequest,
} from './event.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_EVENT_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/finance';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// ═══════════════════════════════════════════════════════════════════════════════
// OFFERS
// ═══════════════════════════════════════════════════════════════════════════════
export async function getEventOffers(eventId: string): Promise<EventTransportOffer[]> {
  if (USE_MOCK) {
    await delay(400);
    return mockOffersForEvent(eventId);
  }
  return unwrap<EventTransportOffer[]>(await api.get(`${BASE}/mobility/events/${eventId}/transport`));
}

export async function getOffer(id: string): Promise<EventTransportOffer> {
  if (USE_MOCK) {
    await delay(260);
    const found = mockOffer(id);
    if (!found) throw new Error('Offer not found');
    return found;
  }
  return unwrap<EventTransportOffer>(await api.get(`${BASE}/mobility/events/transport/${id}`));
}

// ─── Create offer (organizer; Idempotency-Key) ─────────────────────────────────
export async function createOffer(req: OfferCreateRequest): Promise<EventTransportOffer> {
  if (USE_MOCK) {
    await delay(800);
    return makeOffer(req);
  }
  return unwrap<EventTransportOffer>(
    await api.post(
      `${BASE}/mobility/events/transport`,
      {
        event_id: req.eventId,
        type: req.type,
        title: req.title,
        venue: req.venue,
        capacity: req.capacity,
        fare_kobo: req.fareKobo,
        departure_time: req.departureTime,
        bus_schedule_id: req.busScheduleId,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

// ─── Book (money mutation → escrow → settle organizer → QR; Idempotency-Key) ───
export async function bookOffer(req: BookRequest): Promise<EventBooking> {
  if (USE_MOCK) {
    await delay(900);
    return makeBookingFromRequest(req); // throws OFFER_FULL (409) when capacity exceeded
  }
  return unwrap<EventBooking>(
    await api.post(
      `${BASE}/mobility/events/transport/${req.offerId}/book`,
      {
        seats: req.seats,
        ticket_ref: req.ticketRef,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getBookings(): Promise<EventBooking[]> {
  if (USE_MOCK) {
    await delay();
    ensureBookingSeed();
    return [...eventStore.bookings].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<EventBooking[]>(await api.get(`${BASE}/mobility/events/bookings`));
}

export async function cancelBooking(id: string): Promise<EventBooking> {
  if (USE_MOCK) {
    await delay(500);
    ensureBookingSeed();
    const b = eventStore.bookings.find((x) => x.id === id);
    if (!b) throw new Error('Booking not found');
    b.status = 'refunded';
    b.qrCode = null;
    return b;
  }
  return unwrap<EventBooking>(await api.post(`${BASE}/mobility/events/bookings/${id}/cancel`, {}));
}

export { USE_MOCK };
