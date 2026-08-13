// ── Admin — central Commission & Profit module service ────────────────────────
// Copies the staysAdminService.ts / academyAdminService.ts request stack EXACTLY:
//  • financeBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/finance
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson throw on non-2xx; the commission handler wraps payloads in a
//    { success, ... } envelope (NOT { data }), so each caller reads its named field.
//
// Backend: backend/internal/finance/commission/{handler.go,model.go}. All money is
// integer minor units (kobo); all rates are integer basis points (bps). The UI shows
// ₦ (kobo/100) and % (bps/100) but ALWAYS converts back to integer kobo/bps on submit
// (see toBps/toKobo) — floats never cross the wire for money.

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_COMMISSION_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Domain types (mirror commission/model.go JSON tags — camelCase) ───────────
export type FeeModel = 'commission' | 'platform_charge' | 'fixed' | 'commission_plus_fee' | 'none';
export type FeePayer = 'customer' | 'provider' | 'merchant' | 'none';

export const FEE_MODELS: FeeModel[] = ['commission', 'platform_charge', 'fixed', 'commission_plus_fee', 'none'];
export const FEE_PAYERS: FeePayer[] = ['customer', 'provider', 'merchant', 'none'];

// Known seed categories (free-form on the backend — new modules can add their own).
export const SERVICE_CATEGORIES = ['Utility_Bills', 'Lifestyle', 'Finance', 'Health', 'Community', 'Property', 'Contest'] as const;

export interface Config {
  id: string;
  serviceCategory: string;
  service: string;
  serviceSubtype: string;
  feeModel: string;
  commissionBps: number;
  platformChargeBps: number;
  convenienceFeeKobo: number;
  fixedFeeKobo: number;
  feePayer: string;
  currency: string;
  active: boolean;
  notes?: string;
  updatedBy?: string | null;
  updatedAt: string;
  createdAt: string;
}

// Sent to POST/PUT. Money/rates are already integer kobo/bps (converted in the UI).
export interface ConfigInput {
  serviceCategory: string;
  service: string;
  serviceSubtype?: string;
  feeModel?: string;
  commissionBps?: number;
  platformChargeBps?: number;
  convenienceFeeKobo?: number;
  fixedFeeKobo?: number;
  feePayer?: string;
  currency?: string;
  active?: boolean;
  notes?: string;
}

export interface ConfigList {
  flat: Config[];
  grouped: Record<string, Config[]>;
}

export interface ReportRow {
  groupBy: string;
  groupKey: string;
  serviceCategory?: string;
  service?: string;
  day?: string;
  count: number;
  grossAmountKobo: number;
  commissionKobo: number;
  platformChargeKobo: number;
  convenienceFeeKobo: number;
  fixedFeeKobo: number;
  spotlightRevenueKobo: number;
}

export interface Earning {
  id: string;
  configId?: string | null;
  serviceCategory: string;
  service: string;
  serviceSubtype: string;
  grossAmountKobo: number;
  commissionKobo: number;
  platformChargeKobo: number;
  convenienceFeeKobo: number;
  fixedFeeKobo: number;
  spotlightRevenueKobo: number;
  currency: string;
  sourceModule: string;
  sourceRef: string;
  ledgerRef?: string | null;
  userId?: string | null;
  createdAt: string;
}

export type GroupBy = 'category' | 'service' | 'day';

// ── Request stack ─────────────────────────────────────────────────────────────
function financeBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

