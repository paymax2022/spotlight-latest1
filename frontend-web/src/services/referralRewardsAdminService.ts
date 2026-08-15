// ── Direct Referral Rewards — admin service (ADR-022) ─────────────────────────
// Mock by default (mirrors referralAdminService / connectAdminService). Flip with
// NEXT_PUBLIC_REFERRAL_REWARDS_USE_MOCK=false to hit the live Go backend at the
// admin mount /v1/admin/referrals. env.apiBaseUrl already ends in /api/v1, so we
// append /admin/referrals → /api/v1/admin/referrals (proxied to the Go backend's
// /v1/admin/referrals group). Bearer token + RBAC referral.admin.* on the server;
// the sidebar gates the nav entries. Money is BIGINT kobo throughout.

import { env } from '@/config/env';
import type {
  ProgramConfig,
  ConfigPublishInput,
  ConfigPublishResult,
  ReferralAnalytics,
  FraudFlag,
  FraudActionInput,
  Reward,
  LedgerFilters,
  ReferrerCase,
  CaseAdjustmentInput,
  MilestonePayout,
  ModuleStatus,
} from '@/types/referralRewardsAdmin';

const USE_MOCK =
  (process.env.NEXT_PUBLIC_REFERRAL_REWARDS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  // env.apiBaseUrl = http://host/api/v1 → http://host/api/v1/admin/referrals
  return `${env.apiBaseUrl.replace(/\/$/, '')}/admin/referrals`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method,
    headers: { ...authHeaders(), ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Display helper: kobo → ₦ ─────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// ─── Mock datasets ────────────────────────────────────────────────────────────
const MOCK_CONFIG: ProgramConfig = {
  version: 3,
  is_active: true,
  effective_from: iso(24 * 30),
  tier_table: [
    { tier: 'STARTER', min_count: 1, max_count: 49, rate: 0.05 },
    { tier: 'GROWTH', min_count: 50, max_count: 249, rate: 0.08 },
    { tier: 'PRO', min_count: 250, max_count: 999, rate: 0.12 },
    { tier: 'ELITE', min_count: 1000, max_count: null, rate: 0.15 },
  ],
  milestone_table: [
    { threshold: 10, bonus_kobo: 5_000_00 },
    { threshold: 50, bonus_kobo: 20_000_00 },
    { threshold: 250, bonus_kobo: 100_000_00 },
    { threshold: 1000, bonus_kobo: 500_000_00 },
  ],
};

const MOCK_ANALYTICS: ReferralAnalytics = {
  active_referrers: 3120,
  active_referred_users: 18_940,
  total_rewards_paid_kobo: 9_420_000_00,
  total_margin_kobo: 118_500_000_00,
  reward_cost_pct: 7.95,
  by_module: [
    { module: 'bills', reward_kobo: 4_100_000_00, reward_count: 12_400, last_event_at: iso(1) },
    { module: 'marketplace', reward_kobo: 3_020_000_00, reward_count: 6_210, last_event_at: iso(2) },
    { module: 'insurance', reward_kobo: 1_180_000_00, reward_count: 940, last_event_at: iso(9) },
    { module: 'transport', reward_kobo: 720_000_00, reward_count: 3_050, last_event_at: iso(4) },
    { module: 'edtech', reward_kobo: 400_000_00, reward_count: 610, last_event_at: iso(30) },
  ],
  by_tier: [
    { tier: 'STARTER', referrer_count: 2540 },
    { tier: 'GROWTH', referrer_count: 470 },
    { tier: 'PRO', referrer_count: 98 },
    { tier: 'ELITE', referrer_count: 12 },
  ],
};

const MOCK_REWARDS: Reward[] = [
  { id: 'rrw_5001', referrer_id: 'usr_a12', referred_user_id: 'usr_b88', source_transaction_id: 'txn_90011', module: 'bills', margin_amount_kobo: 40_000, applied_rate: 0.08, reward_amount_kobo: 3_200, status: 'CREDITED', created_at: iso(1), credited_at: iso(1), reversed_at: null },
  { id: 'rrw_5002', referrer_id: 'usr_a12', referred_user_id: 'usr_c10', source_transaction_id: 'txn_90015', module: 'marketplace', margin_amount_kobo: 120_000, applied_rate: 0.08, reward_amount_kobo: 9_600, status: 'PENDING', created_at: iso(3), credited_at: null, reversed_at: null },
  { id: 'rrw_5003', referrer_id: 'usr_x77', referred_user_id: 'usr_y22', source_transaction_id: 'txn_89900', module: 'insurance', margin_amount_kobo: 500_000, applied_rate: 0.05, reward_amount_kobo: 25_000, status: 'REVERSED', created_at: iso(36), credited_at: iso(35), reversed_at: iso(4) },
  { id: 'rrw_5004', referrer_id: 'usr_e44', referred_user_id: 'usr_f55', source_transaction_id: 'txn_90100', module: 'transport', margin_amount_kobo: 15_000, applied_rate: 0.12, reward_amount_kobo: 1_800, status: 'CREDITED', created_at: iso(12), credited_at: iso(12), reversed_at: null },
];

const MOCK_CASE: ReferrerCase = {
  referrer_id: 'usr_a12',
  tier: { referrer_id: 'usr_a12', active_referral_count: 62, current_tier: 'GROWTH', current_rate: 0.08, last_recalculated_at: iso(8) },
  rewards: MOCK_REWARDS.filter((r) => r.referrer_id === 'usr_a12'),
  milestones: [
    { id: 'ms_1', referrer_id: 'usr_a12', threshold: 10, bonus_kobo: 5_000_00, status: 'PAID', achieved_at: iso(24 * 20), paid_at: iso(24 * 20), voided_at: null },
    { id: 'ms_2', referrer_id: 'usr_a12', threshold: 50, bonus_kobo: 20_000_00, status: 'PAID', achieved_at: iso(24 * 6), paid_at: iso(24 * 6), voided_at: null },
  ],
};

const MOCK_MILESTONES: MilestonePayout[] = [
  { id: 'ms_2', referrer_id: 'usr_a12', threshold: 50, bonus_kobo: 20_000_00, status: 'PAID', achieved_at: iso(24 * 6), paid_at: iso(24 * 6), voided_at: null },
  { id: 'ms_9', referrer_id: 'usr_x77', threshold: 250, bonus_kobo: 100_000_00, status: 'PAID', achieved_at: iso(24 * 12), paid_at: iso(24 * 12), voided_at: null },
  { id: 'ms_11', referrer_id: 'usr_e44', threshold: 10, bonus_kobo: 5_000_00, status: 'VOIDED', achieved_at: iso(24 * 3), paid_at: null, voided_at: iso(24 * 2) },
];

const MOCK_MODULE_STATUS: ModuleStatus[] = MOCK_ANALYTICS.by_module.map((m) => ({ ...m }));

// ─── A1 Program config ────────────────────────────────────────────────────────
export async function getProgramConfig(): Promise<ProgramConfig> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(MOCK_CONFIG)); }
  return getJson<ProgramConfig>('/config');
}
export async function publishProgramConfig(input: ConfigPublishInput): Promise<ConfigPublishResult> {
  if (USE_MOCK) {
    await delay();
    return {
      config: { ...MOCK_CONFIG, ...input, version: MOCK_CONFIG.version + 1, effective_from: input.effective_from ?? new Date().toISOString() },
      warning: 'Changes apply to future transactions only — already-computed rewards are never recomputed.',
    };
  }
  // Config publish is not a money mutation, but the backend versions forward-only.
  return sendJson<ConfigPublishResult>('PUT', '/config', input);
}

