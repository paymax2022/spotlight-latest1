// ── Admin — Paymax Mobility multi-modal service ──────────────────────────────
// Parcel · Bus · Towing · Movers · Car hire. Mock by default; flip USE_MOCK to
// false and the fetch branches hit /api/finance/admin/transport/{parcels,couriers,
// bus,towing,movers,car-hire}. Most of this surface IS live — registered under
// backend/internal/app/finance_routes.go's FeatureTransportModesEnabled block —
// the OLD "Go backend admin endpoints not live yet" claim here was stale; a few
// mutations genuinely have no backend action yet, and each says so on its own
// throw rather than in this header.
// All money is integer minor units (kobo). Every mutation is server-audited.

import { env } from '@/config/env';
import type {
  ParcelRow, ParcelStatus, PodStatus, CourierRow,
  BusOperator, BusRoute, BusSchedule, BusManifestRow,
  TowingRow, TowingStatus,
  MoverRow, MoverDetail, MoverStatus,
  CarHireRow, CarHireStatus,
  ModeStatusPatch,
} from '@/types/mobilityModes';

// Mock by default; flip with NEXT_PUBLIC_MOBILITY_MODES_USE_MOCK=false once the
// admin control-plane endpoints are live on the Go backend.
const USE_MOCK = (process.env.NEXT_PUBLIC_MOBILITY_MODES_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  // env.apiBaseUrl defaults to .../api/v1 ; admin transport lives under /api/finance/admin/transport
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin/transport');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Unlike this file's own header comment ("Go backend admin endpoints not live
// yet"), most of these routes ARE live — registered under
// backend/internal/app/finance_routes.go's FeatureTransportModesEnabled block
// (adminTr.PATCH("/parcels/:id/status", ...) etc.). But every "live" branch
// below shared the same bug as fxAdminService.ts once had: they call
// fetch(...) and then unconditionally return { ok: true }, discarding the
// response and its status code, so a 404 (or a wrong URL, which several of
// these had — see per-function comments) was reported as success too. Both
// the fixture-mode fabrication and the live-mode one are fixed here. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_MOBILITY_MODES_USE_MOCK=false to make this change against the live backend.';
const NO_BACKEND_YET =
  'has no backend yet (see the comment on the live-mode call below). ' +
  'This console cannot perform this action until that endpoint is built.';
async function writeOk(url: string, init: RequestInit): Promise<{ ok: boolean }> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  }
  return { ok: true };
}

// ─── Mock datasets ────────────────────────────────────────────────────────────

const PARCELS: ParcelRow[] = [
  { id: 'pcl_3001', senderName: 'Ngozi A.', courierName: 'Tunde Adeyemi', courierId: 'drv_1003', status: 'in_transit', category: 'documents', size: 'small', speed: 'express', pickupAddress: 'Victoria Island', dropoffAddress: 'Lekki Phase 1', zone: 'Lagos Island', fareKobo: 1_800_00, declaredValueKobo: 50_000_00, podStatus: 'pending', podProofUrl: null, escrowStatus: 'held', createdAt: '2026-06-20T10:00:00Z', updatedAt: '2026-06-20T10:25:00Z' },
  { id: 'pcl_3002', senderName: 'Bola I.', courierName: 'Ibrahim S.', courierId: 'drv_2012', status: 'dropoff_verified', category: 'electronics', size: 'medium', speed: 'standard', pickupAddress: 'Ikeja GRA', dropoffAddress: 'Maryland', zone: 'Ikeja', fareKobo: 2_400_00, declaredValueKobo: 180_000_00, podStatus: 'submitted', podProofUrl: '#', escrowStatus: 'held', createdAt: '2026-06-20T09:10:00Z', updatedAt: '2026-06-20T10:40:00Z' },
  { id: 'pcl_3003', senderName: 'Sola M.', courierName: null, courierId: null, status: 'created', category: 'parcel', size: 'large', speed: 'standard', pickupAddress: 'Surulere', dropoffAddress: 'Yaba', zone: 'Surulere', fareKobo: 3_100_00, declaredValueKobo: 30_000_00, podStatus: 'pending', podProofUrl: null, escrowStatus: 'held', createdAt: '2026-06-20T11:00:00Z', updatedAt: '2026-06-20T11:00:00Z' },
  { id: 'pcl_2990', senderName: 'Kemi T.', courierName: 'Grace E.', courierId: 'drv_2011', status: 'delivered', category: 'documents', size: 'small', speed: 'express', pickupAddress: 'Lekki', dropoffAddress: 'Ajah', zone: 'Lekki', fareKobo: 1_500_00, declaredValueKobo: 10_000_00, podStatus: 'approved', podProofUrl: '#', escrowStatus: 'released', createdAt: '2026-06-19T15:00:00Z', updatedAt: '2026-06-19T16:05:00Z' },
  { id: 'pcl_2985', senderName: 'David N.', courierName: 'Femi K.', courierId: 'drv_2010', status: 'disputed', category: 'fragile', size: 'medium', speed: 'standard', pickupAddress: 'Yaba', dropoffAddress: 'Surulere', zone: 'Yaba', fareKobo: 2_000_00, declaredValueKobo: 75_000_00, podStatus: 'rejected', podProofUrl: '#', escrowStatus: 'held', createdAt: '2026-06-19T12:00:00Z', updatedAt: '2026-06-19T14:30:00Z' },
];

