// ── Admin — Paymax Transport Scheduled Bookings service ─────────────────────
// Mock-backed (Go backend admin endpoints confirmed live per
// SWARM_INTEGRATION_CONTRACT but this frontend ships mock-first, matching the
// house pattern in mobilityAdminService.ts / mobilityModesAdminService.ts).
// Flip NEXT_PUBLIC_SCHEDULED_ADMIN_USE_MOCK=false to hit the real Go backend:
// GET  /api/finance/admin/transport/scheduled
// GET  /api/finance/admin/transport/scheduled/:id
// POST /api/finance/admin/transport/scheduled/:id/force-dispatch  { reason_code }
// POST /api/finance/admin/transport/scheduled/:id/reassign        { reason_code, driver_id? }
// POST /api/finance/admin/transport/scheduled/:id/cancel          { reason_code }
// All money is integer minor units (kobo). Every mutation is server-audited
// and REQUIRES reason_code — enforced here (defense-in-depth) and in the UI.

import { env } from '@/config/env';
import type {
  ScheduledBookingRow, ScheduledBookingDetail, ScheduledFilter,
  ScheduledStatus, ScheduledMode,
  ScheduledReasonPayload, ScheduledReassignPayload,
} from '@/types/scheduledMobility';

// Mock by default; flip once the admin control-plane is wired to the Go backend.
const USE_MOCK = (process.env.NEXT_PUBLIC_SCHEDULED_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  // env.apiBaseUrl defaults to .../api/v1 ; scheduled admin ops live under
  // /api/finance/admin/transport/scheduled per SWARM_INTEGRATION_CONTRACT.
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin/transport') + '/scheduled';
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function requireReasonCode(reasonCode: string, action: string): string {
  const trimmed = (reasonCode ?? '').trim();
  if (!trimmed) throw new Error(`reason_code is required to ${action}.`);
  return trimmed;
}

// ─── Mock dataset ─────────────────────────────────────────────────────────────

let BOOKINGS: ScheduledBookingDetail[] = [
  {
    id: 'schd_8001', marketId: 'NG', userId: 'usr_4d8e', userName: 'Ngozi A.',
    mode: 'airport_pickup', status: 'failed_no_driver',
    scheduledPickupAt: '2026-07-04T09:30:00Z', leadTimeMinutes: 45, timezone: 'Africa/Lagos',
    pickupLabel: 'Murtala Muhammed Intl (MMIA) T1', dropoffLabel: 'Lekki Phase 1',
    estimatedFareKobo: 12_500_00, currency: 'NGN', dispatchAttempts: 3,
    lastDispatchError: 'No eligible airport-tier driver within 8km fallback window.',
    materializedRef: null, materializedKind: null,
    createdAt: '2026-07-02T08:00:00Z', updatedAt: '2026-07-04T08:52:00Z',
    pickupGeo: { lat: 6.5774, lng: 3.3212 }, dropoffGeo: { lat: 6.4474, lng: 3.4702 },
    modePayload: { flight_number: 'BA075', arrival_time: '2026-07-04T08:45:00Z', terminal: 'T1', vehicle_class: 'premium' },
    paymentMethod: 'wallet', settlementId: 'stl_7781',
    reminder24hSentAt: '2026-07-03T09:30:00Z', reminder1hSentAt: '2026-07-04T08:30:00Z',
    cancelReason: null, dispatchedAt: null, completedAt: null, cancelledAt: null,
    dispatchHistory: [
      { id: 'de_1', attempt: 1, outcome: 'failed', error: 'No driver matched within 5 min window.', createdAt: '2026-07-04T08:45:00Z' },
      { id: 'de_2', attempt: 2, outcome: 'failed', error: 'No driver matched within 5 min window.', createdAt: '2026-07-04T08:49:00Z' },
      { id: 'de_3', attempt: 3, outcome: 'failed', error: 'No eligible airport-tier driver within 8km fallback window.', createdAt: '2026-07-04T08:52:00Z' },
    ],
    auditLog: [],
  },
  {
    id: 'schd_8002', marketId: 'NG', userId: 'usr_1122', userName: 'Bola I.',
    mode: 'ride_hail', status: 'dispatch_pending',
    scheduledPickupAt: '2026-07-04T13:00:00Z', leadTimeMinutes: 30, timezone: 'Africa/Lagos',
    pickupLabel: 'Ikeja GRA', dropoffLabel: 'Victoria Island',
    estimatedFareKobo: 3_400_00, currency: 'NGN', dispatchAttempts: 1,
    lastDispatchError: null, materializedRef: null, materializedKind: null,
    createdAt: '2026-07-03T10:00:00Z', updatedAt: '2026-07-04T12:31:00Z',
    pickupGeo: { lat: 6.6018, lng: 3.3515 }, dropoffGeo: { lat: 6.4281, lng: 3.4219 },
    modePayload: { pricing_mode: 'standard', vehicle_class: 'standard' },
    paymentMethod: 'wallet', settlementId: null,
    reminder24hSentAt: '2026-07-03T13:00:00Z', reminder1hSentAt: null,
    cancelReason: null, dispatchedAt: null, completedAt: null, cancelledAt: null,
    dispatchHistory: [
      { id: 'de_4', attempt: 1, outcome: 'pending', error: null, createdAt: '2026-07-04T12:31:00Z' },
    ],
    auditLog: [],
  },
  {
    id: 'schd_8003', marketId: 'NG', userId: 'usr_3344', userName: 'Sola M.',
    mode: 'parcel_inter', status: 'scheduled',
    scheduledPickupAt: '2026-07-05T08:00:00Z', leadTimeMinutes: 60, timezone: 'Africa/Lagos',
    pickupLabel: 'Surulere', dropoffLabel: 'Abuja Central',
    estimatedFareKobo: 8_900_00, currency: 'NGN', dispatchAttempts: 0,
    lastDispatchError: null, materializedRef: null, materializedKind: null,
    createdAt: '2026-07-01T09:00:00Z', updatedAt: '2026-07-01T09:00:00Z',
    pickupGeo: { lat: 6.5027, lng: 3.3556 }, dropoffGeo: { lat: 9.0765, lng: 7.3986 },
    modePayload: { dims: { l: 40, w: 30, h: 20 }, weight_kg: 6.5, inter_state: true },
    paymentMethod: 'wallet', settlementId: null,
    reminder24hSentAt: null, reminder1hSentAt: null,
    cancelReason: null, dispatchedAt: null, completedAt: null, cancelledAt: null,
    dispatchHistory: [],
    auditLog: [],
  },
  {
    id: 'schd_8004', marketId: 'NG', userId: 'usr_8899', userName: 'Uche O.',
    mode: 'bus', status: 'dispatched',
    scheduledPickupAt: '2026-07-04T15:00:00Z', leadTimeMinutes: 120, timezone: 'Africa/Lagos',
    pickupLabel: 'Jibowu Bus Terminal', dropoffLabel: 'Ibadan Terminal',
    estimatedFareKobo: 6_500_00, currency: 'NGN', dispatchAttempts: 1,
    lastDispatchError: null, materializedRef: 'bkt_2201', materializedKind: 'bus_ticket',
    createdAt: '2026-06-29T12:00:00Z', updatedAt: '2026-07-04T13:00:05Z',
    pickupGeo: { lat: 6.5155, lng: 3.3730 }, dropoffGeo: { lat: 7.3775, lng: 3.9470 },
    modePayload: { schedule_id: 'bsc_551', seat_number: '14A' },
    paymentMethod: 'wallet', settlementId: 'stl_7790',
    reminder24hSentAt: '2026-07-03T15:00:00Z', reminder1hSentAt: '2026-07-04T14:00:00Z',
    cancelReason: null, dispatchedAt: '2026-07-04T13:00:05Z', completedAt: null, cancelledAt: null,
    dispatchHistory: [
      { id: 'de_5', attempt: 1, outcome: 'success', error: null, createdAt: '2026-07-04T13:00:05Z' },
    ],
    auditLog: [],
  },
  {
    id: 'schd_8005', marketId: 'NG', userId: 'usr_2b9e', userName: 'David N.',
    mode: 'ride_share', status: 'cancelled',
    scheduledPickupAt: '2026-07-03T07:00:00Z', leadTimeMinutes: 30, timezone: 'Africa/Lagos',
    pickupLabel: 'Yaba', dropoffLabel: 'Surulere',
    estimatedFareKobo: 1_800_00, currency: 'NGN', dispatchAttempts: 0,
    lastDispatchError: null, materializedRef: null, materializedKind: null,
    createdAt: '2026-07-01T07:00:00Z', updatedAt: '2026-07-02T18:00:00Z',
    pickupGeo: { lat: 6.5095, lng: 3.3711 }, dropoffGeo: { lat: 6.5027, lng: 3.3556 },
    modePayload: { pricing_mode: 'shared', vehicle_class: 'standard' },
    paymentMethod: 'wallet', settlementId: null,
    reminder24hSentAt: null, reminder1hSentAt: null,
    cancelReason: 'User requested cancellation — change of plans.',
    dispatchedAt: null, completedAt: null, cancelledAt: '2026-07-02T18:00:00Z',
    dispatchHistory: [],
    auditLog: [
      { id: 'aud_s1', action: 'scheduled.cancel', reasonCode: 'USER_REQUESTED', actor: 'usr_2b9e (self-service)', createdAt: '2026-07-02T18:00:00Z' },
    ],
  },
  {
    id: 'schd_8006', marketId: 'NG', userId: 'usr_5566', userName: 'Kemi T.',
    mode: 'ride_hail', status: 'expired',
    scheduledPickupAt: '2026-07-03T06:00:00Z', leadTimeMinutes: 20, timezone: 'Africa/Lagos',
    pickupLabel: 'Ajah', dropoffLabel: 'Lekki Phase 1',
    estimatedFareKobo: 2_100_00, currency: 'NGN', dispatchAttempts: 0,
    lastDispatchError: 'Safety-net expiry — pickup time passed with no dispatch attempt.',
    materializedRef: null, materializedKind: null,
    createdAt: '2026-07-01T06:00:00Z', updatedAt: '2026-07-03T06:05:00Z',
    pickupGeo: { lat: 6.4698, lng: 3.6013 }, dropoffGeo: { lat: 6.4474, lng: 3.4702 },
    modePayload: { pricing_mode: 'standard', vehicle_class: 'standard' },
    paymentMethod: 'wallet', settlementId: null,
    reminder24hSentAt: '2026-07-02T06:00:00Z', reminder1hSentAt: '2026-07-03T05:00:00Z',
    cancelReason: null, dispatchedAt: null, completedAt: null, cancelledAt: null,
    dispatchHistory: [],
    auditLog: [],
  },
  {
    id: 'schd_8007', marketId: 'NG', userId: 'usr_7712', userName: 'Femi K.',
    mode: 'ride_hail', status: 'completed',
    scheduledPickupAt: '2026-07-01T09:00:00Z', leadTimeMinutes: 30, timezone: 'Africa/Lagos',
    pickupLabel: 'Lekki Phase 1', dropoffLabel: 'Victoria Island',
    estimatedFareKobo: 2_800_00, currency: 'NGN', dispatchAttempts: 1,
    lastDispatchError: null, materializedRef: 'trp_5099', materializedKind: 'trip',
    createdAt: '2026-06-30T09:00:00Z', updatedAt: '2026-07-01T09:45:00Z',
    pickupGeo: { lat: 6.4474, lng: 3.4702 }, dropoffGeo: { lat: 6.4281, lng: 3.4219 },
    modePayload: { pricing_mode: 'standard', vehicle_class: 'comfort' },
    paymentMethod: 'wallet', settlementId: 'stl_7650',
    reminder24hSentAt: '2026-06-30T09:00:00Z', reminder1hSentAt: '2026-07-01T08:00:00Z',
    cancelReason: null, dispatchedAt: '2026-07-01T08:30:05Z', completedAt: '2026-07-01T09:45:00Z', cancelledAt: null,
    dispatchHistory: [
      { id: 'de_6', attempt: 1, outcome: 'success', error: null, createdAt: '2026-07-01T08:30:05Z' },
    ],
    auditLog: [],
  },
];

function pushAudit(id: string, action: string, reasonCode: string) {
  BOOKINGS = BOOKINGS.map((b) => (b.id === id
    ? { ...b, auditLog: [{ id: `aud_s_${Date.now()}`, action, reasonCode, actor: 'You (current admin)', createdAt: new Date().toISOString() }, ...b.auditLog] }
    : b));
}

function toRow(b: ScheduledBookingDetail): ScheduledBookingRow {
  const {
    pickupGeo: _pickupGeo, dropoffGeo: _dropoffGeo, modePayload: _modePayload, paymentMethod: _paymentMethod,
    settlementId: _settlementId, reminder24hSentAt: _r24, reminder1hSentAt: _r1h, cancelReason: _cancelReason,
    dispatchedAt: _dispatchedAt, completedAt: _completedAt, cancelledAt: _cancelledAt,
    dispatchHistory: _dispatchHistory, auditLog: _auditLog,
    ...row
  } = b;
  return row;
}

// Ops-board ordering: failed_no_driver first (oldest aging first), then the
// remaining active states by soonest pickup, terminal states last.
const STATUS_ORDER: Record<ScheduledStatus, number> = {
  failed_no_driver: 0,
  dispatch_pending: 1,
  scheduled: 2,
  dispatched: 3,
  completed: 4,
  cancelled: 5,
  expired: 6,
};

function sortOpsBoard(rows: ScheduledBookingRow[]): ScheduledBookingRow[] {
  return [...rows].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.status === 'failed_no_driver') {
      // Aging first = oldest updatedAt (longest stuck) surfaces first.
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    }
    return new Date(a.scheduledPickupAt).getTime() - new Date(b.scheduledPickupAt).getTime();
  });
}

