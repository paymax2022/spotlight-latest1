// ── Admin — Paymax Loyalty (Points, Tiers, Catalog) control-plane service ──────
// Mock by default (mirrors stays / savings / events admin services). Flip with
// NEXT_PUBLIC_LOYALTY_USE_MOCK=false to hit the live Go backend at /api/loyalty/admin/*.
// RBAC: loyalty.admin.* gates wired on the sidebar.
// POINTS ARE NON-CASH (NL-4). Point balances are integers, NOT kobo. Any ₦ figure
// (catalog cash value, liability valuation) is BIGINT kobo via formatNaira.
// Surfaces NL-4 (points ≠ cash), NL-8 (append-only ledger), NL-12 (immutable audit).

import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  LoyaltyDashboard,
  EarnRule,
  EarnRuleUpdate,
  EarnRuleResult,
  TierConfig,
  TierUpdate,
  TierResult,
  CatalogItem,
  CatalogUpsert,
  CatalogResult,
  RedemptionRecord,
  PointsLiability,
} from '@/types/loyaltyAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_LOYALTY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

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
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method,
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey(method, path) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Display helpers ──────────────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Points are NON-CASH — render with a unit label so they're never mistaken for ₦.
export function formatPoints(points: number): string {
  return `${(points ?? 0).toLocaleString('en-NG')} pts`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard — points liability + tier distribution
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: LoyaltyDashboard = {
  points_outstanding: 482_400_000,
  points_liability_kobo: 241_200_000_00,     // 482.4m pts × ₦0.50 redemption value
  points_redemption_value_kobo: 50,          // ₦0.50 per point = 50 kobo
  points_earned_30d: 64_200_000,
  points_redeemed_30d: 38_700_000,
  points_expiring_30d: 12_400_000,
  breakage_rate: 0.18,
  members_total: 184_200,
  tier_distribution: [
    { tier: 'Tier 1', members: 142_800, share_pct: 0.775 },
    { tier: 'Tier 2', members: 34_100, share_pct: 0.185 },
    { tier: 'Tier 3', members: 7_300, share_pct: 0.040 },
  ],
  earn_rules_active: 9,
  catalog_items_active: 14,
  redemptions_today: 2_840,
  redemption_fraud_open: 4,
  points_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    earned: 1_800_000 + i * 90_000 + Math.round(Math.sin(i / 2) * 220_000),
    redeemed: 1_100_000 + i * 60_000 + Math.round(Math.cos(i / 2) * 140_000),
  })),
  activity: [
    { id: 'lv1', kind: 'earn_rule_updated', label: 'Earn rule updated — Ticket purchase now 2 pts/₦ (v4)', ref: 'er_tickets', created_at: iso(0.5) },
    { id: 'lv2', kind: 'liability_alert', label: '12.4m pts expiring in 30d — breakage projection refreshed (NL-4 valuation)', ref: 'liab_30d', created_at: iso(1.2) },
    { id: 'lv3', kind: 'redemption', label: 'Redemption: 5,000 pts → ₦2,500 airtime (NL-4: non-cash perk)', ref: 'rdm_8841', created_at: iso(2.4) },
    { id: 'lv4', kind: 'tier_changed', label: 'Tier 2 threshold raised to 250,000 pts (v3)', ref: 'tier_2', created_at: iso(4) },
    { id: 'lv5', kind: 'catalog_published', label: 'Catalog item published — DStv Compact bill credit', ref: 'cat_dstv', created_at: iso(7) },
    { id: 'lv6', kind: 'fraud_flag', label: 'Redemption fraud flagged — velocity anomaly on single member', ref: 'rdm_9001', created_at: iso(10) },
  ],
};
export async function getLoyaltyDashboard(): Promise<LoyaltyDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, tier_distribution: [...DASHBOARD.tier_distribution], points_trend: [...DASHBOARD.points_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<LoyaltyDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Earn rules — by action/module, versioned
// ════════════════════════════════════════════════════════════════════════════
const EARN_RULES: EarnRule[] = [
  { id: 'er_tickets', module: 'tickets', action: 'ticket_purchase', points_per_naira: 0.02, flat_points: 0, cap_points_per_day: 100_000, status: 'active', config_version: 4, updated_at: iso(0.5) },
  { id: 'er_payments', module: 'payments', action: 'bill_payment', points_per_naira: 0.01, flat_points: 0, cap_points_per_day: 50_000, status: 'active', config_version: 2, updated_at: dateStr(12) },
  { id: 'er_savings', module: 'savings', action: 'auto_save', points_per_naira: 0.005, flat_points: 0, cap_points_per_day: 20_000, status: 'active', config_version: 1, updated_at: dateStr(40) },
  { id: 'er_cashless', module: 'cashless', action: 'cashless_topup', points_per_naira: 0.015, flat_points: 0, cap_points_per_day: 30_000, status: 'active', config_version: 1, updated_at: dateStr(8) },
  { id: 'er_referral', module: 'referral', action: 'referral_signup', points_per_naira: 0, flat_points: 5_000, cap_points_per_day: 0, status: 'active', config_version: 3, updated_at: dateStr(20) },
  { id: 'er_social', module: 'social', action: 'p2p_send', points_per_naira: 0.002, flat_points: 0, cap_points_per_day: 5_000, status: 'draft', config_version: 1, updated_at: dateStr(2) },
];
export async function listEarnRules(opts?: { module?: string; status?: string; q?: string }): Promise<EarnRule[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...EARN_RULES];
    if (opts?.module) rows = rows.filter((r) => r.module === opts.module);
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.action.toLowerCase().includes(q) || r.module.includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.module) qs.set('module', opts.module);
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EarnRule[]>(`/earn-rules${qs.toString() ? `?${qs}` : ''}`);
}
export async function updateEarnRule(id: string, patch: EarnRuleUpdate): Promise<EarnRuleResult> {
  if (USE_MOCK) {
    await delay();
    const cur = EARN_RULES.find((r) => r.id === id);
    return { id, config_version: (cur?.config_version ?? 1) + 1, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Earn rule ${id} updated — new versioned config saved. Points are NON-CASH (NL-4). Recorded to immutable audit (NL-12).` };
  }
  return sendJson<EarnRuleResult>('PATCH', `/earn-rules/${id}`, patch);
}

// ════════════════════════════════════════════════════════════════════════════
// C · Tiers — thresholds + benefits config
// ════════════════════════════════════════════════════════════════════════════
const TIERS: TierConfig[] = [
  { id: 'tier_1', name: 'Tier 1', rank: 1, threshold_points: 0, members: 142_800, benefits: ['Standard earn rate', 'Access to catalog'], earn_multiplier: 1.0, status: 'active', config_version: 2, updated_at: dateStr(60) },
  { id: 'tier_2', name: 'Tier 2', rank: 2, threshold_points: 250_000, members: 34_100, benefits: ['1.25× earn multiplier', 'Priority support', 'Early ticket access'], earn_multiplier: 1.25, status: 'active', config_version: 3, updated_at: iso(4) },
  { id: 'tier_3', name: 'Tier 3', rank: 3, threshold_points: 1_000_000, members: 7_300, benefits: ['1.5× earn multiplier', 'Lounge access at events', 'Exclusive perks'], earn_multiplier: 1.5, status: 'active', config_version: 1, updated_at: dateStr(90) },
];
export async function listTiers(): Promise<TierConfig[]> {
  if (USE_MOCK) { await delay(); return TIERS.map((t) => ({ ...t, benefits: [...t.benefits] })); }
  return getJson<TierConfig[]>('/tiers');
}
export async function updateTier(id: string, patch: TierUpdate): Promise<TierResult> {
  if (USE_MOCK) {
    await delay();
    const cur = TIERS.find((t) => t.id === id);
    return { id, config_version: (cur?.config_version ?? 1) + 1, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Tier ${id} config updated. Members re-evaluated on next earn. Recorded to immutable audit (NL-12).` };
  }
  return sendJson<TierResult>('PATCH', `/tiers/${id}`, patch);
}