const COURIERS: CourierRow[] = [
  { id: 'drv_1003', name: 'Tunde Adeyemi', phone: '+2348034567890', zone: 'Lagos Island', status: 'active', rating: 4.8, activeParcels: 1, completedParcels: 412 },
  { id: 'drv_2012', name: 'Ibrahim S.', phone: '+2348044567811', zone: 'Lekki', status: 'active', rating: 4.7, activeParcels: 1, completedParcels: 188 },
  { id: 'drv_2011', name: 'Grace E.', phone: '+2348044567822', zone: 'Ikeja', status: 'active', rating: 4.9, activeParcels: 0, completedParcels: 256 },
  { id: 'drv_2010', name: 'Femi K.', phone: '+2348044567833', zone: 'Yaba', status: 'suspended', rating: 4.1, activeParcels: 0, completedParcels: 97 },
];

const BUS_OPERATORS: BusOperator[] = [
  { id: 'bop_1', businessName: 'GreenLine Express', ownerUserId: 'usr_9001', baseState: 'Lagos', verificationStatus: 'verified', verified: true, status: 'active', ratingAvg: 4.6, ratingCount: 312, routeCount: 6, createdAt: '2026-05-01T10:00:00Z' },
  { id: 'bop_2', businessName: 'CityHopper Transit', ownerUserId: 'usr_9002', baseState: 'Lagos', verificationStatus: 'pending', verified: false, status: 'active', ratingAvg: 4.2, ratingCount: 88, routeCount: 4, createdAt: '2026-06-10T10:00:00Z' },
  { id: 'bop_3', businessName: 'Naija Coaches', ownerUserId: 'usr_9003', baseState: 'Oyo', verificationStatus: 'suspended', verified: false, status: 'inactive', ratingAvg: 3.4, ratingCount: 41, routeCount: 2, createdAt: '2026-04-18T10:00:00Z' },
];

const BUS_ROUTES: BusRoute[] = [
  { id: 'rte_1', operatorId: 'bop_1', operatorName: 'GreenLine Express', origin: 'Yaba', destination: 'Lekki', fareKobo: 1_200_00, fareApproved: true, active: true },
  { id: 'rte_2', operatorId: 'bop_1', operatorName: 'GreenLine Express', origin: 'Ikeja', destination: 'Victoria Island', fareKobo: 1_800_00, fareApproved: false, active: true },
  { id: 'rte_3', operatorId: 'bop_2', operatorName: 'CityHopper Transit', origin: 'Surulere', destination: 'Ajah', fareKobo: 2_000_00, fareApproved: true, active: true },
];

const BUS_SCHEDULES: BusSchedule[] = [
  { id: 'sch_1', routeId: 'rte_1', routeLabel: 'Yaba → Lekki', operatorName: 'GreenLine Express', departAt: '2026-06-22T07:30:00Z', fareKobo: 1_200_00, fareApproved: true, seatsTotal: 30, seatsBooked: 22, status: 'scheduled' },
  { id: 'sch_2', routeId: 'rte_2', routeLabel: 'Ikeja → Victoria Island', operatorName: 'GreenLine Express', departAt: '2026-06-22T08:00:00Z', fareKobo: 1_800_00, fareApproved: false, seatsTotal: 30, seatsBooked: 5, status: 'scheduled' },
  { id: 'sch_3', routeId: 'rte_3', routeLabel: 'Surulere → Ajah', operatorName: 'CityHopper Transit', departAt: '2026-06-21T18:00:00Z', fareKobo: 2_000_00, fareApproved: true, seatsTotal: 24, seatsBooked: 24, status: 'boarding' },
];