async function getRaw<T>(path: string): Promise<T> {
  const res = await fetch(`${financeBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}
async function sendRaw<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${financeBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

// ── Money / rate conversion helpers (integer-safe) ────────────────────────────
// bps = round(pct * 100); kobo = round(naira * 100). Never emit floats for money.
export function pctToBps(pct: number): number { return Math.round((Number(pct) || 0) * 100); }
export function bpsToPct(bps: number): number { return (Number(bps) || 0) / 100; }
export function nairaToKobo(naira: number): number { return Math.round((Number(naira) || 0) * 100); }
export function koboToNaira(kobo: number): number { return (Number(kobo) || 0) / 100; }

export function formatNaira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatPct(bps: number): string {
  return `${bpsToPct(bps).toLocaleString('en-NG', { maximumFractionDigits: 2 })}%`;
}

// ── Mock fixtures (mirror the seed rate card) ─────────────────────────────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const MOCK_CONFIGS: Config[] = [
  { id: 'cfg_util_elec', serviceCategory: 'Utility_Bills', service: 'electricity', serviceSubtype: 'prepaid', feeModel: 'commission_plus_fee', commissionBps: 150, platformChargeBps: 0, convenienceFeeKobo: 5000, fixedFeeKobo: 0, feePayer: 'customer', currency: 'NGN', active: true, notes: 'Disco token purchase', updatedBy: null, updatedAt: iso(30), createdAt: iso(2000) },
  { id: 'cfg_util_airt', serviceCategory: 'Utility_Bills', service: 'airtime', serviceSubtype: '', feeModel: 'commission', commissionBps: 200, platformChargeBps: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, feePayer: 'provider', currency: 'NGN', active: true, notes: '', updatedBy: null, updatedAt: iso(40), createdAt: iso(2100) },
  { id: 'cfg_util_data', serviceCategory: 'Utility_Bills', service: 'data', serviceSubtype: '', feeModel: 'commission', commissionBps: 250, platformChargeBps: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, feePayer: 'provider', currency: 'NGN', active: true, notes: '', updatedBy: null, updatedAt: iso(50), createdAt: iso(2100) },
  { id: 'cfg_life_food', serviceCategory: 'Lifestyle', service: 'restaurant_delivery', serviceSubtype: '', feeModel: 'commission_plus_fee', commissionBps: 1200, platformChargeBps: 0, convenienceFeeKobo: 15000, fixedFeeKobo: 0, feePayer: 'merchant', currency: 'NGN', active: true, notes: 'Merchant commission + customer delivery convenience fee', updatedBy: null, updatedAt: iso(12), createdAt: iso(1800) },
  { id: 'cfg_fin_transfer', serviceCategory: 'Finance', service: 'transfer', serviceSubtype: 'p2p', feeModel: 'fixed', commissionBps: 0, platformChargeBps: 0, convenienceFeeKobo: 0, fixedFeeKobo: 1000, feePayer: 'customer', currency: 'NGN', active: true, notes: 'Flat ₦10 P2P', updatedBy: null, updatedAt: iso(8), createdAt: iso(1500) },
  { id: 'cfg_fin_fx', serviceCategory: 'Finance', service: 'fx', serviceSubtype: '', feeModel: 'platform_charge', commissionBps: 0, platformChargeBps: 75, convenienceFeeKobo: 0, fixedFeeKobo: 0, feePayer: 'customer', currency: 'NGN', active: true, notes: 'FX spread margin', updatedBy: null, updatedAt: iso(20), createdAt: iso(1400) },
  { id: 'cfg_health_pharm', serviceCategory: 'Health', service: 'pharmacy', serviceSubtype: '', feeModel: 'commission', commissionBps: 800, platformChargeBps: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, feePayer: 'merchant', currency: 'NGN', active: true, notes: '', updatedBy: null, updatedAt: iso(60), createdAt: iso(1200) },
  { id: 'cfg_comm_ajo', serviceCategory: 'Community', service: 'ajo', serviceSubtype: '', feeModel: 'platform_charge', commissionBps: 0, platformChargeBps: 100, convenienceFeeKobo: 0, fixedFeeKobo: 0, feePayer: 'customer', currency: 'NGN', active: false, notes: 'Paused pending review', updatedBy: null, updatedAt: iso(90), createdAt: iso(1000) },
  { id: 'cfg_prop_dues', serviceCategory: 'Property', service: 'estate_dues', serviceSubtype: '', feeModel: 'fixed', commissionBps: 0, platformChargeBps: 0, convenienceFeeKobo: 0, fixedFeeKobo: 5000, feePayer: 'customer', currency: 'NGN', active: true, notes: '', updatedBy: null, updatedAt: iso(120), createdAt: iso(900) },
  { id: 'cfg_contest_vote', serviceCategory: 'Contest', service: 'voting', serviceSubtype: '', feeModel: 'commission', commissionBps: 3000, platformChargeBps: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, feePayer: 'customer', currency: 'NGN', active: true, notes: 'Vote pack revenue share', updatedBy: null, updatedAt: iso(5), createdAt: iso(800) },
];

function mockGroup(flat: Config[]): ConfigList {
  const grouped: Record<string, Config[]> = {};
  for (const c of flat) (grouped[c.serviceCategory] ??= []).push(c);
  return { flat, grouped };
}

const MOCK_REPORT_CATEGORY: ReportRow[] = [
  { groupBy: 'category', groupKey: 'Utility_Bills', serviceCategory: 'Utility_Bills', count: 18420, grossAmountKobo: 921_000_000, commissionKobo: 18_420_000, platformChargeKobo: 0, convenienceFeeKobo: 4_210_000, fixedFeeKobo: 0, spotlightRevenueKobo: 22_630_000 },
  { groupBy: 'category', groupKey: 'Lifestyle', serviceCategory: 'Lifestyle', count: 6210, grossAmountKobo: 310_500_000, commissionKobo: 37_260_000, platformChargeKobo: 0, convenienceFeeKobo: 9_315_000, fixedFeeKobo: 0, spotlightRevenueKobo: 46_575_000 },
  { groupBy: 'category', groupKey: 'Finance', serviceCategory: 'Finance', count: 28900, grossAmountKobo: 1_445_000_000, commissionKobo: 0, platformChargeKobo: 8_120_000, convenienceFeeKobo: 0, fixedFeeKobo: 2_890_000, spotlightRevenueKobo: 11_010_000 },
  { groupBy: 'category', groupKey: 'Health', serviceCategory: 'Health', count: 2140, grossAmountKobo: 128_400_000, commissionKobo: 10_272_000, platformChargeKobo: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 10_272_000 },
  { groupBy: 'category', groupKey: 'Contest', serviceCategory: 'Contest', count: 41200, grossAmountKobo: 206_000_000, commissionKobo: 61_800_000, platformChargeKobo: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 61_800_000 },
];

const MOCK_REPORT_SERVICE: ReportRow[] = [
  { groupBy: 'service', groupKey: 'Contest / voting', serviceCategory: 'Contest', service: 'voting', count: 41200, grossAmountKobo: 206_000_000, commissionKobo: 61_800_000, platformChargeKobo: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 61_800_000 },
  { groupBy: 'service', groupKey: 'Lifestyle / restaurant_delivery', serviceCategory: 'Lifestyle', service: 'restaurant_delivery', count: 6210, grossAmountKobo: 310_500_000, commissionKobo: 37_260_000, platformChargeKobo: 0, convenienceFeeKobo: 9_315_000, fixedFeeKobo: 0, spotlightRevenueKobo: 46_575_000 },
  { groupBy: 'service', groupKey: 'Utility_Bills / electricity', serviceCategory: 'Utility_Bills', service: 'electricity', count: 9210, grossAmountKobo: 552_600_000, commissionKobo: 8_289_000, platformChargeKobo: 0, convenienceFeeKobo: 4_605_000, fixedFeeKobo: 0, spotlightRevenueKobo: 12_894_000 },
  { groupBy: 'service', groupKey: 'Health / pharmacy', serviceCategory: 'Health', service: 'pharmacy', count: 2140, grossAmountKobo: 128_400_000, commissionKobo: 10_272_000, platformChargeKobo: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 10_272_000 },
  { groupBy: 'service', groupKey: 'Finance / fx', serviceCategory: 'Finance', service: 'fx', count: 12400, grossAmountKobo: 992_000_000, commissionKobo: 0, platformChargeKobo: 7_440_000, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 7_440_000 },
];

function mockReportDay(): ReportRow[] {
  const rows: ReportRow[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const base = 4_000_000 + Math.round(Math.sin(i / 3) * 1_200_000) + (i % 4) * 300_000;
    rows.push({ groupBy: 'day', groupKey: day, day, count: 3000 + (i % 7) * 220, grossAmountKobo: base * 20, commissionKobo: Math.round(base * 0.6), platformChargeKobo: Math.round(base * 0.15), convenienceFeeKobo: Math.round(base * 0.2), fixedFeeKobo: Math.round(base * 0.05), spotlightRevenueKobo: base });
  }
  return rows;
}

const MOCK_EARNINGS: Earning[] = [
  { id: 'ern_1', configId: 'cfg_contest_vote', serviceCategory: 'Contest', service: 'voting', serviceSubtype: '', grossAmountKobo: 500000, commissionKobo: 150000, platformChargeKobo: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 150000, currency: 'NGN', sourceModule: 'contest', sourceRef: 'vote_9981', ledgerRef: 'led_aa01', userId: 'usr_aa01', createdAt: iso(1) },
  { id: 'ern_2', configId: 'cfg_life_food', serviceCategory: 'Lifestyle', service: 'restaurant_delivery', serviceSubtype: '', grossAmountKobo: 800000, commissionKobo: 96000, platformChargeKobo: 0, convenienceFeeKobo: 15000, fixedFeeKobo: 0, spotlightRevenueKobo: 111000, currency: 'NGN', sourceModule: 'restaurant', sourceRef: 'ord_5521', ledgerRef: 'led_bb02', userId: 'usr_bb02', createdAt: iso(3) },
  { id: 'ern_3', configId: 'cfg_util_elec', serviceCategory: 'Utility_Bills', service: 'electricity', serviceSubtype: 'prepaid', grossAmountKobo: 1000000, commissionKobo: 15000, platformChargeKobo: 0, convenienceFeeKobo: 5000, fixedFeeKobo: 0, spotlightRevenueKobo: 20000, currency: 'NGN', sourceModule: 'bills', sourceRef: 'bill_7742', ledgerRef: 'led_cc03', userId: 'usr_cc03', createdAt: iso(6) },
  { id: 'ern_4', configId: 'cfg_fin_fx', serviceCategory: 'Finance', service: 'fx', serviceSubtype: '', grossAmountKobo: 5000000, commissionKobo: 0, platformChargeKobo: 37500, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 37500, currency: 'NGN', sourceModule: 'fx', sourceRef: 'fx_3310', ledgerRef: 'led_dd04', userId: 'usr_dd04', createdAt: iso(9) },
  { id: 'ern_5', configId: 'cfg_health_pharm', serviceCategory: 'Health', service: 'pharmacy', serviceSubtype: '', grossAmountKobo: 1200000, commissionKobo: 96000, platformChargeKobo: 0, convenienceFeeKobo: 0, fixedFeeKobo: 0, spotlightRevenueKobo: 96000, currency: 'NGN', sourceModule: 'health', sourceRef: 'rx_2201', ledgerRef: 'led_ee05', userId: 'usr_ee05', createdAt: iso(14) },
];

// ── API ───────────────────────────────────────────────────────────────────────
// GET /finance/commission/config → { success, configs, grouped, count }
export async function listConfig(opts?: { category?: string; activeOnly?: boolean }): Promise<ConfigList> {
  if (USE_MOCK) {
    await delay();
    let flat = MOCK_CONFIGS.map((c) => ({ ...c }));
    if (opts?.category) flat = flat.filter((c) => c.serviceCategory === opts.category);
    if (opts?.activeOnly) flat = flat.filter((c) => c.active);
    return mockGroup(flat);
  }
  const qs = new URLSearchParams();
  if (opts?.category) qs.set('category', opts.category);
  if (opts?.activeOnly) qs.set('active', 'true');
  const q = qs.toString();
  const j = await getRaw<{ configs?: Config[]; grouped?: Record<string, Config[]> }>(`/commission/config${q ? `?${q}` : ''}`);
  const flat = j.configs ?? [];
  return { flat, grouped: j.grouped ?? mockGroup(flat).grouped };
}

// POST /finance/commission/config → { success, config }
export async function createConfig(input: ConfigInput): Promise<Config> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `cfg_${Date.now()}`, serviceCategory: input.serviceCategory, service: input.service,
      serviceSubtype: input.serviceSubtype ?? '', feeModel: input.feeModel ?? 'none',
      commissionBps: input.commissionBps ?? 0, platformChargeBps: input.platformChargeBps ?? 0,
      convenienceFeeKobo: input.convenienceFeeKobo ?? 0, fixedFeeKobo: input.fixedFeeKobo ?? 0,
      feePayer: input.feePayer ?? 'none', currency: input.currency ?? 'NGN', active: input.active ?? true,
      notes: input.notes ?? '', updatedBy: null, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    };
  }
  const j = await sendRaw<{ config: Config }>('POST', '/commission/config', input);
  return j.config;
}

// PUT /finance/commission/config/:id → { success, config }
export async function updateConfig(id: string, input: ConfigInput): Promise<Config> {
  if (USE_MOCK) {
    await delay();
    const base = MOCK_CONFIGS.find((c) => c.id === id) ?? MOCK_CONFIGS[0];
    return { ...base, ...input, serviceSubtype: input.serviceSubtype ?? base.serviceSubtype, notes: input.notes ?? base.notes, updatedAt: new Date().toISOString() } as Config;
  }
  const j = await sendRaw<{ config: Config }>('PUT', `/commission/config/${id}`, input);
  return j.config;
}

// POST /finance/commission/config/:id/toggle → { success, config }
export async function toggleConfig(id: string, active: boolean): Promise<Config> {
  if (USE_MOCK) {
    await delay();
    const base = MOCK_CONFIGS.find((c) => c.id === id) ?? MOCK_CONFIGS[0];
    return { ...base, active, updatedAt: new Date().toISOString() };
  }
  const j = await sendRaw<{ config: Config }>('POST', `/commission/config/${id}/toggle`, { active });
  return j.config;
}

// GET /finance/commission/report?from&to&groupBy → { success, rows }
export async function getReport(opts: { from?: string; to?: string; groupBy: GroupBy }): Promise<ReportRow[]> {
  if (USE_MOCK) {
    await delay();
    if (opts.groupBy === 'service') return MOCK_REPORT_SERVICE.map((r) => ({ ...r }));
    if (opts.groupBy === 'day') return mockReportDay();
    return MOCK_REPORT_CATEGORY.map((r) => ({ ...r }));
  }
  const qs = new URLSearchParams({ groupBy: opts.groupBy });
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  const j = await getRaw<{ rows?: ReportRow[] }>(`/commission/report?${qs.toString()}`);
  return j.rows ?? [];
}

// GET /finance/commission/earnings?from&to&category&limit → { success, earnings }
export async function listEarnings(opts?: { from?: string; to?: string; category?: string; limit?: number }): Promise<Earning[]> {
  if (USE_MOCK) {
    await delay();
    let rows = MOCK_EARNINGS.map((e) => ({ ...e }));
    if (opts?.category) rows = rows.filter((e) => e.serviceCategory === opts.category);
    if (opts?.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.from) qs.set('from', opts.from);
  if (opts?.to) qs.set('to', opts.to);
  if (opts?.category) qs.set('category', opts.category);
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  const j = await getRaw<{ earnings?: Earning[] }>(`/commission/earnings${q ? `?${q}` : ''}`);
  return j.earnings ?? [];
}
