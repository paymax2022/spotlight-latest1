// ── Direct Referral Rewards — API layer ──────────────────────────────────────
// Mock-first (USE_MOCK, default ON). Live path hits `${API_BASE}/...` via the
// shared axios client, which the frontend-web catch-all proxy forwards to the
// Go engine at /v1/referrals/*. Responses are snake_case and unwrapped from the
// Go `{ data: ... }` envelope. All money is kobo (minor units).

import { api } from '@/api/client';
import { USE_MOCK, API_BASE, TIER_TABLE, MILESTONE_TABLE, tierDef } from './constants';
import type {
  ReferralLink,
  AttributionResult,
  ReferralDashboard,
  ReferralsPage,
  EarningsPage,
  MilestonesResponse,
  ReferredUser,
  RewardEntry,
  PageParams,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Unwrap the Go-backend envelope ({ data: ... }); tolerate a bare body too.
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// State-changing calls carry an Idempotency-Key (CLAUDE.md iron rule; the proxy
// forwards it verbatim). attribute is idempotent per user; link is safe to retry.
function idempotencyKey(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const daysAgo  = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// ── Mock fixtures (field names match the real backend shape exactly) ─────────
const MOCK_CODE = 'AMARA-2K6';
const MOCK_LINK = `https://spotlight.ng/j/${MOCK_CODE}`;

// Active count of 47 → Growth is the *next* tier at 50; sits mid-Starter with
// the ₦20,000 milestone 3 away — matches the PRD's "47 of 50" example so the
// hub/next-milestone copy renders the intended emotional beat.
const MOCK_ACTIVE_COUNT = 47;

function mockDashboard(): ReferralDashboard {
  const tier = tierDef('STARTER');
  return {
    code: MOCK_CODE,
    current_tier: 'STARTER',
    current_rate: tier.rate,
    active_referral_count: MOCK_ACTIVE_COUNT,
    this_month_earned_kobo: 4_235_000,   // ₦42,350
    lifetime_earned_kobo: 18_940_000,    // ₦189,400
    next_milestone: { threshold: 50, bonus_kobo: 2_000_000, remaining: 50 - MOCK_ACTIVE_COUNT },
  };
}

const MOCK_REFERRALS: ReferredUser[] = [
  { referred_user_id: 'u_chi', masked_contact: 'Chidinma • 080****1234', joined_at: daysAgo(58),  active: true,  lifetime_earned_kobo: 3_120_000 },
  { referred_user_id: 'u_tun', masked_contact: 'Tunde • 070****9087',    joined_at: daysAgo(41),  active: true,  lifetime_earned_kobo: 2_540_000 },
  { referred_user_id: 'u_ada', masked_contact: 'Ada • 081****4410',      joined_at: daysAgo(33),  active: true,  lifetime_earned_kobo: 1_980_000 },
  { referred_user_id: 'u_bol', masked_contact: 'Bola • 090****2276',     joined_at: daysAgo(22),  active: false, lifetime_earned_kobo: 640_000 },
  { referred_user_id: 'u_eme', masked_contact: 'Emeka • 080****5531',    joined_at: daysAgo(14),  active: true,  lifetime_earned_kobo: 1_205_000 },
  { referred_user_id: 'u_ngo', masked_contact: 'Ngozi • 070****8842',    joined_at: daysAgo(9),   active: false, lifetime_earned_kobo: 0 },
  { referred_user_id: 'u_yus', masked_contact: 'Yusuf • 081****3390',    joined_at: daysAgo(4),   active: true,  lifetime_earned_kobo: 415_000 },
];

const MOCK_EARNINGS: RewardEntry[] = [
  { id: 'r1', referred_user_id: 'u_chi', source_transaction_id: 'tx_9001', module: 'bills',       margin_kobo: 1_600_000, applied_rate: 0.05, reward_kobo: 80_000,  status: 'CREDITED', config_version: 1, created_at: hoursAgo(3),   credited_at: hoursAgo(3),   reversed_at: null },
  { id: 'r2', referred_user_id: 'u_tun', source_transaction_id: 'tx_8994', module: 'marketplace', margin_kobo: 4_400_000, applied_rate: 0.05, reward_kobo: 220_000, status: 'CREDITED', config_version: 1, created_at: hoursAgo(20),  credited_at: hoursAgo(20),  reversed_at: null },
  { id: 'r3', referred_user_id: 'u_ada', source_transaction_id: 'tx_8871', module: 'insurance',   margin_kobo: 2_000_000, applied_rate: 0.05, reward_kobo: 100_000, status: 'CREDITED', config_version: 1, created_at: daysAgo(2),    credited_at: daysAgo(2),    reversed_at: null },
  { id: 'r4', referred_user_id: 'u_eme', source_transaction_id: 'tx_8790', module: 'transport',   margin_kobo: 900_000,   applied_rate: 0.05, reward_kobo: 45_000,  status: 'PENDING',  config_version: 1, created_at: daysAgo(3),    credited_at: null,          reversed_at: null },
  { id: 'r5', referred_user_id: 'u_bol', source_transaction_id: 'tx_8654', module: 'marketplace', margin_kobo: 3_000_000, applied_rate: 0.05, reward_kobo: 150_000, status: 'REVERSED', config_version: 1, created_at: daysAgo(6),    credited_at: daysAgo(6),    reversed_at: daysAgo(4) },
  { id: 'r6', referred_user_id: 'u_yus', source_transaction_id: 'tx_8510', module: 'bills',       margin_kobo: 700_000,   applied_rate: 0.05, reward_kobo: 35_000,  status: 'CREDITED', config_version: 1, created_at: daysAgo(8),    credited_at: daysAgo(8),    reversed_at: null },
  { id: 'r7', referred_user_id: 'u_chi', source_transaction_id: 'tx_8320', module: 'edtech',      margin_kobo: 1_100_000, applied_rate: 0.05, reward_kobo: 55_000,  status: 'CREDITED', config_version: 1, created_at: daysAgo(12),   credited_at: daysAgo(12),   reversed_at: null },
  { id: 'r8', referred_user_id: 'u_ada', source_transaction_id: 'tx_8180', module: 'connect',     margin_kobo: 500_000,   applied_rate: 0.05, reward_kobo: 25_000,  status: 'CREDITED', config_version: 1, created_at: daysAgo(19),   credited_at: daysAgo(19),   reversed_at: null },
];

function mockMilestones(): MilestonesResponse {
  return {
    achieved: [
      { threshold: 10, bonus_kobo: 500_000, status: 'PAID', paid_at: daysAgo(30) },
    ],
    upcoming: MILESTONE_TABLE.filter((m) => m.threshold > 10).map((m) => ({ threshold: m.threshold, bonus_kobo: m.bonus_kobo })),
  };
}

// ── Code / link ──────────────────────────────────────────────────────────────
export async function getOrCreateLink(): Promise<ReferralLink> {
  if (USE_MOCK) {
    await delay(200);
    return { id: 'link_1', referrer_id: 'u_me', code: MOCK_CODE, created_at: daysAgo(120) };
  }
  return unwrap(await api.post(`${API_BASE}/link`, {}, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

// Called once at signup (referred user side). Idempotent per user; the engine
// 400s on self-referral / unknown code. Silent — no reward is shown here.
export async function attribute(code: string): Promise<AttributionResult> {
  const trimmed = code.trim();
  if (USE_MOCK) {
    await delay(260);
    return { referrer_id: 'u_referrer', referred_user_id: 'u_me' };
  }
  return unwrap(await api.post(`${API_BASE}/attribute`, { code: trimmed }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

// ── Referrer reads (all scoped server-side to the caller — /me/*) ────────────
export async function getDashboard(): Promise<ReferralDashboard> {
  if (USE_MOCK) { await delay(); return mockDashboard(); }
  return unwrap(await api.get(`${API_BASE}/me/dashboard`));
}

export async function listReferrals(params?: PageParams): Promise<ReferralsPage> {
  if (USE_MOCK) {
    await delay();
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? MOCK_REFERRALS.length;
    return { referrals: MOCK_REFERRALS.slice(offset, offset + limit) };
  }
  return unwrap(await api.get(`${API_BASE}/me/referrals`, { params: pageQuery(params) }));
}

export async function listEarnings(params?: PageParams): Promise<EarningsPage> {
  if (USE_MOCK) {
    await delay();
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? MOCK_EARNINGS.length;
    return { earnings: MOCK_EARNINGS.slice(offset, offset + limit) };
  }
  return unwrap(await api.get(`${API_BASE}/me/earnings`, { params: pageQuery(params) }));
}

export async function getMilestones(): Promise<MilestonesResponse> {
  if (USE_MOCK) { await delay(); return mockMilestones(); }
  return unwrap(await api.get(`${API_BASE}/me/milestones`));
}

function pageQuery(params?: PageParams): Record<string, number> {
  const q: Record<string, number> = {};
  if (params?.limit != null)  q.limit = params.limit;
  if (params?.offset != null) q.offset = params.offset;
  return q;
}

// Re-export tier metadata so screens can render the full table without a second
// import path (the engine is config-driven; these are the v1 launch defaults).
export { TIER_TABLE, MILESTONE_TABLE };
