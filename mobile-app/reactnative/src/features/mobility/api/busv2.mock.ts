// Mock layer for the PRD v2 bus flow. Deterministic fixtures so e2e and local
// dev see stable data; holds/bookings/tickets live in module stores so the
// hold→book→ticket flow is exercisable end to end without the backend.
// ALL money is integer kobo. Mock fares exist to exercise the UI, never to
// price real inventory.

import type {
  BusBooking,
  BusBookingDetail,
  BusBookingSummary,
  BusBookingStatus,
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
import { fareForSegment, segmentsOverlap, seatStatusForSegment } from '../utils/busV2';

const now = () => Date.now();
const isoAhead = (ms: number) => new Date(now() + ms).toISOString();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();

// ─── Geography (mirrors bus_geo_state / bus_geo_city rows) ──────────────────

export const MOCK_GEO_STATES: BusGeoState[] = [
  { id: 'st_lagos', name: 'Lagos' },
  { id: 'st_fct', name: 'Abuja (FCT)' },
  { id: 'st_oyo', name: 'Oyo' },
  { id: 'st_edo', name: 'Edo' },
  { id: 'st_rivers', name: 'Rivers' },
  { id: 'st_kano', name: 'Kano' },
];

const CITIES: Record<string, BusGeoCity[]> = {
  st_lagos: [
    { id: 'ct_jibowu', stateId: 'st_lagos', name: 'Jibowu' },
    { id: 'ct_ojota', stateId: 'st_lagos', name: 'Ojota' },
    { id: 'ct_lekki', stateId: 'st_lagos', name: 'Lekki' },
  ],
  st_fct: [
    { id: 'ct_utako', stateId: 'st_fct', name: 'Utako' },
    { id: 'ct_wuse', stateId: 'st_fct', name: 'Wuse' },
    { id: 'ct_kubwa', stateId: 'st_fct', name: 'Kubwa' },
  ],
  st_oyo: [
    { id: 'ct_ibadan', stateId: 'st_oyo', name: 'Ibadan' },
    { id: 'ct_ogbomosho', stateId: 'st_oyo', name: 'Ogbomosho' },
  ],
  st_edo: [
    { id: 'ct_benin', stateId: 'st_edo', name: 'Benin City' },
    { id: 'ct_auchi', stateId: 'st_edo', name: 'Auchi' },
  ],
  st_rivers: [
    { id: 'ct_ph', stateId: 'st_rivers', name: 'Port Harcourt' },
  ],
  st_kano: [
    { id: 'ct_kano', stateId: 'st_kano', name: 'Kano' },
  ],
};

export function mockGeoStates(): BusGeoState[] {
  return MOCK_GEO_STATES;
}

export function mockGeoCities(stateId: string): BusGeoCity[] {
  return CITIES[stateId] ?? [];
}

// ─── Departures ─────────────────────────────────────────────────────────────

const OPERATORS = [
  { id: 'op_gig', name: 'GIG Mobility', verified: true, ratingAvg: 4.7 },
  { id: 'op_abc', name: 'ABC Transport', verified: true, ratingAvg: 4.5 },
  { id: 'op_god', name: 'God is Good', verified: true, ratingAvg: 4.6 },
];

interface MockDeparture extends BusDepartureDetail {
  _baseFareKobo: Kobo;
  _stopsTemplate: { name: string; city: string; stateId: string; canBoard: boolean; canAlight: boolean }[];
}

/** Tiny deterministic hash so departure ids/times are stable per search. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function stopTemplate(fromStateId: string, toStateId: string) {
  const cityOf = (sid: string) => (CITIES[sid] ?? [{ name: 'Central', id: '', stateId: sid }])[0].name;
  const nameOf = (sid: string) => MOCK_GEO_STATES.find((s) => s.id === sid)?.name ?? sid;
  const multi = fromStateId === 'st_lagos' && toStateId === 'st_fct';
  // Multi-stop routes only where an intermediate state makes sense.
  const via = multi ? [{ name: 'Challenge Motor Park', city: cityOf('st_oyo'), stateId: 'st_oyo', canBoard: true, canAlight: true }] : [];
  return [
    { name: `${nameOf(fromStateId)} Central Terminal`, city: cityOf(fromStateId), stateId: fromStateId, canBoard: true, canAlight: false },
    ...via,
    { name: `${nameOf(toStateId)} Gateway Terminal`, city: cityOf(toStateId), stateId: toStateId, canBoard: false, canAlight: true },
  ];
}

function buildLayout(rows = 9, cols = 4): BusSeatLayout {
  const cells: BusSeatCell[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const isDoor = r === 1 && c === 4;
      const isBlocked = r === rows && c >= 3; // luggage shelf on the last row
      cells.push({
        seatId: `s_r${r}c${c}`,
        label: `${String.fromCharCode(64 + c)}${r}`,
        row: r,
        col: c,
        deck: 1,
        kind: isDoor ? 'empty' : 'standard',
        blocked: isBlocked,
      });
    }
  }
  return { rows, cols, decks: 1, aisleAfterCol: [2], cells };
}

function buildOccupancy(depId: string, layout: BusSeatLayout): BusSeatOccupancy[] {
  const h = hash(depId);
  const out: BusSeatOccupancy[] = [];
  for (const cell of layout.cells) {
    if (cell.kind !== 'standard' || cell.blocked) continue;
    const v = (h + cell.row * 7 + cell.col) % 11;
    if (v === 0) out.push({ seatId: cell.seatId, fromSeq: 1, toSeq: 3, kind: 'booked' });
    else if (v === 5) out.push({ seatId: cell.seatId, fromSeq: 1, toSeq: 2, kind: 'booked' });
    else if (v === 8) out.push({ seatId: cell.seatId, fromSeq: 2, toSeq: 3, kind: 'held' });
  }
  return out;
}

function buildOdFares(stops: BusDepartureStop[], baseKobo: Kobo): BusOdFare[] {
  const fares: BusOdFare[] = [];
  for (const from of stops) {
    for (const to of stops) {
      if (!from.canBoard || !to.canAlight || to.seq <= from.seq) continue;
      const span = to.seq - from.seq;
      fares.push({ fromSeq: from.seq, toSeq: to.seq, fareKobo: baseKobo * span });
    }
  }
  return fares;
}

const detailCache = new Map<string, MockDeparture>();

function buildDeparture(
  key: string,
  idx: number,
  fromStateId: string,
  toStateId: string,
  departIso: string,
  direction: 'outbound' | 'return',
): MockDeparture {
  const depId = `dep_${direction}_${hash(key + idx)}_${idx}`;
  const op = OPERATORS[hash(depId) % OPERATORS.length];
  const classes = ['18-seater Coaster', 'Luxury 30-seater', 'Executive 14-seater'];
  const tpl = stopTemplate(fromStateId, toStateId);
  const departMs = Date.parse(departIso);
  const gap = tpl.length > 2 ? Math.floor(24_000_000 / (tpl.length - 1)) : 0;
  const stops: BusDepartureStop[] = tpl.map((t, i) => ({
    seq: i + 1,
    terminalId: `tm_${t.stateId}_${i}`,
    name: t.name,
    city: t.city,
    arriveOffsetMin: Math.round((i * gap) / 60_000),
    departOffsetMin: Math.round((i * gap) / 60_000) + (i === 0 ? 0 : 15),
    canBoard: t.canBoard,
    canAlight: t.canAlight,
  }));
  const base = (7_500 + idx * 2_300 + (hash(depId) % 3) * 900) * 100;
  const layout = buildLayout(9, 4);
  const detail: MockDeparture = {
    departureId: depId,
    routeId: `rt_${fromStateId}_${toStateId}`,
    operator: op,
    vehicleClass: classes[idx % classes.length],
    boardingAt: new Date(departMs - 30 * 60_000).toISOString(),
    departureAt: departIso,
    stops,
    layout,
    occupancy: buildOccupancy(depId, layout),
    odFares: buildOdFares(stops, base),
    currency: 'NGN',
    _baseFareKobo: base,
    _stopsTemplate: tpl,
  };
  detailCache.set(depId, detail);
  return detail;
}

function searchDay(date: string, hourOffset: number): string {
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  return `${base}T${String(6 + hourOffset * 3).padStart(2, '0')}:30:00.000Z`;
}

function toSummary(d: MockDeparture, fromSeq: number, toSeq: number): BusDepartureSummary | null {
  const fare = fareForSegment(d.odFares, fromSeq, toSeq);
  if (fare == null) return null;
  const from = d.stops.find((s) => s.seq === fromSeq)!;
  const to = d.stops.find((s) => s.seq === toSeq)!;
  const avail = d.layout.cells.filter(
    (c) => seatStatusForSegment(c, d.occupancy, fromSeq, toSeq) === 'available',
  ).length;
  return {
    departureId: d.departureId,
    routeId: d.routeId,
    operator: d.operator,
    vehicleClass: d.vehicleClass,
    boardingAt: d.boardingAt,
    departureAt: d.departureAt,
    fromStop: { seq: from.seq, terminalId: from.terminalId, name: from.name, city: from.city },
    toStop: { seq: to.seq, terminalId: to.terminalId, name: to.name, city: to.city },
    seatsAvailable: avail,
    fareKobo: fare,
    currency: 'NGN',
    amenities: ['Air conditioned', 'USB charging', 'Luggage allowance'],
  };
}

export function mockSearchDepartures(params: BusV2SearchParams): BusSearchResult {
  const mk = (direction: 'outbound' | 'return', fromId: string, toId: string, date: string) => {
    const key = `${fromId}|${toId}|${date}`;
    return [0, 1, 2]
      .map((i) => buildDeparture(key, i, fromId, toId, searchDay(date, i), direction))
      .map((d) => toSummary(d, 1, d.stops[d.stops.length - 1].seq))
      .filter((x): x is BusDepartureSummary => x !== null);
  };
  const outbound = mk('outbound', params.fromStateId, params.toStateId, params.date);
  const returnLegs =
    params.tripType === 'return'
      ? mk('return', params.toStateId, params.fromStateId, params.returnDate ?? params.date)
      : [];
  return { outbound, returnLegs };
}

export function mockDepartureDetail(departureId: string): BusDepartureDetail {
  const d = detailCache.get(departureId);
  if (!d) {
    const e = new Error('Departure not found') as Error & { code?: string; status?: number };
    e.code = 'BOOKING_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  const { _baseFareKobo, _stopsTemplate, ...pub } = d;
  void _baseFareKobo;
  void _stopsTemplate;
  return pub;
}

// ─── Holds ──────────────────────────────────────────────────────────────────

const HOLD_TTL_MS = 10 * 60_000;
const holdStore = new Map<string, BusSeatHold>();

function conflictError(): Error {
  const e = new Error('One or more seats were just taken. Pick another seat.') as Error & {
    code?: string;
    status?: number;
  };
  e.code = 'SEAT_CONFLICT';
  e.status = 409;
  return e;
}

export function mockCreateHold(req: BusHoldInput): BusSeatHold {
  const d = detailCache.get(req.departureId);
  if (!d) throw conflictError();
  // Drop expired holds before checking conflicts.
  for (const [id, h] of holdStore) {
    if (h.expiresAt && Date.parse(h.expiresAt) < now()) holdStore.delete(id);
  }
  const heldOverlap = (seatId: string) =>
    [...holdStore.values()].some(
      (h) =>
        h.departureId === req.departureId &&
        h.seatIds.includes(seatId) &&
        segmentsOverlap(h.fromSeq, h.toSeq, req.fromSeq, req.toSeq),
    );
  for (const seatId of req.seatIds) {
    const cell = d.layout.cells.find((c) => c.seatId === seatId);
    if (!cell || seatStatusForSegment(cell, d.occupancy, req.fromSeq, req.toSeq) !== 'available' || heldOverlap(seatId)) {
      throw conflictError();
    }
  }
  const hold: BusSeatHold = {
    holdId: `hold_${now()}_${Math.random().toString(36).slice(2, 8)}`,
    departureId: req.departureId,
    seatIds: [...req.seatIds],
    fromSeq: req.fromSeq,
    toSeq: req.toSeq,
    expiresAt: new Date(now() + HOLD_TTL_MS).toISOString(),
  };
  holdStore.set(hold.holdId, hold);
  return hold;
}

export function mockReleaseHold(holdId: string): void {
  holdStore.delete(holdId);
}

// ─── Bookings + tickets ─────────────────────────────────────────────────────

export const busV2Store: { bookings: BusBookingDetail[] } = { bookings: [] };

export function mockCreateBooking(
  req: { holdId: string; legs: BusBookLegInput[]; passengers: BusBookPassengerInput[] },
): BusBooking {
  const legs = req.legs;
  const lines: { label: string; amountKobo: Kobo }[] = [];
  let total = 0;
  const tickets: BusV2Ticket[] = [];
  const bookingRef = `PMX-B${String(now()).slice(-8)}`;

  legs.forEach((leg, li) => {
    const d = detailCache.get(leg.departureId);
    const hold = holdStore.get(leg.holdId);
    if (!d || !hold || hold.departureId !== leg.departureId) {
      const e = new Error('Your seat hold has expired. Please pick your seats again.') as Error & {
        code?: string;
        status?: number;
      };
      e.code = 'HOLD_EXPIRED';
      e.status = 410;
      throw e;
    }
    const fare = fareForSegment(d.odFares, leg.fromSeq, leg.toSeq) ?? d._baseFareKobo;
    const seatLabels = leg.seatIds
      .map((id) => d.layout.cells.find((c) => c.seatId === id)?.label ?? id);
    lines.push({
      label: `${li === 0 ? 'Outbound' : 'Return'} · ${seatLabels.length} seat${seatLabels.length === 1 ? '' : 's'} (${seatLabels.join(', ')})`,
      amountKobo: fare * leg.seatIds.length,
    });
    total += fare * leg.seatIds.length;

    leg.seatIds.forEach((seatId, si) => {
      const pax = req.passengers[si] ?? req.passengers[0];
      const cell = d.layout.cells.find((c) => c.seatId === seatId);
      const from = d.stops.find((s) => s.seq === leg.fromSeq);
      const to = d.stops.find((s) => s.seq === leg.toSeq);
      tickets.push({
        ticketToken: `pmx_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
        bookingRef,
        departureId: leg.departureId,
        legIndex: li,
        seatLabel: cell?.label ?? seatId,
        passengerName: pax?.name ?? 'Passenger',
        routeLabel: `${from?.name ?? ''} → ${to?.name ?? ''}`,
        operatorName: d.operator.name,
        fromTerminal: from?.name ?? '',
        toTerminal: to?.name ?? '',
        boardingAt: d.boardingAt,
        departureAt: new Date(Date.parse(d.departureAt) + (from?.departOffsetMin ?? 0) * 60_000).toISOString(),
        fareKobo: fare,
      });
      // Occupied once booked — a later hold/search sees the seat taken here.
      d.occupancy.push({ seatId, fromSeq: leg.fromSeq, toSeq: leg.toSeq, kind: 'booked' });
    });
    holdStore.delete(leg.holdId);
  });

  const detail: BusBookingDetail = {
    bookingRef,
    status: 'pending_payment',
    createdAt: iso(),
    quote: { currency: 'NGN', lines, totalKobo: total },
    tickets,
    cancelPolicy: {
      cancellable: true,
      deadline: tickets[0] ? new Date(Date.parse(tickets[0].departureAt) - 2 * 3_600_000).toISOString() : null,
      cutoffMinutes: 120,
      refundPercent: 80,
      feeKobo: 500_00,
      note: null,
    },
    routeLabel: tickets[0]?.routeLabel ?? 'Bus booking',
    operatorName: tickets[0]?.operatorName ?? '',
    boardingAt: tickets[0]?.boardingAt ?? null,
    departureAt: tickets[0]?.departureAt ?? '',
  };
  busV2Store.bookings.unshift(detail);
  return { bookingRef, status: detail.status, quote: detail.quote, createdAt: detail.createdAt };
}

export function mockInitiatePaystack(bookingRef: string): { authorizationUrl: string; reference: string } {
  const b = busV2Store.bookings.find((x) => x.bookingRef === bookingRef);
  if (!b) {
    const e = new Error('Booking not found') as Error & { code?: string; status?: number };
    e.code = 'BOOKING_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  // In mock mode the "webhook" lands instantly: mark tickets issued so a
  // completed checkout (or a re-opened booking) resolves to real tickets.
  b.status = 'issued';
  for (const t of b.tickets) t.status = 'issued';
  return {
    authorizationUrl: `https://checkout.paystack.com/mock_${bookingRef}`,
    reference: `pmx_bus_${bookingRef}`,
  };
}

function toSummaryRow(b: BusBookingDetail): BusBookingSummary {
  return {
    bookingRef: b.bookingRef,
    status: b.status,
    routeLabel: b.routeLabel,
    operatorName: b.operatorName,
    boardingAt: b.boardingAt,
    departureAt: b.departureAt,
    seatLabels: b.tickets.map((t) => t.seatLabel),
    passengerCount: new Set(b.tickets.map((t) => t.passengerName)).size,
    totalKobo: b.quote?.totalKobo ?? b.tickets.reduce((s, t) => s + t.fareKobo, 0),
    currency: 'NGN',
  };
}

/** One always-present fixture booking so the tickets tab/detail has content. */
function seededBooking(): BusBookingDetail {
  return {
    bookingRef: 'PMX-SEED01',
    status: 'issued',
    createdAt: iso(86_400_000 * 2),
    quote: { currency: 'NGN', lines: [{ label: 'Outbound · 1 seat (A3)', amountKobo: 4_200_00 }], totalKobo: 4_200_00 },
    tickets: [
      {
        ticketToken: 'pmx_seedticket9f27ab',
        status: 'issued',
        bookingRef: 'PMX-SEED01',
        departureId: 'dep_seed',
        legIndex: 0,
        seatLabel: 'A3',
        passengerName: 'Tunde Bello',
        routeLabel: 'Lagos Central Terminal → Abuja (FCT) Gateway Terminal',
        operatorName: 'ABC Transport',
        fromTerminal: 'Lagos Central Terminal',
        toTerminal: 'Abuja (FCT) Gateway Terminal',
        boardingAt: isoAhead(24 * 3_600_000 - 30 * 60_000),
        departureAt: isoAhead(24 * 3_600_000),
        fareKobo: 4_200_00,
      },
    ],
    cancelPolicy: { cancellable: true, deadline: isoAhead(22 * 3_600_000), cutoffMinutes: 120, refundPercent: 80, feeKobo: 500_00, note: null },
    routeLabel: 'Lagos Central Terminal → Abuja (FCT) Gateway Terminal',
    operatorName: 'ABC Transport',
    boardingAt: isoAhead(24 * 3_600_000 - 30 * 60_000),
    departureAt: isoAhead(24 * 3_600_000),
  };
}

// Seed one issued booking at module load so ticket list/detail/cancel are
// exercisable — and mutations (cancel request) persist like a real store.
busV2Store.bookings.push(seededBooking());

export function mockListBookings(): BusBookingSummary[] {
  return busV2Store.bookings
    .map(toSummaryRow)
    .sort((a, b) => +new Date(b.departureAt) - +new Date(a.departureAt));
}

export function mockBookingDetail(bookingRef: string): BusBookingDetail {
  const detail = busV2Store.bookings.find((x) => x.bookingRef === bookingRef);
  if (!detail) {
    const e = new Error('Booking not found') as Error & { code?: string; status?: number };
    e.code = 'BOOKING_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  // Cancel window closes at the deadline — keep the fixture honest.
  if (detail.cancelPolicy.deadline && Date.parse(detail.cancelPolicy.deadline) < now()) {
    detail.cancelPolicy = { ...detail.cancelPolicy, cancellable: false };
  }
  return detail;
}

export function mockRequestCancellation(bookingRef: string): { status: BusBookingStatus; ticketStatus: BusTicketStatus; message: string } {
  const b = mockBookingDetail(bookingRef);
  if (!b.cancelPolicy.cancellable) {
    const e = new Error('The cancellation window for this trip has closed.') as Error & { code?: string; status?: number };
    e.code = 'CANCEL_WINDOW_CLOSED';
    e.status = 409;
    throw e;
  }
  b.status = 'cancel_requested';
  for (const t of b.tickets) t.status = 'cancel_requested';
  return {
    status: 'cancel_requested',
    ticketStatus: 'cancel_requested',
    message: 'Cancellation requested. The operator will confirm your refund shortly.',
  };
}