// ─── A2 Analytics ─────────────────────────────────────────────────────────────
export async function getAnalytics(): Promise<ReferralAnalytics> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(MOCK_ANALYTICS)); }
  return getJson<ReferralAnalytics>('/analytics');
}

// ─── A3 Fraud queue ───────────────────────────────────────────────────────────
export async function getFraudQueue(status?: string): Promise<FraudFlag[]> {
  if (USE_MOCK) { await delay(); return []; } // backend returns empty queue initially
  const j = await getJson<{ flags: FraudFlag[] }>(`/fraud-queue${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  return j.flags ?? [];
}
export async function actionFraudFlag(input: FraudActionInput): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<{ ok: true }>('POST', '/fraud-queue', input);
}

// ─── A4 Ledger ────────────────────────────────────────────────────────────────
export async function getLedger(filters?: LedgerFilters): Promise<Reward[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...MOCK_REWARDS];
    if (filters?.status && filters.status !== 'all') rows = rows.filter((r) => r.status === filters.status);
    if (filters?.module && filters.module !== 'all') rows = rows.filter((r) => r.module === filters.module);
    return rows;
  }
  const qs = new URLSearchParams();
  if (filters?.status && filters.status !== 'all') qs.set('status', filters.status);
  if (filters?.module && filters.module !== 'all') qs.set('module', filters.module);
  if (filters?.limit != null) qs.set('limit', String(filters.limit));
  if (filters?.offset != null) qs.set('offset', String(filters.offset));
  const q = qs.toString();
  const j = await getJson<{ ledger: Reward[] }>(`/ledger${q ? `?${q}` : ''}`);
  return j.ledger ?? [];
}

// ─── A5 Referrer case ─────────────────────────────────────────────────────────
export async function getReferrerCase(referrerId: string): Promise<ReferrerCase> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify({ ...MOCK_CASE, referrer_id: referrerId })); }
  return getJson<ReferrerCase>(`/${encodeURIComponent(referrerId)}/case`);
}
export async function adjustReferrerCase(referrerId: string, input: CaseAdjustmentInput): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Money mutation: backend requires an Idempotency-Key + audit event.
  return sendJson<{ ok: true }>('POST', `/${encodeURIComponent(referrerId)}/case`, input, {
    'Idempotency-Key': crypto.randomUUID(),
  });
}

// ─── A6 Milestone log ─────────────────────────────────────────────────────────
export async function getMilestonesLog(limit = 50, offset = 0): Promise<MilestonePayout[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_MILESTONES]; }
  const j = await getJson<{ milestones: MilestonePayout[] }>(`/milestones-log?limit=${limit}&offset=${offset}`);
  return j.milestones ?? [];
}

// ─── A7 Module status ─────────────────────────────────────────────────────────
export async function getModuleStatus(): Promise<ModuleStatus[]> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(MOCK_MODULE_STATUS)); }
  const j = await getJson<{ modules: ModuleStatus[] }>('/module-status');
  return j.modules ?? [];
}
