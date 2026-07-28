// ── Paymax Mobility — Event Transport types ──────────────────────────────────
// Types for the event-transport mode (Spotlight): organizers publish transport
// offers tied to an event; riders book seats with a QR boarding pass; an
// optional ticket+ride bundle links a ticket_ref. Mirrors
// docs/prd/transportation/BUILD-CONTRACT-LOGISTICS-EVENT.md.
//
// IRON RULES: all money is integer minor units (kobo). Never floats for money.
// Fares/totals are server-computed — the client only *displays* them.

import type { Kobo } from './mobility.types';

// Re-exported so event screens can import shared money types from one place.
export type { Kobo, Place } from './mobility.types';

// ═══════════════════════════════════════════════════════════════════════════════
// OFFER
// ═══════════════════════════════════════════════════════════════════════════════
export type EventOfferType =
  | 'group_ride'
  | 'fan_bus'
  | 'shuttle'
  | 'artist'
  | 'crew'
  | 'equipment_van';

export type OfferStatus =
  | 'draft'
  | 'open'
  | 'full'
  | 'departed'
  | 'completed'
  | 'cancelled';

export interface EventTransportOffer {
  id: string;
  eventId: string;            // loose ref to a Spotlight event
  type: EventOfferType;
  title: string;
  venue: string;
  capacity: number;
  bookedCount: number;
  fareKobo: Kobo;             // per-seat fare (server)
  currency: 'NGN';
  departureTime: string;
  busScheduleId: string | null;   // fan-bus may link a bus schedule
  geofenceRadiusM: number | null; // venue geofencing, surfaced from offer
  pickupZone: string | null;      // post-event pickup zone
  organizerName: string;
  status: OfferStatus;
}

export interface OfferCreateRequest {
  eventId: string;
  type: EventOfferType;
  title: string;
  venue: string;
  capacity: number;
  fareKobo: Kobo;
  departureTime: string;
  busScheduleId?: string;
  idempotencyKey: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING
// ═══════════════════════════════════════════════════════════════════════════════
export type BookingStatus =
  | 'booked'
  | 'confirmed'
  | 'boarded'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface BookRequest {
  offerId: string;
  seats: number;
  ticketRef?: string;         // ticket+ride bundle reference
  idempotencyKey: string;     // money mutation → escrow → settle organizer
}

export interface EventBooking {
  id: string;
  offerId: string;
  eventTitle: string;
  type: EventOfferType;
  venue: string;
  departureTime: string;
  seats: number;
  fareKobo: Kobo;             // per-seat fare (server)
  totalKobo: Kobo;            // seats × fare (server)
  currency: 'NGN';
  ticketRef: string | null;
  qrCode: string | null;      // QR payload once booked
  status: BookingStatus;
  pickupZone: string | null;
  createdAt: string;
}