const BUS_MANIFEST: Record<string, BusManifestRow[]> = {
  sch_1: [
    { ticketId: 'tkt_11', passengerName: 'Ada U.', seatNumber: 'A1', status: 'issued', fareKobo: 1_200_00, bookedAt: '2026-06-20T09:00:00Z' },
    { ticketId: 'tkt_12', passengerName: 'Chika O.', seatNumber: 'A2', status: 'issued', fareKobo: 1_200_00, bookedAt: '2026-06-20T09:10:00Z' },
    { ticketId: 'tkt_13', passengerName: 'Bayo L.', seatNumber: 'B1', status: 'cancelled', fareKobo: 1_200_00, bookedAt: '2026-06-20T09:20:00Z' },
  ],
  sch_3: [
    { ticketId: 'tkt_31', passengerName: 'Tola A.', seatNumber: 'C4', status: 'boarded', fareKobo: 2_000_00, bookedAt: '2026-06-21T08:00:00Z' },
    { ticketId: 'tkt_32', passengerName: 'Ife N.', seatNumber: 'C5', status: 'boarding', fareKobo: 2_000_00, bookedAt: '2026-06-21T08:05:00Z' },
  ],
};

const TOWING: TowingRow[] = [
  { id: 'tow_4001', customerName: 'Emeka O.', operatorName: 'RapidTow Lagos', operatorId: 'drv_3001', status: 'in_progress', serviceType: 'flatbed', pickupAddress: 'Third Mainland Bridge', destAddress: 'Mechanic Village Ikeja', zone: 'Ikeja', calloutKobo: 5_000_00, fareKobo: 12_500_00, escrowStatus: 'held', createdAt: '2026-06-20T09:00:00Z', updatedAt: '2026-06-20T10:00:00Z' },
  { id: 'tow_4002', customerName: 'Aisha B.', operatorName: null, operatorId: null, status: 'requested', serviceType: 'wheel_lift', pickupAddress: 'Lekki Toll', destAddress: 'Ajah', zone: 'Lekki', calloutKobo: 5_000_00, fareKobo: 8_000_00, escrowStatus: 'held', createdAt: '2026-06-20T11:00:00Z', updatedAt: '2026-06-20T11:00:00Z' },
  { id: 'tow_3990', customerName: 'Chidi N.', operatorName: 'RapidTow Lagos', operatorId: 'drv_3001', status: 'completed', serviceType: 'flatbed', pickupAddress: 'Victoria Island', destAddress: 'Surulere', zone: 'Lagos Island', calloutKobo: 5_000_00, fareKobo: 15_000_00, escrowStatus: 'released', createdAt: '2026-06-19T14:00:00Z', updatedAt: '2026-06-19T16:00:00Z' },
];

const MOVERS: MoverDetail[] = [
  {
    id: 'mov_5001', customerName: 'Ngozi A.', status: 'bids_received', pickupAddress: 'Lekki Phase 1', dropoffAddress: 'Ikoyi', truckSize: 'large', helpers: 3, moveAt: '2026-06-25T08:00:00Z', acceptedAmountKobo: null, escrowStatus: 'none', bidsCount: 2, createdAt: '2026-06-20T10:00:00Z', updatedAt: '2026-06-20T12:00:00Z',
    inventory: '3-bedroom flat: sofas, fridge, beds, ~40 boxes',
    bids: [
      { id: 'bid_1', moverName: 'SwiftMovers NG', moverId: 'drv_4001', amountKobo: 145_000_00, crewSize: 4, accepted: false, createdAt: '2026-06-20T11:00:00Z' },
      { id: 'bid_2', moverName: 'PackPro Logistics', moverId: 'drv_4002', amountKobo: 132_000_00, crewSize: 3, accepted: false, createdAt: '2026-06-20T11:30:00Z' },
    ],
  },
  {
    id: 'mov_5002', customerName: 'Bola I.', status: 'in_progress', pickupAddress: 'Yaba', dropoffAddress: 'Magodo', truckSize: 'medium', helpers: 2, moveAt: '2026-06-21T09:00:00Z', acceptedAmountKobo: 98_000_00, escrowStatus: 'held', bidsCount: 1, createdAt: '2026-06-19T10:00:00Z', updatedAt: '2026-06-21T09:30:00Z',
    inventory: '2-bedroom: wardrobe, washing machine, ~25 boxes',
    bids: [
      { id: 'bid_3', moverName: 'SwiftMovers NG', moverId: 'drv_4001', amountKobo: 98_000_00, crewSize: 3, accepted: true, createdAt: '2026-06-19T12:00:00Z' },
    ],
  },
  {
    id: 'mov_4990', customerName: 'Kemi T.', status: 'completion_confirmed', pickupAddress: 'Surulere', dropoffAddress: 'Gbagada', truckSize: 'small', helpers: 1, moveAt: '2026-06-18T08:00:00Z', acceptedAmountKobo: 55_000_00, escrowStatus: 'released', bidsCount: 3, createdAt: '2026-06-17T10:00:00Z', updatedAt: '2026-06-18T13:00:00Z',
    inventory: 'Studio: single bed, fridge, ~10 boxes',
    bids: [
      { id: 'bid_4', moverName: 'PackPro Logistics', moverId: 'drv_4002', amountKobo: 55_000_00, crewSize: 2, accepted: true, createdAt: '2026-06-17T12:00:00Z' },
    ],
  },
];