// ════════════════════════════════════════════════════════════════════════════
// D · Rewards catalog — CRUD
// ════════════════════════════════════════════════════════════════════════════
const CATALOG: CatalogItem[] = [
  { id: 'cat_air500', name: '₦500 Airtime', kind: 'airtime', cost_points: 1_000, cash_value_kobo: 500_00, stock: -1, redeemed: 18_420, status: 'active', updated_at: dateStr(30) },
  { id: 'cat_dstv', name: 'DStv Compact Bill Credit', kind: 'bill_credit', cost_points: 19_000, cash_value_kobo: 9_500_00, stock: -1, redeemed: 2_140, status: 'active', updated_at: iso(7) },
  { id: 'cat_tkt10', name: '10% Ticket Discount', kind: 'ticket_discount', cost_points: 4_000, cash_value_kobo: 0, stock: -1, redeemed: 6_310, status: 'active', updated_at: dateStr(15) },
  { id: 'cat_lounge', name: 'Event Lounge Perk', kind: 'perk', cost_points: 50_000, cash_value_kobo: 0, stock: 200, redeemed: 88, status: 'active', updated_at: dateStr(5) },
  { id: 'cat_air2k', name: '₦2,000 Airtime', kind: 'airtime', cost_points: 4_000, cash_value_kobo: 2_000_00, stock: -1, redeemed: 9_870, status: 'active', updated_at: dateStr(22) },
  { id: 'cat_draft', name: 'Cinema Voucher (draft)', kind: 'perk', cost_points: 12_000, cash_value_kobo: 0, stock: 500, redeemed: 0, status: 'draft', updated_at: dateStr(1) },
];
export async function listCatalog(opts?: { kind?: string; status?: string; q?: string }): Promise<CatalogItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CATALOG];
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CatalogItem[]>(`/catalog${qs.toString() ? `?${qs}` : ''}`);
}
export async function upsertCatalogItem(item: CatalogUpsert): Promise<CatalogResult> {
  if (USE_MOCK) {
    await delay();
    const id = item.id ?? `cat_${Math.random().toString(36).slice(2, 8)}`;
    return { id, audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Catalog item ${id} ${item.id ? 'updated' : 'created'}. Redeems to non-cash value only (NL-4). Recorded to immutable audit (NL-12).` };
  }
  return sendJson<CatalogResult>(item.id ? 'PATCH' : 'POST', item.id ? `/catalog/${item.id}` : '/catalog', item);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Redemptions log + fraud
// ════════════════════════════════════════════════════════════════════════════
const REDEMPTIONS: RedemptionRecord[] = [
  { id: 'rdm_9001', member_masked: 'Chioma A•••', item_name: '₦2,000 Airtime', kind: 'airtime', cost_points: 4_000, cash_value_kobo: 2_000_00, status: 'flagged', fraud_flag: true, fraud_reason: 'Velocity: 8 redemptions in 10 minutes', created_at: iso(0.4) },
  { id: 'rdm_8990', member_masked: 'Tunde B•••', item_name: 'DStv Compact Bill Credit', kind: 'bill_credit', cost_points: 19_000, cash_value_kobo: 9_500_00, status: 'completed', fraud_flag: false, fraud_reason: null, created_at: iso(1.1) },
  { id: 'rdm_8841', member_masked: 'Aisha M•••', item_name: '10% Ticket Discount', kind: 'ticket_discount', cost_points: 4_000, cash_value_kobo: 0, status: 'completed', fraud_flag: false, fraud_reason: null, created_at: iso(2.4) },
  { id: 'rdm_8720', member_masked: 'Emeka O•••', item_name: 'Event Lounge Perk', kind: 'perk', cost_points: 50_000, cash_value_kobo: 0, status: 'pending', fraud_flag: false, fraud_reason: null, created_at: iso(5) },
  { id: 'rdm_8650', member_masked: 'Ngozi U•••', item_name: '₦500 Airtime', kind: 'airtime', cost_points: 1_000, cash_value_kobo: 500_00, status: 'reversed', fraud_flag: true, fraud_reason: 'Reversal abuse pattern — redeem then dispute', created_at: iso(9) },
];
export async function listRedemptions(opts?: { status?: string; kind?: string; fraud?: boolean; q?: string }): Promise<RedemptionRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...REDEMPTIONS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.fraud) rows = rows.filter((r) => r.fraud_flag);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.member_masked.toLowerCase().includes(q) || r.item_name.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.fraud) qs.set('fraud', '1');
  if (opts?.q) qs.set('q', opts.q);
  return getJson<RedemptionRecord[]>(`/redemptions${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// F · Liability + expiry dashboard (NL-4)
// ════════════════════════════════════════════════════════════════════════════
const LIABILITY: PointsLiability = {
  generated_at: iso(0.2),
  points_outstanding: 482_400_000,
  total_valuation_kobo: 241_200_000_00,
  redemption_value_kobo: 50,
  breakage_rate: 0.18,
  ledger_points: 482_400_000,
  projected_points: 482_400_000,
  delta_points: 0,
  buckets: [
    { bucket: '0-30d', points: 12_400_000, valuation_kobo: 6_200_000_00, expiring: true },
    { bucket: '31-90d', points: 84_600_000, valuation_kobo: 42_300_000_00, expiring: false },
    { bucket: '91-180d', points: 168_200_000, valuation_kobo: 84_100_000_00, expiring: false },
    { bucket: '180d+', points: 217_200_000, valuation_kobo: 108_600_000_00, expiring: false },
  ],
};
export async function getPointsLiability(): Promise<PointsLiability> {
  if (USE_MOCK) { await delay(); return { ...LIABILITY, buckets: [...LIABILITY.buckets] }; }
  return getJson<PointsLiability>('/liability');
}