// ─── Ops board ────────────────────────────────────────────────────────────────
export async function getScheduledBookings(filter: ScheduledFilter): Promise<ScheduledBookingRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = BOOKINGS.map(toRow);
    if (filter.status) list = list.filter((b) => b.status === filter.status);
    if (filter.mode) list = list.filter((b) => b.mode === filter.mode);
    if (filter.from) list = list.filter((b) => new Date(b.scheduledPickupAt) >= new Date(filter.from!));
    if (filter.to) list = list.filter((b) => new Date(b.scheduledPickupAt) <= new Date(filter.to!));
    return sortOpsBoard(list);
  }
  const q = new URLSearchParams();
  if (filter.status) q.set('status', filter.status);
  if (filter.mode) q.set('mode', filter.mode);
  if (filter.from) q.set('from', filter.from);
  if (filter.to) q.set('to', filter.to);
  const qs = q.toString();
  const res = await fetch(`${adminBase()}${qs ? `?${qs}` : ''}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Failed to load scheduled bookings (${res.status}).`);
  const data = await res.json();
  return sortOpsBoard(data);
}

// ─── Detail ───────────────────────────────────────────────────────────────────
export async function getScheduledBooking(id: string): Promise<ScheduledBookingDetail> {
  if (USE_MOCK) {
    await delay();
    const b = BOOKINGS.find((x) => x.id === id);
    if (!b) throw new Error('Scheduled booking not found');
    return b;
  }
  const res = await fetch(`${adminBase()}/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Failed to load booking (${res.status}).`);
  return res.json();
}

