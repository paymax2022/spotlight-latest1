// ── Admin — Points (loyalty points ledger + balances) ops console ────────────
// Mock by default. Flip with NEXT_PUBLIC_POINTS_ADMIN_USE_MOCK=false to hit the live
// Go backend. NOTE: the points admin surface is THIN — points are administered via
// the loyalty admin group. The only relevant real admin route is
// GET /api/loyalty/admin/loyalty/memberships/:userId (RBAC loyalty.read), which
// returns a member's loyalty membership incl. points balance + tier. The member
// reads points at /api/finance/points/{balance,catalog}. The points LEDGER is
// append-only — points accrue only as a side effect of live-module actions, never
// via a self-award endpoint (NL-4). Ledger listing here is mock-only.

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_POINTS_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// Points admin oversight lives under the loyalty admin group at /api/loyalty/admin/*.
function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/loyalty/admin');
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

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// ── Types ────────────────────────────────────────────────────────────────────
export interface PointsDashboard {
  members_total: number;
  points_in_circulation: number;     // outstanding points liability (count, not kobo)
  points_earned_30d: number;
  points_redeemed_30d: number;
  redemptions_30d: number;
  catalog_items: number;
  activity: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

export type LedgerKind = 'earn' | 'redeem' | 'adjust' | 'expire';
export interface PointsLedgerEntry {
  id: string;
  user_masked: string;
  kind: LedgerKind;
  points: number;            // signed: +earn / -redeem
  reason: string;
  created_at: string;
}

export interface PointsMembership {
  user_id: string;
  tier: string;
  points_balance: number;
  lifetime_points: number;
  joined_at: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const DASHBOARD: PointsDashboard = {
  members_total: 48_200,
  points_in_circulation: 12_840_000,
  points_earned_30d: 2_410_000,
  points_redeemed_30d: 980_000,
  redemptions_30d: 6_120,
  catalog_items: 42,
  activity: [
    { id: 'ev1', kind: 'earn', label: 'Points earned — wallet top-up reward (NL-4: side-effect only)', ref: 'usr_2210', created_at: iso(0.4) },
    { id: 'ev2', kind: 'redeem', label: 'Points redeemed for catalog reward', ref: 'usr_1980', created_at: iso(1.3) },
    { id: 'ev3', kind: 'expire', label: 'Points expired — 12-month inactivity sweep', ref: 'usr_1750', created_at: iso(8) },
  ],
};
export async function getPointsDashboard(): Promise<PointsDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, activity: [...DASHBOARD.activity] }; }
  return getJson<PointsDashboard>('/points/dashboard');
}

// ── Ledger (mock-only — points ledger is append-only / NL-4, no admin list route) ─
const LEDGER: PointsLedgerEntry[] = [
  { id: 'pl_9901', user_masked: 'usr_2210', kind: 'earn', points: 1_200, reason: 'Wallet top-up reward', created_at: iso(0.4) },
  { id: 'pl_9890', user_masked: 'usr_1980', kind: 'redeem', points: -5_000, reason: 'Catalog: ₦1,000 airtime', created_at: iso(1.3) },
  { id: 'pl_9881', user_masked: 'usr_1750', kind: 'expire', points: -800, reason: 'Inactivity sweep', created_at: iso(8) },
  { id: 'pl_9870', user_masked: 'usr_2210', kind: 'adjust', points: 500, reason: 'Goodwill adjustment (audited)', created_at: iso(48) },
];
export async function listPointsLedger(opts?: { kind?: string; q?: string }): Promise<PointsLedgerEntry[]> {
  // No backend admin route for the points ledger — always mock.
  await delay();
  let rows = [...LEDGER];
  if (opts?.kind) rows = rows.filter((e) => e.kind === opts.kind);
  if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((e) => e.user_masked.toLowerCase().includes(q) || e.id.includes(q) || e.reason.toLowerCase().includes(q)); }
  return rows;
}

// ── Balances — real endpoint: GET /api/loyalty/admin/loyalty/memberships/:userId ─
const MEMBERSHIPS: Record<string, PointsMembership> = {
  usr_2210: { user_id: 'usr_2210', tier: 'Gold', points_balance: 8_400, lifetime_points: 42_100, joined_at: iso(8_760) },
  usr_1980: { user_id: 'usr_1980', tier: 'Silver', points_balance: 1_200, lifetime_points: 12_800, joined_at: iso(4_380) },
};
export async function lookupMembership(userId: string): Promise<PointsMembership> {
  if (USE_MOCK) {
    await delay();
    const m = MEMBERSHIPS[userId];
    if (m) return { ...m };
    return { user_id: userId, tier: 'Bronze', points_balance: 0, lifetime_points: 0, joined_at: iso(720) };
  }
  return getJson<PointsMembership>(`/loyalty/memberships/${encodeURIComponent(userId)}`);
}
