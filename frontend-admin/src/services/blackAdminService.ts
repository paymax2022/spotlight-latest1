// ── Admin — Paymax Black (premium tier, perks, partners, settlement) control-plane ─
// Mock by default (mirrors events / loyalty admin services). Flip with
// NEXT_PUBLIC_LOYALTY_USE_MOCK=false to hit the live Go backend at
// /api/loyalty/admin/black*.
// RBAC: loyalty.black.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units). Surfaces NL-3 (closed-loop perks via single-use
// credential), NL-4 (perks/points not cash), NL-12 (immutable audit).

import { env } from '@/config/env';
import type {
  BlackDashboard,
  BlackPerk,
  BlackPerkUpsertResult,
  BlackPartner,
  BlackSettlement,
} from '@/types/blackAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_LOYALTY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/loyalty/admin/black');
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
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Display helper: kobo → ₦ ─────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const dateAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const aud = () => `aud_${Math.random().toString(36).slice(2, 10)}`;
const thisPeriod = () => new Date().toISOString().slice(0, 7);

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: BlackDashboard = {
  members_total: 18_420,
  members_active: 16_980,
  members_new_30d: 1_240,
  churn_30d: 320,
  membership_revenue_30d_kobo: 184_200_000_00,
  perk_redemptions_30d: 9_640,
  perk_cost_30d_kobo: 48_300_000_00,
  partner_offers_active: 42,
  partners_active: 17,
  partner_settlement_due_kobo: 22_400_000_00,
  settlement_breaks_open: 2,
  redemption_mix: [
    { kind: 'early_ticket', count: 3_840, cost_kobo: 0 },
    { kind: 'lounge_access', count: 1_920, cost_kobo: 9_600_000_00 },
    { kind: 'discount', count: 2_410, cost_kobo: 12_050_000_00 },
    { kind: 'partner_offer', count: 1_180, cost_kobo: 23_600_000_00 },
    { kind: 'free_delivery', count: 290, cost_kobo: 3_050_000_00 },
  ],
  members_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    members: 17_000 + i * 100 + Math.round(Math.sin(i / 2) * 60),
    redemptions: 600 + Math.round(Math.abs(Math.cos(i / 2) * 120)),
  })),
  activity: [
    { id: 'bk1', kind: 'member_upgraded', label: 'Member upgraded TIER3 → BLACK on eligibility', ref: 'mem_8841', created_at: iso(0.4) },
    { id: 'bk2', kind: 'perk_redeemed', label: 'Early-ticket perk redeemed via single-use credential at "Detty December" (NL-3)', ref: 'rdm_5521', created_at: iso(1.2) },
    { id: 'bk3', kind: 'partner_added', label: 'New partner onboarded — "Hardrock Lounge VI"', ref: 'prt_3310', created_at: iso(4) },
    { id: 'bk4', kind: 'settlement_run', label: 'Partner settlement batch generated for 2026-06', ref: 'set_2207', created_at: iso(20) },
    { id: 'bk5', kind: 'perk_revoked', label: 'Perk paused — partner offer exhausted monthly cap', ref: 'prk_001', created_at: iso(30) },
  ],
};
export async function getBlackDashboard(): Promise<BlackDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, redemption_mix: [...DASHBOARD.redemption_mix], members_trend: [...DASHBOARD.members_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<BlackDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Perk config
// ════════════════════════════════════════════════════════════════════════════
const PERKS: BlackPerk[] = [
  { id: 'prk_001', name: 'Early ticket access (24h)', kind: 'early_ticket', status: 'active', description: 'Black members buy tickets 24h before public sale via single-use credential.', partner_id: null, partner_name: null, value_kobo: 0, monthly_cap_per_member: 10, total_redeemed_30d: 3_840, cost_30d_kobo: 0, starts_at: dateStr(120), ends_at: null, updated_by_masked: 'admin:fola•••', updated_at: iso(40) },
  { id: 'prk_002', name: 'VIP lounge access', kind: 'lounge_access', status: 'active', description: 'Complimentary lounge entry at partnered venues (credential-gated, single-use per event).', partner_id: 'prt_3310', partner_name: 'Hardrock Lounge VI', value_kobo: 50_000_0, monthly_cap_per_member: 2, total_redeemed_30d: 1_920, cost_30d_kobo: 9_600_000_00, starts_at: dateStr(90), ends_at: dateAhead(180), updated_by_masked: 'admin:bola•••', updated_at: iso(60) },
  { id: 'prk_003', name: '15% off premium events', kind: 'discount', status: 'active', description: '15% discount on VIP/VVIP tiers, applied as closed-loop credit — never cash (NL-4).', partner_id: null, partner_name: null, value_kobo: 0, monthly_cap_per_member: 5, total_redeemed_30d: 2_410, cost_30d_kobo: 12_050_000_00, starts_at: dateStr(60), ends_at: null, updated_by_masked: 'admin:fola•••', updated_at: iso(72) },
  { id: 'prk_004', name: 'Free delivery (Restaurant)', kind: 'free_delivery', status: 'paused', description: 'Free delivery on Paymax restaurant orders. Paused — exhausted monthly cap.', partner_id: null, partner_name: null, value_kobo: 1_050_00, monthly_cap_per_member: 8, total_redeemed_30d: 290, cost_30d_kobo: 3_050_000_00, starts_at: dateStr(30), ends_at: dateAhead(60), updated_by_masked: 'admin:bola•••', updated_at: iso(30) },
];
export async function listPerks(opts?: { status?: string; kind?: string; q?: string }): Promise<BlackPerk[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PERKS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q) || (r.partner_name ?? '').toLowerCase().includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<BlackPerk[]>(`/perks${qs.toString() ? `?${qs}` : ''}`);
}
export async function upsertPerk(perk: Partial<BlackPerk> & { id?: string }, note?: string): Promise<BlackPerkUpsertResult> {
  if (USE_MOCK) {
    await delay();
    const id = perk.id ?? `prk_${Math.random().toString(36).slice(2, 8)}`;
    const existing = PERKS.find((p) => p.id === id);
    const merged: BlackPerk = {
      id,
      name: perk.name ?? existing?.name ?? 'Untitled perk',
      kind: perk.kind ?? existing?.kind ?? 'discount',
      status: perk.status ?? existing?.status ?? 'draft',
      description: perk.description ?? existing?.description ?? '',
      partner_id: perk.partner_id ?? existing?.partner_id ?? null,
      partner_name: perk.partner_name ?? existing?.partner_name ?? null,
      value_kobo: perk.value_kobo ?? existing?.value_kobo ?? 0,
      monthly_cap_per_member: perk.monthly_cap_per_member ?? existing?.monthly_cap_per_member ?? 1,
      total_redeemed_30d: existing?.total_redeemed_30d ?? 0,
      cost_30d_kobo: existing?.cost_30d_kobo ?? 0,
      starts_at: perk.starts_at ?? existing?.starts_at ?? null,
      ends_at: perk.ends_at ?? existing?.ends_at ?? null,
      updated_by_masked: 'admin:you•••',
      updated_at: new Date().toISOString(),
    };
    return { perk: merged, audit_id: aud(), message: `Perk "${merged.name}" saved. Redeemable closed-loop via single-use credential — never cash (NL-3/NL-4). Recorded to immutable audit (NL-12).` };
  }
  return sendJson<BlackPerkUpsertResult>(perk.id ? 'PATCH' : 'POST', perk.id ? `/perks/${perk.id}` : '/perks', { ...perk, note });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Partner-offer management
// ════════════════════════════════════════════════════════════════════════════
const PARTNERS: BlackPartner[] = [
  { id: 'prt_3310', name: 'Hardrock Lounge VI', category: 'dining', status: 'active', contact_masked: 'ops@hardrock•••', offers_count: 4, redemptions_30d: 1_920, settlement_model: 'partner_funded', partner_share_bps: 10000, outstanding_settlement_kobo: 9_600_000_00, onboarded_at: dateStr(90), created_at: iso(2160) },
  { id: 'prt_3320', name: 'Filmhouse Cinemas', category: 'events', status: 'active', contact_masked: 'partners@filmhouse•••', offers_count: 6, redemptions_30d: 2_140, settlement_model: 'shared', partner_share_bps: 5000, outstanding_settlement_kobo: 6_300_000_00, onboarded_at: dateStr(120), created_at: iso(2880) },
  { id: 'prt_3330', name: 'Chicken Republic', category: 'retail', status: 'active', contact_masked: 'loyalty@chickenrep•••', offers_count: 3, redemptions_30d: 980, settlement_model: 'platform_funded', partner_share_bps: 0, outstanding_settlement_kobo: 0, onboarded_at: dateStr(45), created_at: iso(1080) },
  { id: 'prt_3340', name: 'Bolt Travel Lounge', category: 'travel', status: 'pending', contact_masked: 'b2b@bolt•••', offers_count: 0, redemptions_30d: 0, settlement_model: 'partner_funded', partner_share_bps: 10000, outstanding_settlement_kobo: 0, onboarded_at: dateStr(5), created_at: iso(120) },
  { id: 'prt_3350', name: 'Shoprite NG', category: 'retail', status: 'suspended', contact_masked: 'promo@shoprite•••', offers_count: 2, redemptions_30d: 0, settlement_model: 'shared', partner_share_bps: 5000, outstanding_settlement_kobo: 6_500_000_00, onboarded_at: dateStr(200), created_at: iso(4800) },
];
export async function listPartners(opts?: { status?: string; category?: string; q?: string }): Promise<BlackPartner[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PARTNERS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.category) qs.set('category', opts.category);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<BlackPartner[]>(`/partners${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// D · Partner settlement
// ════════════════════════════════════════════════════════════════════════════
const SETTLEMENT: BlackSettlement = {
  generated_at: iso(0.2),
  total_gross_kobo: 36_400_000_00,
  total_platform_funded_kobo: 11_500_000_00,
  total_partner_funded_kobo: 24_900_000_00,
  total_net_due_kobo: 22_400_000_00,
  total_break_kobo: 420_000_00,
  breaks_open: 2,
  lines: [
    { id: 'set_2207', partner_id: 'prt_3310', partner_name: 'Hardrock Lounge VI', period: thisPeriod(), redemptions: 1_920, gross_perk_value_kobo: 9_600_000_00, platform_funded_kobo: 0, partner_funded_kobo: 9_600_000_00, net_due_to_partner_kobo: 9_600_000_00, status: 'open', break_kobo: 0, settled_at: null },
    { id: 'set_2210', partner_id: 'prt_3320', partner_name: 'Filmhouse Cinemas', period: thisPeriod(), redemptions: 2_140, gross_perk_value_kobo: 12_600_000_00, platform_funded_kobo: 6_300_000_00, partner_funded_kobo: 6_300_000_00, net_due_to_partner_kobo: 6_300_000_00, status: 'investigating', break_kobo: 220_000_00, settled_at: null },
    { id: 'set_2220', partner_id: 'prt_3330', partner_name: 'Chicken Republic', period: thisPeriod(), redemptions: 980, gross_perk_value_kobo: 4_900_000_00, platform_funded_kobo: 4_900_000_00, partner_funded_kobo: 0, net_due_to_partner_kobo: 0, status: 'settled', break_kobo: 0, settled_at: iso(48) },
    { id: 'set_2230', partner_id: 'prt_3350', partner_name: 'Shoprite NG', period: thisPeriod(), redemptions: 1_300, gross_perk_value_kobo: 9_300_000_00, platform_funded_kobo: 300_000_00, partner_funded_kobo: 9_000_000_00, net_due_to_partner_kobo: 6_500_000_00, status: 'open', break_kobo: 200_000_00, settled_at: null },
  ],
};
export async function listPartnerSettlements(opts?: { status?: string; period?: string; q?: string }): Promise<BlackSettlement> {
  if (USE_MOCK) {
    await delay();
    let lines = [...SETTLEMENT.lines];
    if (opts?.status) lines = lines.filter((r) => r.status === opts.status);
    if (opts?.period) lines = lines.filter((r) => r.period === opts.period);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      lines = lines.filter((r) => r.partner_name.toLowerCase().includes(q) || r.id.includes(q));
    }
    return { ...SETTLEMENT, lines };
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.period) qs.set('period', opts.period);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<BlackSettlement>(`/settlement${qs.toString() ? `?${qs}` : ''}`);
}