// ─── Mutations — reason_code is MANDATORY on every one (defense-in-depth: ─────
// throws client-side even if the modal's disabled-submit guard is bypassed).
export async function forceDispatchScheduled(id: string, payload: ScheduledReasonPayload): Promise<ScheduledBookingDetail> {
  const reasonCode = requireReasonCode(payload.reasonCode, 'force-dispatch a scheduled booking');
  if (USE_MOCK) {
    await delay(450);
    BOOKINGS = BOOKINGS.map((b) => (b.id === id
      ? {
        ...b, status: 'dispatched', dispatchAttempts: b.dispatchAttempts + 1, lastDispatchError: null,
        materializedRef: b.materializedRef ?? `trp_${Date.now()}`, materializedKind: b.materializedKind ?? 'trip',
        dispatchedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        dispatchHistory: [{ id: `de_${Date.now()}`, attempt: b.dispatchAttempts + 1, outcome: 'success', error: null, createdAt: new Date().toISOString() }, ...b.dispatchHistory],
      }
      : b));
    pushAudit(id, 'scheduled.force_dispatch', reasonCode);
    const b = BOOKINGS.find((x) => x.id === id);
    if (!b) throw new Error('Scheduled booking not found');
    return b;
  }
  const res = await fetch(`${adminBase()}/${id}/force-dispatch`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reasonCode }) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Force-dispatch failed (${res.status}).`);
  return res.json();
}

export async function reassignScheduled(id: string, payload: ScheduledReassignPayload): Promise<ScheduledBookingDetail> {
  const reasonCode = requireReasonCode(payload.reasonCode, 'reassign a scheduled booking');
  if (USE_MOCK) {
    await delay(450);
    BOOKINGS = BOOKINGS.map((b) => (b.id === id ? { ...b, updatedAt: new Date().toISOString() } : b));
    pushAudit(id, 'scheduled.reassign', reasonCode + (payload.driverId ? ` (driver=${payload.driverId})` : ''));
    const b = BOOKINGS.find((x) => x.id === id);
    if (!b) throw new Error('Scheduled booking not found');
    return b;
  }
  const res = await fetch(`${adminBase()}/${id}/reassign`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason_code: reasonCode, ...(payload.driverId ? { driver_id: payload.driverId } : {}) }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Reassign failed (${res.status}).`);
  return res.json();
}

export async function cancelScheduled(id: string, payload: ScheduledReasonPayload): Promise<ScheduledBookingDetail> {
  const reasonCode = requireReasonCode(payload.reasonCode, 'cancel a scheduled booking');
  if (USE_MOCK) {
    await delay(450);
    BOOKINGS = BOOKINGS.map((b) => (b.id === id
      ? { ...b, status: 'cancelled', cancelReason: reasonCode, cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      : b));
    pushAudit(id, 'scheduled.cancel', reasonCode);
    const b = BOOKINGS.find((x) => x.id === id);
    if (!b) throw new Error('Scheduled booking not found');
    return b;
  }
  const res = await fetch(`${adminBase()}/${id}/cancel`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reasonCode }) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Cancel failed (${res.status}).`);
  return res.json();
}

// Re-exported for the pages to build filter dropdowns without hardcoding twice.
export const SCHEDULED_STATUSES: ScheduledStatus[] = ['scheduled', 'dispatch_pending', 'dispatched', 'completed', 'cancelled', 'failed_no_driver', 'expired'];
export const SCHEDULED_MODES: ScheduledMode[] = ['ride_hail', 'ride_share', 'parcel_intra', 'parcel_inter', 'airport_pickup', 'bus'];