const CAR_HIRE: CarHireRow[] = [
  { id: 'car_6001', customerName: 'Tunde A.', driverName: 'James O.', driverId: 'drv_5001', status: 'active', hireType: 'with_driver', vehicleClass: 'suv', chauffeur: true, startAt: '2026-06-21T08:00:00Z', durationHours: 8, fareKobo: 60_000_00, depositKobo: 20_000_00, escrowStatus: 'held', zone: 'Lagos Island', createdAt: '2026-06-20T10:00:00Z', updatedAt: '2026-06-21T08:00:00Z' },
  { id: 'car_6002', customerName: 'Aisha B.', driverName: null, driverId: null, status: 'quoted', hireType: 'self_drive', vehicleClass: 'sedan', chauffeur: false, startAt: '2026-06-23T09:00:00Z', durationHours: 24, fareKobo: 45_000_00, depositKobo: 50_000_00, escrowStatus: 'none', zone: 'Lekki', createdAt: '2026-06-20T12:00:00Z', updatedAt: '2026-06-20T12:00:00Z' },
  { id: 'car_5990', customerName: 'Chidi N.', driverName: 'James O.', driverId: 'drv_5001', status: 'completed', hireType: 'with_driver', vehicleClass: 'luxury', chauffeur: true, startAt: '2026-06-18T07:00:00Z', durationHours: 10, fareKobo: 120_000_00, depositKobo: 30_000_00, escrowStatus: 'released', zone: 'Ikeja', createdAt: '2026-06-17T10:00:00Z', updatedAt: '2026-06-18T18:00:00Z' },
];

// ─── Parcels ──────────────────────────────────────────────────────────────────
export async function getParcels(status?: ParcelStatus | ''): Promise<ParcelRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...PARCELS];
    if (status) list = list.filter((p) => p.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/parcels${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setParcelStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting a parcel status ${NOT_IN_FIXTURE_MODE}`);
  // backend: PATCH /parcels/:id/status (transportAdmin.AdminParcelStatus).
  return writeOk(`${adminBase()}/parcels/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
}

export async function reviewParcelPod(id: string, decision: PodStatus, reason: string): Promise<{ ok: boolean }> {
  // No backend at all: the parcels admin surface only has AdminParcelStatus
  // (a general status PATCH) — no distinct proof-of-delivery review action
  // exists in backend/internal/app/finance_routes.go's parcels admin routes.
  if (USE_MOCK) throw new Error(`Reviewing a parcel proof of delivery ${NO_BACKEND_YET}`);
  return writeOk(`${adminBase()}/parcels/${id}/pod-review`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ decision, reason }) });
}

export async function getCouriers(): Promise<CourierRow[]> {
  if (USE_MOCK) { await delay(); return [...COURIERS]; }
  const res = await fetch(`${adminBase()}/couriers`, { headers: authHeaders() });
  return res.json();
}

// ─── Bus ────────────────────────────────────────────────────────────────────--
export async function getBusOperators(): Promise<BusOperator[]> {
  if (USE_MOCK) { await delay(); return [...BUS_OPERATORS]; }
  const res = await fetch(`${adminBase()}/bus/operators`, { headers: authHeaders() });
  const j = await res.json();
  return Array.isArray(j) ? j : (j.operators ?? []);
}

