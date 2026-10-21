// Bus transport PRD v2 customer client — docs/bus-transport/api-contract.md.
//
// Endpoints (mounted under /api/v1/mobility/bus):
//   GET    /geo/states · GET /geo/cities?state=
//   GET    /search?from_state&to_state&from_city&to_city&date&pax&return&return_date
//   GET    /departures/:id            (stops, layout, occupancy, OD fare quote)
//   POST   /holds                     {departure_id,seat_ids,from_seq,to_seq} (Idem-Key)
//   DELETE /holds/:id
//   POST   /book                      {hold_id,legs[],passengers[]}           (Idem-Key)
//   POST   /paystack/initiate         {booking_ref}                           (Idem-Key)
//   GET    /tickets                   (my bookings)
//   GET    /tickets/:ref              (booking detail + per-ticket tokens)
//   POST   /bookings/:ref/cancel      (cancellation REQUEST)                  (Idem-Key)
//
// Contract notes / assumptions flagged for the backend build:
//  • geo pickers key on bus_geo_state/bus_geo_city row IDs (search params carry
//    those ids); display names travel only in the draft for headers.
//  • search returns {outbound[], return[]} — return[] empty for one-way.
//  • departure detail carries the static layout + occupancy INTERVALS; the
//    client derives per-segment seat status (overlap: from < new.to AND
//    to > new.from — same predicate the server enforces).
//  • od_fares is the full OD-pair matrix for the departure's route snapshot.
//  • errors follow the existing CodedError/httperr shape (data.code / data.message).
//
// Money is integer kobo. Every mutation sends an Idempotency-Key. Mock mode is
// EXPO_PUBLIC_BUS_V2 — default ON locally (backend in flight), always OFF in
// staging/production builds via mockAllowed().

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  BusBooking,
  BusBookingDetail,
  BusBookingStatus,
  BusBookingSummary,
  BusBookLegInput,
  BusBookPassengerInput,
  BusCancelPolicy,
  BusDepartureDetail,
  BusDepartureStop,
  BusDepartureSummary,
  BusGeoCity,
  BusGeoState,
  BusHoldInput,
  BusOdFare,
  BusQuoteLine,
  BusSearchResult,
  BusSeatCell,
  BusSeatHold,
  BusSeatLayout,
  BusSeatOccupancy,
  BusTicketStatus,
  BusV2SearchParams,
  BusV2Ticket,
  Kobo,
} from '../types/busV2.types';
import {
  mockGeoStates,
  mockGeoCities,
  mockSearchDepartures,
  mockDepartureDetail,
  mockCreateHold,
  mockReleaseHold,
  mockCreateBooking,
  mockInitiatePaystack,
  mockListBookings,
  mockBookingDetail,
  mockRequestCancellation,
} from './busv2.mock';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_BUS_V2, true);

const BASE = '/api/v1/mobility/bus';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// ─── Normalisers (tolerant of snake_case or camelCase payloads) ─────────────

type R = Record<string, unknown>;
const pick = (r: R, camel: string, snake: string) => r[camel] ?? r[snake];
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]) : []);

function normGeoState(r: R): BusGeoState {
  return { id: str(r.id), name: str(r.name) };
}

function normGeoCity(r: R): BusGeoCity {
  return { id: str(r.id), stateId: str(pick(r, 'stateId', 'state_id')), name: str(r.name) };
}

function normOperator(r: R): BusDepartureDetail['operator'] {
  return {
    id: str(r.id),
    name: str(r.name ?? r.business_name ?? r.businessName, 'Bus operator'),
    verified: bool(r.verified),
    ratingAvg: num(pick(r, 'ratingAvg', 'rating_avg')),
  };
}

function normStopRef(r: R): { seq: number; terminalId: string; name: string; city: string } {
  return {
    seq: num(r.seq),
    terminalId: str(pick(r, 'terminalId', 'terminal_id')),
    name: str(r.name),
    city: str(r.city),
  };
}

function normDepartureSummary(r: R): BusDepartureSummary {
  return {
    departureId: str(pick(r, 'departureId', 'departure_id') ?? r.id),
    routeId: str(pick(r, 'routeId', 'route_id')),
    operator: normOperator((r.operator ?? {}) as R),
    vehicleClass: str(pick(r, 'vehicleClass', 'vehicle_class')),
    boardingAt: strOrNull(pick(r, 'boardingAt', 'boarding_at')),
    departureAt: str(pick(r, 'departureAt', 'departure_at')),
    fromStop: normStopRef((pick(r, 'fromStop', 'from_stop') ?? {}) as R),
    toStop: normStopRef((pick(r, 'toStop', 'to_stop') ?? {}) as R),
    seatsAvailable: num(pick(r, 'seatsAvailable', 'seats_available')),
    fareKobo: num(pick(r, 'fareKobo', 'fare_kobo')) as Kobo,
    currency: 'NGN',
    amenities: Array.isArray(r.amenities) ? (r.amenities as string[]) : [],
  };
}

