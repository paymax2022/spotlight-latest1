// Types for the bus transport PRD v2 customer flow (docs/bus-transport/
// api-contract.md). camelCase client-side; the api layer normalises whatever
// wire casing the backend emits. ALL money is integer kobo — never floats,
// never computed locally: fares/quotes arrive from the server.

import type { Kobo } from './mobility.types';
export type { Kobo };

// ─── Geography reference data (bus_geo_state / bus_geo_city) ────────────────

export interface BusGeoState {
  id: string;
  name: string;
}

export interface BusGeoCity {
  id: string;
  stateId: string;
  name: string;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export type BusTripType = 'oneway' | 'return';

export interface BusV2SearchParams {
  fromStateId: string;
  toStateId: string;
  /** Optional city/terminal-area filters (bus_geo_city ids). */
  fromCityId?: string;
  toCityId?: string;
  /** Display names kept for headers/summaries — never sent for identity. */
  fromState?: string;
  toState?: string;
  fromCity?: string;
  toCity?: string;
  /** Departure date, YYYY-MM-DD. */
  date: string;
  /** Passengers (1..MAX). */
  pax: number;
  tripType: BusTripType;
  /** Required when tripType === 'return', YYYY-MM-DD. */
  returnDate?: string;
}

export interface BusOperatorSummary {
  id: string;
  name: string;
  verified: boolean;
  ratingAvg: number;
}

export interface BusStopRef {
  seq: number;
  terminalId: string;
  name: string;
  city: string;
}

export interface BusDepartureSummary {
  departureId: string;
  routeId: string;
  operator: BusOperatorSummary;
  vehicleClass: string;
  /** When boarding opens — DISTINCT from departureAt (the wheels-move time). */
  boardingAt: string | null;
  departureAt: string;
  /** The segment this fare covers (the searched OD pair mapped onto stops). */
  fromStop: BusStopRef;
  toStop: BusStopRef;
  seatsAvailable: number;
  /** Per-seat fare for the searched OD pair, server-quoted. */
  fareKobo: Kobo;
  currency: 'NGN';
  amenities: string[];
}

export interface BusSearchResult {
  outbound: BusDepartureSummary[];
  /** Empty for one-way searches. */
  returnLegs: BusDepartureSummary[];
}

// ─── Departure detail: stops, layout, occupancy, OD fare matrix ─────────────

export interface BusDepartureStop {
  seq: number;
  terminalId: string;
  name: string;
  city: string;
  /** Minutes from departureAt when the bus reaches/leaves this stop. */
  arriveOffsetMin: number;
  departOffsetMin: number;
  canBoard: boolean;
  canAlight: boolean;
}

export type BusSeatKind = 'standard' | 'premium' | 'empty' | 'driver';

export interface BusSeatCell {
  seatId: string;
  label: string;
  row: number;
  col: number;
  deck: number;
  kind: BusSeatKind;
  /** Layout-level block (e.g. reserved for crew/luggage) — always unavailable. */
  blocked: boolean;
}

export interface BusSeatLayout {
  rows: number;
  cols: number;
  decks: number;
  /** Column indexes after which an aisle gap is rendered (e.g. [2] → 2+aisle+2). */
  aisleAfterCol: number[];
  cells: BusSeatCell[];
}

export type BusOccupancyKind = 'booked' | 'held';

/** A seat's unavailable interval, half-open [fromSeq, toSeq) over stop seqs. */
export interface BusSeatOccupancy {
  seatId: string;
  fromSeq: number;
  toSeq: number;
  kind: BusOccupancyKind;
}

/** One entry of the route's OD fare matrix — per-seat price for [fromSeq,toSeq). */
export interface BusOdFare {
  fromSeq: number;
  toSeq: number;
  fareKobo: Kobo;
}

export interface BusDepartureDetail {
  departureId: string;
  routeId: string;
  operator: BusOperatorSummary;
  vehicleClass: string;
  boardingAt: string | null;
  departureAt: string;
  stops: BusDepartureStop[];
  layout: BusSeatLayout;
  occupancy: BusSeatOccupancy[];
  odFares: BusOdFare[];
  currency: 'NGN';
}

export type BusSeatStatus = 'available' | 'selected' | 'held' | 'booked' | 'blocked';

// ─── Holds ──────────────────────────────────────────────────────────────────

export interface BusHoldInput {
  departureId: string;
  seatIds: string[];
  fromSeq: number;
  toSeq: number;
}

export interface BusSeatHold {
  holdId: string;
  departureId: string;
  seatIds: string[];
  fromSeq: number;
  toSeq: number;
  /** ISO — the hold lapses after this; booking must complete before it. */
  expiresAt: string | null;
}

// ─── Booking ────────────────────────────────────────────────────────────────

export type BusLegDirection = 'outbound' | 'return';

export interface BusBookLegInput {
  departureId: string;
  holdId: string;
  seatIds: string[];
  fromSeq: number;
  toSeq: number;
}

export type BusDeliverTo = 'purchaser' | 'passenger';

export interface BusBookPassengerInput {
  name: string;
  /** E.164 phone. */
  phone: string;
  /** True when this passenger IS the signed-in purchaser. */
  isSelf: boolean;
  deliverTo: BusDeliverTo;
}

export interface BusQuoteLine {
  label: string;
  amountKobo: Kobo;
}

/** Server fare quote — the ONLY fare breakdown the review screen may show. */
export interface BusBookingQuote {
  currency: 'NGN';
  lines: BusQuoteLine[];
  totalKobo: Kobo;
}

export type BusBookingStatus =
  | 'pending_payment'
  | 'issued'
  | 'partially_issued'
  | 'completed'
  | 'cancel_requested'
  | 'cancelled'
  | 'refunded'
  | 'expired';

export interface BusBooking {
  bookingRef: string;
  status: BusBookingStatus;
  quote: BusBookingQuote | null;
  createdAt: string;
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export type BusTicketStatus =
  | 'pending'
  | 'issued'
  | 'boarding'
  | 'boarded'
  | 'completed'
  | 'cancel_requested'
  | 'cancelled'
  | 'refunded'
  | 'expired';

/** Row on "My tickets" — one per booking (may cover several legs/passengers). */
export interface BusBookingSummary {
  bookingRef: string;
  status: BusBookingStatus;
  routeLabel: string;
  operatorName: string;
  boardingAt: string | null;
  departureAt: string;
  seatLabels: string[];
  passengerCount: number;
  totalKobo: Kobo;
  currency: 'NGN';
}

export interface BusV2Ticket {
  /** Non-guessable ticket token — also the QR payload the operator scans. */
  ticketToken: string;
  status: BusTicketStatus;
  bookingRef: string;
  departureId: string;
  legIndex: number;
  seatLabel: string;
  passengerName: string;
  routeLabel: string;
  operatorName: string;
  fromTerminal: string;
  toTerminal: string;
  boardingAt: string | null;
  departureAt: string;
  fareKobo: Kobo;
}

export interface BusCancelPolicy {
  cancellable: boolean;
  /** ISO deadline after which online cancel closes, if the server sent one. */
  deadline: string | null;
  cutoffMinutes: number | null;
  /** Expected refund percentage (0-100) if the policy discloses one. */
  refundPercent: number | null;
  feeKobo: Kobo | null;
  note: string | null;
}

export interface BusBookingDetail {
  bookingRef: string;
  status: BusBookingStatus;
  createdAt: string;
  quote: BusBookingQuote | null;
  tickets: BusV2Ticket[];
  cancelPolicy: BusCancelPolicy;
  /** Operator-facing route label for the header. */
  routeLabel: string;
  operatorName: string;
  boardingAt: string | null;
  departureAt: string;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Server error codes the v2 flow reacts to explicitly. */
export type BusV2ErrorCode =
  | 'SEAT_CONFLICT'      // hold/book raced another customer — refresh the map
  | 'HOLD_EXPIRED'       // hold TTL lapsed — reselect seats
  | 'HOLD_NOT_FOUND'
  | 'FARE_UNAVAILABLE'
  | 'CANCEL_WINDOW_CLOSED'
  | 'BOOKING_NOT_FOUND'
  | 'PAYMENT_REQUIRED'
  | 'INVALID_STATE'
  | 'UNKNOWN';
