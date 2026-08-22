// ── Admin — Spray (event money-spraying) ops console ─────────────────────────
// Mock by default. Flip with NEXT_PUBLIC_SPRAY_ADMIN_USE_MOCK=false to hit the live
// Go backend. NOTE: the spray admin surface is THIN — the only admin route is
// GET /api/spray/admin/spray/leaderboard/:contextRef (RBAC spray.read), used for
// AML oversight of a spray context's leaderboard. There is no payouts admin route;
// the payouts view here is mock-only and documents the gap.
// Spray enforces AML single / daily-amount / daily-count limits server-side.
// Money is BIGINT kobo (minor units) throughout.

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_SPRAY_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/spray/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// ── Types ────────────────────────────────────────────────────────────────────
export interface SprayDashboard {
  events_total: number;
  events_live: number;
  sprays_30d: number;
  spray_volume_30d_kobo: number;
  unique_sprayers_30d: number;
  aml_flags_30d: number;
  payouts_pending: number;
  payouts_pending_kobo: number;
  activity: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

export type SprayEventStatus = 'live' | 'scheduled' | 'closed';
export interface SprayEvent {
  context_ref: string;
  name: string;
  status: SprayEventStatus;
  host_masked: string;
  total_sprayed_kobo: number;
  sprayer_count: number;
  started_at: string;
}

export interface SprayLeaderRow {
  rank: number;
  user_masked: string;
  total_kobo: number;
  spray_count: number;
}

export type SprayPayoutStatus = 'pending' | 'paid' | 'failed';
export interface SprayPayout {
  id: string;
  context_ref: string;
  event_name: string;
  beneficiary_masked: string;
  amount_kobo: number;
  status: SprayPayoutStatus;
  created_at: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const DASHBOARD: SprayDashboard = {
  events_total: 1_204,
  events_live: 6,
  sprays_30d: 48_200,
  spray_volume_30d_kobo: 96_400_000_00,
  unique_sprayers_30d: 9_840,
  aml_flags_30d: 14,
  payouts_pending: 3,
  payouts_pending_kobo: 4_200_000_00,
  activity: [
    { id: 'ev1', kind: 'spray', label: 'Large spray recorded — within AML single-spray limit', ref: 'evt_owambe_2026', created_at: iso(0.3) },
    { id: 'ev2', kind: 'flagged', label: 'AML daily-count threshold tripped — flagged for review', ref: 'usr_2210', created_at: iso(2) },
    { id: 'ev3', kind: 'paid', label: 'Spray payout settled to beneficiary', ref: 'pay_771', created_at: iso(5) },
  ],
};
export async function getSprayDashboard(): Promise<SprayDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, activity: [...DASHBOARD.activity] }; }
  return getJson<SprayDashboard>('/dashboard');
}

// ── Events ───────────────────────────────────────────────────────────────────
const EVENTS: SprayEvent[] = [
  { context_ref: 'evt_owambe_2026', name: 'Owambe Lagos 2026', status: 'live', host_masked: 'Chioma A•••', total_sprayed_kobo: 14_200_000_00, sprayer_count: 312, started_at: iso(3) },
  { context_ref: 'evt_wedding_5521', name: 'Tunde & Bisi Wedding', status: 'live', host_masked: 'Tunde B•••', total_sprayed_kobo: 8_900_000_00, sprayer_count: 188, started_at: iso(5) },
  { context_ref: 'evt_concert_440', name: 'Afrobeats Night', status: 'closed', host_masked: 'Seun K•••', total_sprayed_kobo: 22_500_000_00, sprayer_count: 640, started_at: iso(120) },
];
export async function listSprayEvents(opts?: { status?: string; q?: string }): Promise<SprayEvent[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...EVENTS];
    if (opts?.status) rows = rows.filter((e) => e.status === opts.status);
    if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((e) => e.name.toLowerCase().includes(q) || e.context_ref.includes(q)); }
    return rows;
  }
  return getJson<SprayEvent[]>('/events');
}

// Real admin endpoint: GET /api/spray/admin/spray/leaderboard/:contextRef
export async function getSprayLeaderboard(contextRef: string): Promise<SprayLeaderRow[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { rank: 1, user_masked: 'Bola T•••', total_kobo: 2_400_000_00, spray_count: 48 },
      { rank: 2, user_masked: 'Kemi D•••', total_kobo: 1_900_000_00, spray_count: 36 },
      { rank: 3, user_masked: 'Funke A•••', total_kobo: 1_200_000_00, spray_count: 22 },
      { rank: 4, user_masked: 'Ada N•••', total_kobo: 880_000_00, spray_count: 17 },
      { rank: 5, user_masked: 'Musa I•••', total_kobo: 640_000_00, spray_count: 12 },
    ];
  }
  return getJson<SprayLeaderRow[]>(`/spray/leaderboard/${encodeURIComponent(contextRef)}`);
}

// ── Payouts (mock-only — no backend admin route exists) ──────────────────────
const PAYOUTS: SprayPayout[] = [
  { id: 'pay_775', context_ref: 'evt_owambe_2026', event_name: 'Owambe Lagos 2026', beneficiary_masked: 'Chioma A•••', amount_kobo: 14_200_000_00, status: 'pending', created_at: iso(2) },
  { id: 'pay_771', context_ref: 'evt_concert_440', event_name: 'Afrobeats Night', beneficiary_masked: 'Seun K•••', amount_kobo: 22_500_000_00, status: 'paid', created_at: iso(30) },
  { id: 'pay_768', context_ref: 'evt_wedding_5521', event_name: 'Tunde & Bisi Wedding', beneficiary_masked: 'Tunde B•••', amount_kobo: 8_900_000_00, status: 'pending', created_at: iso(6) },
];
export async function listSprayPayouts(opts?: { status?: string }): Promise<SprayPayout[]> {
  // No backend admin route for payouts — always mock.
  await delay();
  let rows = [...PAYOUTS];
  if (opts?.status) rows = rows.filter((p) => p.status === opts.status);
  return rows;
}
