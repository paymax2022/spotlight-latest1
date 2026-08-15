// ── Admin — Paymax Mobility Event Transport service ──────────────────────────
// Event transport offers · bookings. Mock-backed (Go backend admin endpoints not
// live yet). Mirrors mobilityModesAdminService: flip USE_MOCK to false and the
// fetch branches hit /api/finance/admin/transport/events/* per
// BUILD-CONTRACT-LOGISTICS-EVENT.
// All money is integer minor units (kobo). Every mutation is server-audited.

import { env } from '@/config/env';
import type {
  EventOfferRow, EventOfferStatus,
  EventBookingRow, EventBookingStatus,
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

// ─── Mock datasets ────────────────────────────────────────────────────────────

let OFFERS: EventOfferRow[] = [
  { id: 'evo_1001', eventId: 'evt_5001', organizerName: 'Spotlight Live Events', type: 'fan_bus', title: 'Burna Boy Concert — Fan Bus (Mainland)', venue: 'Eko Convention Centre, VI', capacity: 50, bookedCount: 50, fareKobo: 5_000_00, departureTime: '2026-06-25T16:00:00Z', busScheduleId: 'sch_1', status: 'full', createdAt: '2026-06-10T09:00:00Z', updatedAt: '2026-06-21T10:00:00Z' },
  { id: 'evo_1002', eventId: 'evt_5001', organizerName: 'Spotlight Live Events', type: 'group_ride', title: 'Burna Boy Concert — Group Ride (Lekki)', venue: 'Eko Convention Centre, VI', capacity: 6, bookedCount: 3, fareKobo: 8_000_00, departureTime: '2026-06-25T17:00:00Z', busScheduleId: null, status: 'open', createdAt: '2026-06-11T09:00:00Z', updatedAt: '2026-06-20T14:00:00Z' },
  { id: 'evo_1003', eventId: 'evt_5002', organizerName: 'AfroNation NG', type: 'shuttle', title: 'AfroNation Lagos — Airport Shuttle', venue: 'Tarkwa Bay', capacity: 30, bookedCount: 12, fareKobo: 3_500_00, departureTime: '2026-07-02T10:00:00Z', busScheduleId: null, status: 'open', createdAt: '2026-06-12T09:00:00Z', updatedAt: '2026-06-19T11:00:00Z' },
  { id: 'evo_1004', eventId: 'evt_5001', organizerName: 'Spotlight Live Events', type: 'artist', title: 'Artist Convoy — VIP Transfer', venue: 'Eko Convention Centre, VI', capacity: 4, bookedCount: 4, fareKobo: 80_000_00, departureTime: '2026-06-25T14:00:00Z', busScheduleId: null, status: 'departed', createdAt: '2026-06-09T09:00:00Z', updatedAt: '2026-06-25T14:05:00Z' },
  { id: 'evo_0990', eventId: 'evt_4990', organizerName: 'Lagos Theatre Co', type: 'crew', title: 'Stage Crew Transport', venue: 'Terra Kulture', capacity: 12, bookedCount: 0, fareKobo: 4_000_00, departureTime: '2026-06-30T07:00:00Z', busScheduleId: null, status: 'draft', createdAt: '2026-06-18T09:00:00Z', updatedAt: '2026-06-18T09:00:00Z' },
];

let BOOKINGS: EventBookingRow[] = [
  { id: 'evb_2001', offerId: 'evo_1001', offerTitle: 'Burna Boy Concert — Fan Bus (Mainland)', riderName: 'Ada U.', type: 'fan_bus', seats: 2, fareKobo: 5_000_00, totalKobo: 10_000_00, ticketRef: 'TKT-BURNA-4412', status: 'confirmed', escrowStatus: 'held', bookedAt: '2026-06-15T10:00:00Z' },
  { id: 'evb_2002', offerId: 'evo_1002', offerTitle: 'Burna Boy Concert — Group Ride (Lekki)', riderName: 'Chika O.', type: 'group_ride', seats: 1, fareKobo: 8_000_00, totalKobo: 8_000_00, ticketRef: null, status: 'booked', escrowStatus: 'held', bookedAt: '2026-06-18T12:00:00Z' },
  { id: 'evb_2003', offerId: 'evo_1004', offerTitle: 'Artist Convoy — VIP Transfer', riderName: 'Tola A.', type: 'artist', seats: 4, fareKobo: 80_000_00, totalKobo: 320_000_00, ticketRef: 'TKT-VIP-0001', status: 'boarded', escrowStatus: 'held', bookedAt: '2026-06-14T09:00:00Z' },
  { id: 'evb_2004', offerId: 'evo_1003', offerTitle: 'AfroNation Lagos — Airport Shuttle', riderName: 'Ife N.', type: 'shuttle', seats: 1, fareKobo: 3_500_00, totalKobo: 3_500_00, ticketRef: 'TKT-AFRO-7781', status: 'completed', escrowStatus: 'released', bookedAt: '2026-06-13T15:00:00Z' },
  { id: 'evb_2005', offerId: 'evo_1001', offerTitle: 'Burna Boy Concert — Fan Bus (Mainland)', riderName: 'Bayo L.', type: 'fan_bus', seats: 1, fareKobo: 5_000_00, totalKobo: 5_000_00, ticketRef: null, status: 'refunded', escrowStatus: 'refunded', bookedAt: '2026-06-16T11:00:00Z' },
];

// ─── Offers ───────────────────────────────────────────────────────────────────
export async function getEventOffers(status?: EventOfferStatus | ''): Promise<EventOfferRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...OFFERS];
    if (status) list = list.filter((o) => o.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/events/offers${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setEventOfferStatus(id: string, patch: ModeStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(400);
    OFFERS = OFFERS.map((o) => (o.id === id ? { ...o, status: patch.status as EventOfferStatus, updatedAt: new Date().toISOString() } : o));
    return { ok: true };
  }
  await fetch(`${adminBase()}/events/offers/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
  return { ok: true };
}

// ─── Bookings (read-only) ─────────────────────────────────────────────────────
export async function getEventBookings(status?: EventBookingStatus | ''): Promise<EventBookingRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...BOOKINGS];
    if (status) list = list.filter((b) => b.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/events/bookings${q}`, { headers: authHeaders() });
  return res.json();
}