function normStop(r: R): BusDepartureStop {
  return {
    ...normStopRef(r),
    arriveOffsetMin: num(pick(r, 'arriveOffsetMin', 'arrive_offset_min')),
    departOffsetMin: num(pick(r, 'departOffsetMin', 'depart_offset_min')),
    canBoard: bool(pick(r, 'canBoard', 'can_board'), true),
    canAlight: bool(pick(r, 'canAlight', 'can_alight'), true),
  };
}

function normSeatCell(r: R): BusSeatCell {
  const kind = str(r.kind ?? r.type, 'standard');
  return {
    seatId: str(pick(r, 'seatId', 'seat_id') ?? r.id),
    label: str(r.label),
    row: num(r.row),
    col: num(pick(r, 'col', 'column')),
    deck: num(r.deck, 1),
    kind: kind === 'premium' || kind === 'empty' || kind === 'driver' ? kind : 'standard',
    blocked: bool(r.blocked),
  };
}

function normLayout(r: R): BusSeatLayout {
  const cells = arr(pick(r, 'cells', 'seats')).map(normSeatCell);
  return {
    rows: num(r.rows, Math.max(0, ...cells.map((c) => c.row))),
    cols: num(r.cols ?? r.columns, Math.max(0, ...cells.map((c) => c.col))),
    decks: num(r.decks, Math.max(1, ...cells.map((c) => c.deck))),
    aisleAfterCol: Array.isArray(pick(r, 'aisleAfterCol', 'aisle_after_col'))
      ? (pick(r, 'aisleAfterCol', 'aisle_after_col') as number[]).filter((n) => Number.isInteger(n))
      : [],
    cells,
  };
}

function normOccupancy(r: R): BusSeatOccupancy {
  return {
    seatId: str(pick(r, 'seatId', 'seat_id')),
    fromSeq: num(pick(r, 'fromSeq', 'from_seq')),
    toSeq: num(pick(r, 'toSeq', 'to_seq')),
    kind: str(r.kind) === 'held' ? 'held' : 'booked',
  };
}

function normOdFare(r: R): BusOdFare {
  return {
    fromSeq: num(pick(r, 'fromSeq', 'from_seq')),
    toSeq: num(pick(r, 'toSeq', 'to_seq')),
    fareKobo: num(pick(r, 'fareKobo', 'fare_kobo')) as Kobo,
  };
}

function normQuote(r: R | null | undefined): BusBooking['quote'] {
  if (!r) return null;
  const lines: BusQuoteLine[] = arr(pick(r, 'lines', 'lines')).map((l) => ({
    label: str(l.label),
    amountKobo: num(pick(l, 'amountKobo', 'amount_kobo')) as Kobo,
  }));
  return { currency: 'NGN', lines, totalKobo: num(pick(r, 'totalKobo', 'total_kobo')) as Kobo };
}

const BOOKING_STATUSES: BusBookingStatus[] = [
  'pending_payment', 'issued', 'partially_issued', 'completed',
  'cancel_requested', 'cancelled', 'refunded', 'expired',
];
const normBookingStatus = (v: unknown): BusBookingStatus =>
  BOOKING_STATUSES.includes(v as BusBookingStatus) ? (v as BusBookingStatus) : 'issued';

const TICKET_STATUSES: BusTicketStatus[] = [
  'pending', 'issued', 'boarding', 'boarded', 'completed',
  'cancel_requested', 'cancelled', 'refunded', 'expired',
];
const normTicketStatus = (v: unknown): BusTicketStatus =>
  TICKET_STATUSES.includes(v as BusTicketStatus) ? (v as BusTicketStatus) : 'issued';

