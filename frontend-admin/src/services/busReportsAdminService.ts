// Bus admin: revenue report (+CSV) and route/schedule creation. Live-only — no
// fixture mode, so the console never reports a write it did not perform.
// Backend: /api/finance/admin/transport/bus/{reports/revenue,routes,schedules,operators}
// (backend/internal/transport/bus_reports.go, bus_handler.go). Money is integer kobo.

import { apiRoot } from '@/config/env';

function adminBase(): string {
  return `${apiRoot()}/api/finance/admin/transport`;
}
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function failure(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body?.error || body?.message || `Request failed (${res.status})`);
}

export type BusRevenueGroupBy = 'day' | 'operator';

export interface BusRevenueRow {
  key: string;
  label: string;
  ticketsCount: number;
  grossBookedKobo: number;
  cancelledCount: number;
  refundedKobo: number;
  manualRefundKobo: number;
  heldKobo: number;
  releasedCount: number;
  netToOperatorKobo: number;
  platformCommissionKobo: number;
}

export interface BusRevenueReport {
  from: string;
  to: string;
  groupBy: BusRevenueGroupBy;
  rows: BusRevenueRow[];
  totals: BusRevenueRow;
}

export interface BusRevenueQuery {
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  groupBy: BusRevenueGroupBy;
}

function reportQs(q: BusRevenueQuery, format?: 'csv'): string {
  const p = new URLSearchParams({ from: q.from, to: q.to, group_by: q.groupBy });
  if (format) p.set('format', format);
  return p.toString();
}

export async function getBusRevenueReport(q: BusRevenueQuery): Promise<BusRevenueReport> {
  const res = await fetch(`${adminBase()}/bus/reports/revenue?${reportQs(q)}`, { headers: JSON_HEADERS });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export async function downloadBusRevenueCsv(q: BusRevenueQuery): Promise<Blob> {
  const res = await fetch(`${adminBase()}/bus/reports/revenue?${reportQs(q, 'csv')}`);
  if (!res.ok) throw await failure(res);
  return res.blob();
}

// ── Create route / schedule ──────────────────────────────────────────────────

export interface BusOperatorOption { id: string; ownerUserId: string | null; businessName: string; verificationStatus: string }
export interface BusRouteOption { id: string; label: string; status: string }

export async function listBusOperatorOptions(): Promise<BusOperatorOption[]> {
  const res = await fetch(`${adminBase()}/bus/operators`, { headers: JSON_HEADERS });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return ((j?.operators ?? []) as Record<string, unknown>[]).map((o) => ({
    id: String(o.id),
    ownerUserId: (o.ownerUserId as string | null) ?? null,
    businessName: String(o.businessName ?? o.id),
    verificationStatus: String(o.verificationStatus ?? 'pending'),
  }));
}

export async function listBusRouteOptions(): Promise<BusRouteOption[]> {
  const res = await fetch(`${adminBase()}/bus/routes`, { headers: JSON_HEADERS });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return ((j?.routes ?? []) as Record<string, unknown>[]).map((r) => {
    // Tolerates both the current (originTerminal/destTerminal) and the aligned
    // (origin/destination) admin route shapes.
    const o = r.origin ?? r.originTerminal ?? '?';
    const d = r.destination ?? r.destTerminal ?? '?';
    return { id: String(r.id), label: `${o} → ${d}`, status: String(r.status ?? (r.active === false ? 'inactive' : 'active')) };
  });
}

export interface CreateBusRouteInput {
  operator_id: string; // operator USER id (route payee for legacy admin routes)
  origin_terminal: string;
  dest_terminal: string;
  distance_m?: number;
  est_duration_s?: number;
  category?: string;
  reason: string;
}

export async function createBusRoute(input: CreateBusRouteInput): Promise<{ id: string; status: string }> {
  const res = await fetch(`${adminBase()}/bus/routes`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export interface CreateBusScheduleInput {
  route_id: string;
  departure_time: string; // RFC3339
  arrival_estimate?: string;
  total_seats: number;
  fare_kobo: number; // integer kobo
  cancel_cutoff_minutes?: number;
  reason: string;
}

export async function createBusSchedule(input: CreateBusScheduleInput): Promise<{ id: string; fareApproved: boolean; status: string }> {
  const res = await fetch(`${adminBase()}/bus/schedules`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });
  if (!res.ok) throw await failure(res);
  return res.json();
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Parses a naira amount typed by an admin ("1,200", "1200.5", "₦1 200.50") into
 * integer kobo using string arithmetic only (no float multiply). Returns null
 * for anything that is not a non-negative amount with at most 2 decimals.
 */
export function nairaInputToKobo(raw: string): number | null {
  const s = raw.replace(/[₦,\s]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const kobo = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

/** Converts a <input type="datetime-local"> value (local wall time) to RFC3339 UTC. */
export function localDateTimeToRfc3339(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