export async function setBusProviderVerification(
  id: string,
  status: 'verified' | 'suspended' | 'pending',
  reason: string,
): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting bus provider verification ${NOT_IN_FIXTURE_MODE}`);
  // backend: PATCH /bus/operators/:id/verification (transportAdmin.AdminBusSetProviderVerification).
  return writeOk(`${adminBase()}/bus/operators/${id}/verification`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status, reason }) });
}

export async function getBusRoutes(): Promise<BusRoute[]> {
  if (USE_MOCK) { await delay(); return [...BUS_ROUTES]; }
  const res = await fetch(`${adminBase()}/bus/routes`, { headers: authHeaders() });
  return res.json();
}

export async function approveBusRouteFare(id: string, reason: string): Promise<{ ok: boolean }> {
  // No backend at all: only schedule-level fare approval exists
  // (POST /bus/schedules/:id/approve-fare, transportAdmin.AdminBusApproveFare)
  // — there is no route-level equivalent in finance_routes.go's bus admin routes.
  if (USE_MOCK) throw new Error(`Approving a bus route fare ${NO_BACKEND_YET}`);
  return writeOk(`${adminBase()}/bus/routes/${id}/approve-fare`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ reason }) });
}

export async function getBusSchedules(): Promise<BusSchedule[]> {
  if (USE_MOCK) { await delay(); return [...BUS_SCHEDULES]; }
  const res = await fetch(`${adminBase()}/bus/schedules`, { headers: authHeaders() });
  return res.json();
}

export async function approveBusScheduleFare(id: string, reason: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Approving a bus schedule fare ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /bus/schedules/:id/approve-fare (transportAdmin.AdminBusApproveFare) —
  // the OLD method here was PATCH; the registered route is POST.
  return writeOk(`${adminBase()}/bus/schedules/${id}/approve-fare`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason }) });
}

export async function getBusManifest(scheduleId: string): Promise<BusManifestRow[]> {
  if (USE_MOCK) { await delay(); return BUS_MANIFEST[scheduleId] ?? []; }
  const res = await fetch(`${adminBase()}/bus/manifest?schedule_id=${encodeURIComponent(scheduleId)}`, { headers: authHeaders() });
  return res.json();
}

// ─── Towing ─────────────────────────────────────────────────────────────────--
export async function getTowingJobs(status?: TowingStatus | ''): Promise<TowingRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...TOWING];
    if (status) list = list.filter((t) => t.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/towing/jobs${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setTowingStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting a towing job status ${NOT_IN_FIXTURE_MODE}`);
  // backend: PATCH /towing/:id/status (transportAdmin.AdminTowingStatus) — the OLD
  // /towing/jobs/:id/status path here had an extra "jobs" segment that matched no route.
  return writeOk(`${adminBase()}/towing/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
}

// ─── Movers ───────────────────────────────────────────────────────────────────
export async function getMoverJobs(status?: MoverStatus | ''): Promise<MoverRow[]> {
  if (USE_MOCK) {
    await delay();
    let list: MoverRow[] = MOVERS.map(({ bids, inventory, ...r }) => r);
    if (status) list = list.filter((m) => m.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/movers/jobs${q}`, { headers: authHeaders() });
  return res.json();
}

export async function getMoverJob(id: string): Promise<MoverDetail> {
  if (USE_MOCK) {
    await delay();
    const m = MOVERS.find((x) => x.id === id);
    if (!m) throw new Error('Mover job not found');
    return m;
  }
  const res = await fetch(`${adminBase()}/movers/jobs/${id}`, { headers: authHeaders() });
  return res.json();
}

export async function setMoverStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting a mover job status ${NOT_IN_FIXTURE_MODE}`);
  // backend: PATCH /movers/:id/status (transportAdmin.AdminMoverStatus) — the OLD
  // /movers/jobs/:id/status path here had an extra "jobs" segment that matched no route.
  return writeOk(`${adminBase()}/movers/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
}

// ─── Car hire ─────────────────────────────────────────────────────────────────
export async function getCarHireBookings(status?: CarHireStatus | ''): Promise<CarHireRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...CAR_HIRE];
    if (status) list = list.filter((c) => c.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/car-hire/bookings${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setCarHireStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) throw new Error(`Setting a car-hire booking status ${NOT_IN_FIXTURE_MODE}`);
  // backend: PATCH /car-hire/:id/status (transportAdmin.AdminCarHireStatus) — the OLD
  // /car-hire/bookings/:id/status path here had an extra "bookings" segment that
  // matched no route.
  return writeOk(`${adminBase()}/car-hire/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
}