function normTicket(r: R, bookingRef: string): BusV2Ticket {
  return {
    ticketToken: str(pick(r, 'ticketToken', 'ticket_token') ?? r.token),
    status: normTicketStatus(r.status),
    bookingRef,
    departureId: str(pick(r, 'departureId', 'departure_id')),
    legIndex: num(pick(r, 'legIndex', 'leg_index')),
    seatLabel: str(pick(r, 'seatLabel', 'seat_label') ?? r.seat),
    passengerName: str(pick(r, 'passengerName', 'passenger_name')),
    routeLabel: str(pick(r, 'routeLabel', 'route_label')),
    operatorName: str(pick(r, 'operatorName', 'operator_name')),
    fromTerminal: str(pick(r, 'fromTerminal', 'from_terminal')),
    toTerminal: str(pick(r, 'toTerminal', 'to_terminal')),
    boardingAt: strOrNull(pick(r, 'boardingAt', 'boarding_at')),
    departureAt: str(pick(r, 'departureAt', 'departure_at')),
    fareKobo: num(pick(r, 'fareKobo', 'fare_kobo')) as Kobo,
  };
}

function normCancelPolicy(r: R | null | undefined): BusCancelPolicy {
  const p = (r ?? {}) as R;
  return {
    cancellable: bool(p.cancellable),
    deadline: strOrNull(pick(p, 'deadline', 'deadline') ?? pick(p, 'cancelDeadline', 'cancel_deadline')),
    cutoffMinutes: p.cutoff_minutes != null || p.cutoffMinutes != null
      ? num(pick(p, 'cutoffMinutes', 'cutoff_minutes'))
      : null,
    refundPercent: p.refund_percent != null || p.refundPercent != null
      ? num(pick(p, 'refundPercent', 'refund_percent'))
      : null,
    feeKobo: p.fee_kobo != null || p.feeKobo != null
      ? (num(pick(p, 'feeKobo', 'fee_kobo')) as Kobo)
      : null,
    note: strOrNull(p.note),
  };
}

// ─── Geography reference data ───────────────────────────────────────────────

// GET /mobility/bus/geo/states → {states:[{id,name}]}
export async function listGeoStates(): Promise<BusGeoState[]> {
  if (USE_MOCK) {
    await delay(240);
    return mockGeoStates();
  }
  const res = await api.get(`${BASE}/geo/states`);
  return arr(res.data?.states ?? res.data?.data?.states ?? res.data?.data ?? res.data).map(normGeoState);
}

// GET /mobility/bus/geo/cities?state=<state_id> → {cities:[{id,state_id,name}]}
export async function listGeoCities(stateId: string): Promise<BusGeoCity[]> {
  if (USE_MOCK) {
    await delay(200);
    return mockGeoCities(stateId);
  }
  const res = await api.get(`${BASE}/geo/cities`, { params: { state: stateId } });
  return arr(res.data?.cities ?? res.data?.data?.cities ?? res.data?.data ?? res.data).map(normGeoCity);
}

// ─── Search ─────────────────────────────────────────────────────────────────

// GET /mobility/bus/search?from_state&to_state&from_city&to_city&date&pax&
//   return&return_date → {outbound:[…], return:[…]}
export async function searchDepartures(params: BusV2SearchParams): Promise<BusSearchResult> {
  if (USE_MOCK) {
    await delay(420);
    return mockSearchDepartures(params);
  }
  const res = await api.get(`${BASE}/search`, {
    params: {
      from_state: params.fromStateId,
      to_state: params.toStateId,
      ...(params.fromCityId ? { from_city: params.fromCityId } : {}),
      ...(params.toCityId ? { to_city: params.toCityId } : {}),
      date: params.date,
      pax: params.pax,
      return: params.tripType === 'return' ? 'true' : 'false',
      ...(params.tripType === 'return' && params.returnDate ? { return_date: params.returnDate } : {}),
    },
  });
  const body = (res.data?.data ?? res.data) as R;
  return {
    outbound: arr(body?.outbound).map(normDepartureSummary),
    returnLegs: arr(body?.return ?? body?.return_legs).map(normDepartureSummary),
  };
}

// ─── Departure detail ───────────────────────────────────────────────────────

// GET /mobility/bus/departures/:id → {departure:{…},stops,layout,occupancy,od_fares}
// (flat payloads are tolerated too — the normalisers read both shapes).
export async function getDeparture(departureId: string): Promise<BusDepartureDetail> {
  if (USE_MOCK) {
    await delay(300);
    return mockDepartureDetail(departureId);
  }
  const res = await api.get(`${BASE}/departures/${departureId}`);
  const body = (res.data?.data ?? res.data) as R;
  const dep = (body?.departure ?? body) as R;
  return {
    departureId: str(pick(dep, 'departureId', 'departure_id') ?? dep.id ?? departureId),
    routeId: str(pick(dep, 'routeId', 'route_id')),
    operator: normOperator((dep.operator ?? {}) as R),
    vehicleClass: str(pick(dep, 'vehicleClass', 'vehicle_class')),
    boardingAt: strOrNull(pick(dep, 'boardingAt', 'boarding_at')),
    departureAt: str(pick(dep, 'departureAt', 'departure_at')),
    stops: arr(body?.stops ?? dep.stops).map(normStop),
    layout: normLayout((body?.layout ?? dep.layout ?? {}) as R),
    occupancy: arr(body?.occupancy ?? dep.occupancy).map(normOccupancy),
    odFares: arr(body?.od_fares ?? body?.odFares ?? dep.od_fares ?? dep.odFares).map(normOdFare),
    currency: 'NGN',
  };
}

