// ── Admin — Groups (group savings / contribution pools) ops console ──────────
//
// ⚠️ THIS CONSOLE RUNS ON FIXTURES. There is no groups ADMIN route group in Go
// at all — only five MEMBER endpoints exist under /api/finance/groups — so
// /admin/dashboard and the group list below have nothing behind them. Setting
// NEXT_PUBLIC_GROUPS_ADMIN_USE_MOCK=false does not produce real data; it
// produces 404s. The fixtures are kept (they document the intended shape) but
// the pages now SAY they are samples, via GROUPS_ADMIN_IS_MOCK.
//
// This module is NOT the association console. Associations (real members, real
// dues, a real admin surface) live in associationAdminService + /admin/association/*.
//
// Money is BIGINT kobo (minor units) throughout; balances would be projections
// of the immutable ledger (NL-8).

import { apiRoot } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';

// Migrated off the inline `?? 'true'` check, which FAILED OPEN: it resolved to
// MOCK unless someone remembered to set the flag to 'false', in production as
// much as in dev, so a forgotten flag shipped fabricated pool balances to a
// fintech operator with nothing on screen to say so. resolveUseMock defaults to
// mock in dev and LIVE in prod, and this module is on the documented
// MOCK_ALLOWLIST in scripts/check-mock-flags.mjs precisely because it has no
// backend yet — an explicit opt-in that CI can see, rather than a silent default.
const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_GROUPS_ADMIN_USE_MOCK);

/**
 * True when this console is serving fixtures rather than backend data. Exported
 * so the pages can SAY so (see MockDataBanner usage in app/admin/groups/*) —
 * the whole failure mode here was mock data that looked exactly like real data.
 */
export const GROUPS_ADMIN_IS_MOCK = USE_MOCK;

// Groups live under the finance member group at /api/finance/groups (no admin group).
//
// This used to be `env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/groups')`,
// which was correct only while apiBaseUrl ended in /api/v1. It no longer does —
// it is the same-origin proxy path (<origin>/api/admin-proxy) — so the regex
// stopped matching, the replace was a no-op, and every call went to the bare
// proxy root and 404'd. Flipping the mock flag therefore did not switch this
// console to live data; it switched it to an empty, broken one. Same shape as
// apiRoot() usage in associationAdminService.
function readBase(): string {
  return `${apiRoot()}/api/finance/groups`;
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
  const res = await fetch(`${readBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// ── Types ────────────────────────────────────────────────────────────────────
export interface GroupsDashboard {
  groups_total: number;
  groups_active: number;
  members_total: number;
  pooled_balance_kobo: number;
  dues_collected_30d_kobo: number;
  invites_pending: number;
  activity: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

export type GroupStatus = 'active' | 'forming' | 'closed';
export interface GroupRecord {
  id: string;
  name: string;
  status: GroupStatus;
  owner_masked: string;
  members_count: number;
  due_amount_kobo: number;
  frequency: 'weekly' | 'monthly';
  balance_kobo: number;
  created_at: string;
}

export type GroupMemberStatus = 'active' | 'invited' | 'left';
export interface GroupMember {
  id: string;
  masked_name: string;
  status: GroupMemberStatus;
  role: 'owner' | 'member';
  paid_dues_kobo: number;
  joined_at: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const DASHBOARD: GroupsDashboard = {
  groups_total: 612,
  groups_active: 488,
  members_total: 7_240,
  pooled_balance_kobo: 184_600_000_00,
  dues_collected_30d_kobo: 22_400_000_00,
  invites_pending: 134,
  activity: [
    { id: 'ev1', kind: 'dues_paid', label: 'Member paid monthly dues into the pool', ref: 'grp_4012', created_at: iso(0.6) },
    { id: 'ev2', kind: 'invited', label: 'Group owner invited a new member', ref: 'grp_3998', created_at: iso(1.4) },
    { id: 'ev3', kind: 'forming', label: 'New group created — awaiting members', ref: 'grp_4020', created_at: iso(3) },
  ],
};
export async function getGroupsDashboard(): Promise<GroupsDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, activity: [...DASHBOARD.activity] }; }
  return getJson<GroupsDashboard>('/admin/dashboard');
}

// ── Groups ───────────────────────────────────────────────────────────────────
const GROUPS: GroupRecord[] = [
  { id: 'grp_4012', name: 'Lagos Foodies Pool', status: 'active', owner_masked: 'Chioma A•••', members_count: 12, due_amount_kobo: 10_000_00, frequency: 'monthly', balance_kobo: 1_440_000_00, created_at: dateStr(120) },
  { id: 'grp_3998', name: 'Office Lunch Club', status: 'active', owner_masked: 'Tunde B•••', members_count: 8, due_amount_kobo: 5_000_00, frequency: 'weekly', balance_kobo: 320_000_00, created_at: dateStr(60) },
  { id: 'grp_4020', name: 'Campus Squad', status: 'forming', owner_masked: 'Aisha M•••', members_count: 3, due_amount_kobo: 2_000_00, frequency: 'weekly', balance_kobo: 0, created_at: dateStr(2) },
  { id: 'grp_3850', name: 'Family Welfare', status: 'closed', owner_masked: 'Emeka O•••', members_count: 15, due_amount_kobo: 20_000_00, frequency: 'monthly', balance_kobo: 0, created_at: dateStr(420) },
];
export async function listGroups(opts?: { status?: string; q?: string }): Promise<GroupRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...GROUPS];
    if (opts?.status) rows = rows.filter((g) => g.status === opts.status);
    if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((g) => g.name.toLowerCase().includes(q) || g.owner_masked.toLowerCase().includes(q) || g.id.includes(q)); }
    return rows;
  }
  return getJson<GroupRecord[]>('');
}

const MEMBERS: Record<string, GroupMember[]> = {
  grp_4012: [
    { id: 'gm1', masked_name: 'Chioma A•••', status: 'active', role: 'owner', paid_dues_kobo: 120_000_00, joined_at: dateStr(120) },
    { id: 'gm2', masked_name: 'Bola T•••', status: 'active', role: 'member', paid_dues_kobo: 110_000_00, joined_at: dateStr(118) },
    { id: 'gm3', masked_name: 'Ada N•••', status: 'invited', role: 'member', paid_dues_kobo: 0, joined_at: dateStr(1) },
  ],
};
export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  if (USE_MOCK) {
    await delay();
    return (MEMBERS[groupId] ?? MEMBERS.grp_4012).map((m) => ({ ...m }));
  }
  return getJson<GroupMember[]>(`/${groupId}`);
}
