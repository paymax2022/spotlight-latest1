// ── Event Transport — mock seed data ─────────────────────────────────────────
// All money is integer kobo. Fares/totals are server-owned; the client only
// displays them. bookOffer mimics the server: increments booked_count, flips to
// 'full' at capacity, and rejects with a 409-shaped error when capacity exceeded.

import type {
  EventTransportOffer,
  OfferCreateRequest,
  BookRequest,
  EventBooking,
} from '../types/event.types';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const isoAhead = (ms: number) => new Date(now() + ms).toISOString();

/** Demo Spotlight event the offers are tied to (loose ref). */
export const DEMO_EVENT_ID = 'evt_spotlight_finals';
export const DEMO_EVENT_TITLE = 'Spotlight Grand Finals';

export const eventStore: { offers: EventTransportOffer[]; bookings: EventBooking[] } = {
  offers: [],
  bookings: [],
};

function seedOffers(): EventTransportOffer[] {
  return [
    {
      id: 'eto_1', eventId: DEMO_EVENT_ID, type: 'group_ride', title: 'Group ride from Lekki',
      venue: 'Eko Convention Centre', capacity: 6, bookedCount: 2, fareKobo: 3_500_00, currency: 'NGN',
      departureTime: isoAhead(86_400_000 * 2), busScheduleId: null, geofenceRadiusM: 300,
      pickupZone: 'Lekki Phase 1 toll gate', organizerName: 'Spotlight Mobility', status: 'open',
    },
    {
      id: 'eto_2', eventId: DEMO_EVENT_ID, type: 'fan_bus', title: 'Fan bus — Mainland express',
      venue: 'Eko Convention Centre', capacity: 30, bookedCount: 18, fareKobo: 2_000_00, currency: 'NGN',
      departureTime: isoAhead(86_400_000 * 2 + 3_600_000), busScheduleId: 'sch_rt_1_6', geofenceRadiusM: 500,
      pickupZone: 'Ikeja City Mall car park', organizerName: 'Spotlight Mobility', status: 'open',
    },
    {
      id: 'eto_3', eventId: DEMO_EVENT_ID, type: 'shuttle', title: 'Venue shuttle loop',
      venue: 'Eko Convention Centre', capacity: 14, bookedCount: 14, fareKobo: 1_200_00, currency: 'NGN',
      departureTime: isoAhead(86_400_000 * 2 + 7_200_000), busScheduleId: null, geofenceRadiusM: 150,
      pickupZone: 'Civic Centre overflow lot', organizerName: 'Spotlight Mobility', status: 'full',
    },
    {
      id: 'eto_4', eventId: DEMO_EVENT_ID, type: 'artist', title: 'Artist & guest transfer',
      venue: 'Eko Convention Centre', capacity: 4, bookedCount: 1, fareKobo: 18_000_00, currency: 'NGN',
      departureTime: isoAhead(86_400_000 * 2 - 3_600_000), busScheduleId: null, geofenceRadiusM: null,
      pickupZone: null, organizerName: 'Spotlight Mobility', status: 'open',
    },
  ];
}

export function ensureEventSeed(): void {
  if (eventStore.offers.length === 0) eventStore.offers = seedOffers();
}

export function mockOffersForEvent(eventId: string): EventTransportOffer[] {
  ensureEventSeed();
  return eventStore.offers.filter((o) => o.eventId === eventId);
}

export function mockOffer(id: string): EventTransportOffer | undefined {
  ensureEventSeed();
  return eventStore.offers.find((o) => o.id === id);
}

export function makeOffer(req: OfferCreateRequest): EventTransportOffer {
  const offer: EventTransportOffer = {
    id: `eto_${now()}`,
    eventId: req.eventId,
    type: req.type,
    title: req.title,
    venue: req.venue,
    capacity: req.capacity,
    bookedCount: 0,
    fareKobo: req.fareKobo,
    currency: 'NGN',
    departureTime: req.departureTime,
    busScheduleId: req.busScheduleId ?? null,
    geofenceRadiusM: null,
    pickupZone: null,
    organizerName: 'You (organizer)',
    status: 'open',
  };
  ensureEventSeed();
  eventStore.offers.unshift(offer);
  return offer;
}

/** A 409-style capacity error the book screen can detect (.status / .code). */
export function offerFullError(): Error & { status: number; code: string } {
  const err = new Error('This offer is full. No more seats are available.') as Error & { status: number; code: string };
  err.status = 409;
  err.code = 'OFFER_FULL';
  return err;
}

export function makeBookingFromRequest(req: BookRequest): EventBooking {
  ensureEventSeed();
  const offer = eventStore.offers.find((o) => o.id === req.offerId);
  if (!offer) throw new Error('Offer not found');
  if (offer.bookedCount + req.seats > offer.capacity) throw offerFullError();

  offer.bookedCount += req.seats;
  if (offer.bookedCount >= offer.capacity) offer.status = 'full';

  const id = `ebk_${now()}`;
  const booking: EventBooking = {
    id,
    offerId: offer.id,
    eventTitle: DEMO_EVENT_TITLE,
    type: offer.type,
    venue: offer.venue,
    departureTime: offer.departureTime,
    seats: req.seats,
    fareKobo: offer.fareKobo,
    totalKobo: offer.fareKobo * req.seats,
    currency: 'NGN',
    ticketRef: req.ticketRef ?? null,
    qrCode: `PMX-EVT-${id}`,
    status: 'booked',
    pickupZone: offer.pickupZone,
    createdAt: iso(),
  };
  eventStore.bookings.unshift(booking);
  return booking;
}

function seedBookings(): EventBooking[] {
  return [
    {
      id: 'ebk_h1', offerId: 'eto_x', eventTitle: 'Lagos Music Week', type: 'fan_bus',
      venue: 'Tafawa Balewa Square', departureTime: iso(86_400_000 * 12), seats: 2,
      fareKobo: 2_000_00, totalKobo: 4_000_00, currency: 'NGN', ticketRef: 'TIX-LMW-8841',
      qrCode: null, status: 'completed', pickupZone: 'National Theatre car park',
      createdAt: iso(86_400_000 * 14),
    },
  ];
}

export function ensureBookingSeed(): void {
  if (eventStore.bookings.length === 0) eventStore.bookings = seedBookings();
}