// ─── Holds ──────────────────────────────────────────────────────────────────

// POST /mobility/bus/holds {departure_id,seat_ids,from_seq,to_seq} + Idem-Key
// → {hold_id, expires_at, …}. 409/SEAT_CONFLICT when the segment raced.
export async function createHold(req: BusHoldInput, idempotencyKey: string): Promise<BusSeatHold> {
  if (USE_MOCK) {
    await delay(500);
    return mockCreateHold(req);
  }
  const res = await api.post(
    `${BASE}/holds`,
    {
      departure_id: req.departureId,
      seat_ids: req.seatIds,
      from_seq: req.fromSeq,
      to_seq: req.toSeq,
    },
    idemHeader(idempotencyKey),
  );
  const r = (res.data?.data ?? res.data) as R;
  return {
    holdId: str(pick(r, 'holdId', 'hold_id') ?? r.id),
    departureId: str(pick(r, 'departureId', 'departure_id'), req.departureId),
    seatIds: Array.isArray(pick(r, 'seatIds', 'seat_ids'))
      ? (pick(r, 'seatIds', 'seat_ids') as string[])
      : req.seatIds,
    fromSeq: num(pick(r, 'fromSeq', 'from_seq'), req.fromSeq),
    toSeq: num(pick(r, 'toSeq', 'to_seq'), req.toSeq),
    expiresAt: strOrNull(pick(r, 'expiresAt', 'expires_at')),
  };
}

// DELETE /mobility/bus/holds/:id — release an unused hold (best effort).
export async function releaseHold(holdId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    mockReleaseHold(holdId);
    return;
  }
  await api.delete(`${BASE}/holds/${holdId}`);
}

// ─── Booking ────────────────────────────────────────────────────────────────

// POST /mobility/bus/book {hold_id,legs[],passengers[]} + Idem-Key
// → {booking_ref,status,quote}. legs[] carries one entry per direction; the
// primary (outbound) hold id is also sent top-level per the contract.
export async function createBooking(
  req: { holdId: string; legs: BusBookLegInput[]; passengers: BusBookPassengerInput[] },
  idempotencyKey: string,
): Promise<BusBooking> {
  if (USE_MOCK) {
    await delay(700);
    return mockCreateBooking(req);
  }
  const res = await api.post(
    `${BASE}/book`,
    {
      hold_id: req.holdId,
      legs: req.legs.map((l) => ({
        departure_id: l.departureId,
        hold_id: l.holdId,
        seat_ids: l.seatIds,
        from_seq: l.fromSeq,
        to_seq: l.toSeq,
      })),
      passengers: req.passengers.map((p) => ({
        name: p.name,
        phone: p.phone,
        self: p.isSelf,
        deliver_to: p.deliverTo,
      })),
    },
    idemHeader(idempotencyKey),
  );
  const r = (res.data?.data ?? res.data) as R;
  return {
    bookingRef: str(pick(r, 'bookingRef', 'booking_ref')),
    status: normBookingStatus(r.status),
    quote: normQuote(r.quote as R),
    createdAt: str(pick(r, 'createdAt', 'created_at')),
  };
}

// POST /mobility/bus/paystack/initiate {booking_ref} + Idem-Key
// → {authorization_url, reference}. Resumed in-app by useGatewayCheckout.
export async function initiatePaystack(
  bookingRef: string,
  idempotencyKey: string,
  email?: string,
): Promise<{ authorizationUrl: string; reference: string }> {
  if (USE_MOCK) {
    await delay(600);
    return mockInitiatePaystack(bookingRef);
  }
  const res = await api.post(
    `${BASE}/paystack/initiate`,
    { booking_ref: bookingRef, ...(email ? { email } : {}) },
    idemHeader(idempotencyKey),
  );
  const r = (res.data?.data ?? res.data) as R;
  return {
    authorizationUrl: str(pick(r, 'authorizationUrl', 'authorization_url')),
    reference: str(r.reference),
  };
}

// ─── Tickets + cancellation ─────────────────────────────────────────────────

