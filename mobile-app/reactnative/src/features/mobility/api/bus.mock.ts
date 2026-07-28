// ── Bus booking — mock seed data ─────────────────────────────────────────────
// All money is integer kobo. Fares are server-owned (admin-approved); the client
// only displays them.

import type {
  BusRoute,
  BusSchedule,
  BusSeatMap,
  BusSeat,
  BusTicket,
  BusBookRequest,
} from '../types/modes.types';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const isoAhead = (ms: number) => new Date(now() + ms).toISOString();

const ROUTES: BusRoute[] = [
  { id: 'rt_1', origin: 'Lagos',  originTerminal: 'Jibowu Terminal',  dest: 'Abuja',   destTerminal: 'Utako Terminal',  operatorName: 'GIG Mobility',  operatorRating: 4.7, durationS: 36_000, fromKobo: 18_500_00, currency: 'NGN' },
  { id: 'rt_2', origin: 'Lagos',  originTerminal: 'Ojota Terminal',   dest: 'Ibadan',  destTerminal: 'Challenge Park',  operatorName: 'ABC Transport', operatorRating: 4.5, durationS: 9_000,  fromKobo: 4_200_00,  currency: 'NGN' },
  { id: 'rt_3', origin: 'Lagos',  originTerminal: 'Jibowu Terminal',  dest: 'Benin',   destTerminal: 'Ramat Park',     operatorName: 'God is Good',   operatorRating: 4.6, durationS: 18_000, fromKobo: 9_800_00,  currency: 'NGN' },
];

export function mockBusRoutes(origin?: string, dest?: string): BusRoute[] {
  return ROUTES.filter((r) =>
    (!origin || r.origin.toLowerCase().includes(origin.toLowerCase())) &&
    (!dest || r.dest.toLowerCase().includes(dest.toLowerCase())),
  );
}

export function mockBusSchedules(routeId: string): BusSchedule[] {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) return [];
  const mk = (offsetH: number, busType: string, fareKobo: number, seatsLeft: number, total: number): BusSchedule => ({
    id: `sch_${routeId}_${offsetH}`,
    routeId,
    departAt: isoAhead(offsetH * 3_600_000),
    arriveAt: isoAhead(offsetH * 3_600_000 + route.durationS * 1000),
    operatorName: route.operatorName,
    busType,
    fareKobo,
    seatsLeft,
    totalSeats: total,
    currency: 'NGN',
  });
  return [
    mk(6,  '18-seater Coaster', route.fromKobo, 11, 18),
    mk(9,  'Luxury 30-seater',  route.fromKobo + 3_000_00, 24, 30),
    mk(13, '18-seater Coaster', route.fromKobo, 2, 18),
  ];
}

export function mockSeatMap(scheduleId: string): BusSeatMap {
  const schedule = mockBusSchedulesById(scheduleId);
  const total = schedule?.totalSeats ?? 18;
  const fareKobo = schedule?.fareKobo ?? 18_500_00;
  const rows = Math.ceil(total / 4);
  const seats: BusSeat[] = [];
  const letters = ['A', 'B', 'C', 'D'];
  let count = 0;
  for (let r = 1; r <= rows && count < total; r++) {
    for (let c = 0; c < 4 && count < total; c++) {
      const number = `${letters[c]}${r}`;
      // deterministic "taken" pattern so the empty/full mix is stable
      const available = !((r + c) % 3 === 0);
      seats.push({ number, available });
      count++;
    }
  }
  return { scheduleId, columns: 4, seats, fareKobo, currency: 'NGN' };
}

function mockBusSchedulesById(scheduleId: string): BusSchedule | undefined {
  // schedule id encodes the route — recompute to find the fare/type
  const parts = scheduleId.split('_'); // sch, rt, 1, 6
  const routeId = `${parts[1]}_${parts[2]}`;
  return mockBusSchedules(routeId).find((s) => s.id === scheduleId);
}

export const busTicketStore: { tickets: BusTicket[] } = {
  tickets: [
    {
      id: 'tkt_h1', phase: 'completed', routeLabel: 'Lagos → Ibadan',
      originTerminal: 'Ojota Terminal', destTerminal: 'Challenge Park', operatorName: 'ABC Transport',
      departAt: iso(86_400_000 * 5), arriveAt: iso(86_400_000 * 5 - 9_000_000),
      seatNumber: 'B3', passengerName: 'Tunde Bello', fareKobo: 4_200_00, currency: 'NGN',
      qrCode: 'PMX-BUS-tkt_h1', paymentStatus: 'settled', createdAt: iso(86_400_000 * 6),
    },
  ],
};

export function makeBusTicket(req: BusBookRequest): BusTicket {
  const schedule = mockBusSchedulesById(req.scheduleId);
  const route = schedule ? ROUTES.find((r) => r.id === schedule.routeId) : undefined;
  const id = `tkt_${now()}`;
  return {
    id,
    phase: 'issued',
    routeLabel: route ? `${route.origin} → ${route.dest}` : 'Lagos → Abuja',
    originTerminal: route?.originTerminal ?? 'Jibowu Terminal',
    destTerminal: route?.destTerminal ?? 'Utako Terminal',
    operatorName: schedule?.operatorName ?? 'GIG Mobility',
    departAt: schedule?.departAt ?? isoAhead(6 * 3_600_000),
    arriveAt: schedule?.arriveAt ?? isoAhead(6 * 3_600_000 + 36_000_000),
    seatNumber: req.seatNumber,
    passengerName: req.passengerName,
    fareKobo: schedule?.fareKobo ?? 18_500_00,
    currency: 'NGN',
    qrCode: `PMX-BUS-${id}`,
    paymentStatus: 'settled',
    createdAt: iso(),
  };
}