// GET /mobility/bus/tickets → {bookings:[…]} (my bookings, newest first)
export async function listMyBookings(): Promise<BusBookingSummary[]> {
  if (USE_MOCK) {
    await delay(280);
    return mockListBookings();
  }
  const res = await api.get(`${BASE}/tickets`);
  const list = res.data?.bookings ?? res.data?.tickets ?? res.data?.data ?? res.data;
  return arr(list).map((r): BusBookingSummary => ({
    bookingRef: str(pick(r, 'bookingRef', 'booking_ref')),
    status: normBookingStatus(r.status),
    routeLabel: str(pick(r, 'routeLabel', 'route_label')),
    operatorName: str(pick(r, 'operatorName', 'operator_name')),
    boardingAt: strOrNull(pick(r, 'boardingAt', 'boarding_at')),
    departureAt: str(pick(r, 'departureAt', 'departure_at')),
    seatLabels: Array.isArray(pick(r, 'seatLabels', 'seat_labels'))
      ? (pick(r, 'seatLabels', 'seat_labels') as string[])
      : [],
    passengerCount: num(pick(r, 'passengerCount', 'passenger_count'), 1),
    totalKobo: num(pick(r, 'totalKobo', 'total_kobo')) as Kobo,
    currency: 'NGN',
  }));
}

// GET /mobility/bus/tickets/:ref → {booking:{…},tickets:[…],cancel_policy:{…}}
export async function getBooking(bookingRef: string): Promise<BusBookingDetail> {
  if (USE_MOCK) {
    await delay(260);
    return mockBookingDetail(bookingRef);
  }
  const res = await api.get(`${BASE}/tickets/${bookingRef}`);
  const body = (res.data?.data ?? res.data) as R;
  const b = (body?.booking ?? body) as R;
  const tickets = arr(body?.tickets ?? b.tickets).map((t) =>
    normTicket(t, str(pick(b, 'bookingRef', 'booking_ref') ?? bookingRef)),
  );
  return {
    bookingRef: str(pick(b, 'bookingRef', 'booking_ref') ?? bookingRef),
    status: normBookingStatus(b.status),
    createdAt: str(pick(b, 'createdAt', 'created_at')),
    quote: normQuote(b.quote as R),
    tickets,
    cancelPolicy: normCancelPolicy((body?.cancel_policy ?? body?.cancelPolicy ?? b.cancel_policy ?? b.cancelPolicy) as R),
    routeLabel: str(pick(b, 'routeLabel', 'route_label'), tickets[0]?.routeLabel ?? 'Bus booking'),
    operatorName: str(pick(b, 'operatorName', 'operator_name'), tickets[0]?.operatorName ?? ''),
    boardingAt: strOrNull(pick(b, 'boardingAt', 'boarding_at') ?? tickets[0]?.boardingAt),
    departureAt: str(pick(b, 'departureAt', 'departure_at'), tickets[0]?.departureAt ?? ''),
  };
}

export interface BusCancelRequestResult {
  status: BusBookingStatus;
  refundStatus: 'none' | 'pending' | 'refunded' | 'failed' | 'manual_required';
  refundedKobo: Kobo;
  message: string;
}

// POST /mobility/bus/bookings/:ref/cancel — a cancellation REQUEST: the server
// answers the new status + refund verdict (refund may stay pending). 409 when
// the window closed or the booking is in a non-cancellable state.
export async function requestCancellation(
  bookingRef: string,
  idempotencyKey: string,
): Promise<BusCancelRequestResult> {
  if (USE_MOCK) {
    await delay(500);
    const r = mockRequestCancellation(bookingRef);
    return { status: r.status, refundStatus: 'pending', refundedKobo: 0, message: r.message };
  }
  const res = await api.post(`${BASE}/bookings/${bookingRef}/cancel`, {}, idemHeader(idempotencyKey));
  const r = (res.data?.data ?? res.data) as R;
  const rs = str(pick(r, 'refundStatus', 'refund_status'));
  const refundStatus = (['none', 'pending', 'refunded', 'failed', 'manual_required'] as const).includes(
    rs as 'none',
  )
    ? (rs as BusCancelRequestResult['refundStatus'])
    : 'pending';
  const rk = pick(r, 'refundedKobo', 'refunded_kobo');
  return {
    status: r.status ? normBookingStatus(r.status) : 'cancel_requested',
    refundStatus,
    refundedKobo: refundStatus === 'refunded' && typeof rk === 'number' ? Math.trunc(rk) : 0,
    message: str(r.message),
  };
}

export { USE_MOCK };
