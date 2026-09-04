// ── Referral Admin service (RA1) ─────────────────────────────────────────────
// Mock by default (mirrors connectAdminService). Flip with
// NEXT_PUBLIC_REFERRAL_USE_MOCK=false to hit the live Go backend at
// /api/referral/admin/*. RBAC: referral.* gates wired on the sidebar by the
// orchestrator. Money is BIGINT kobo throughout.

import { env } from '@/config/env';
import type {
  ReferralDashboard,
  ProgramConfig,
  ReferralRole,
  FeatureFlag,
  ReferralAuditEntry,
  AttributionConfig,
  CampaignSummary,
  CampaignDetail,
  CampaignDraft,
  RewardLedgerEntry,
  ManualGrantInput,
  ClawbackInput,
  HouseLedger,
  Reassignment,
  ReassignDecision,
} from '@/types/referralAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_REFERRAL_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/referral/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Verified against the real Go routes: backend/internal/referral/{campaigns,risk,
// attribution}/handlers.go + backend/internal/app/referral_{routes,econ_routes,
// trust_routes}.go. Functions with a real route throw NOT_IN_FIXTURE_MODE;
// functions with no reachable route throw NO_BACKEND_YET instead, since
// flipping the mock flag would not reach a working call either way. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_REFERRAL_USE_MOCK=false to make this change against the live backend.';
const NO_BACKEND_YET =
  'has no backend yet (see the comment on the live-mode call below). ' +
  'This console cannot perform this action until that endpoint is built.';

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

// ─── Mock datasets ────────────────────────────────────────────────────────────
const DASHBOARD: ReferralDashboard = {
  k_factor: 0.42,
  k_factor_incl_house: 0.71,
  referral_cac_kobo: 185_000,
  paid_cac_kobo: 420_000,
  gmv_kobo: 487_350_000_00,
  fraud_rate: 0.018,
  reward_burn_kobo: 12_840_000_00,
  reward_budget_kobo: 25_000_000_00,
  referred_signups: 8420,
  house_signups: 5610,
  activated_rate: 0.61,
  reward_to_ltv_ratio: 0.14,
  trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    referred: 480 + Math.round(Math.sin(i / 2) * 120) + i * 14,
    house: 320 + Math.round(Math.cos(i / 3) * 90) + i * 8,
    burn_kobo: (820_000 + i * 31_000) * 100,
  })),
  activity: [
    { id: 'ev1', label: 'Reward earned — referrer side', kind: 'reward_earned', ref: 'rwd_10231', created_at: iso(1) },
    { id: 'ev2', label: 'No-code signup captured by house', kind: 'house_capture', ref: 'attr_88120', created_at: iso(2) },
    { id: 'ev3', label: 'Clawback executed — duplicate KYC', kind: 'clawback', ref: 'rwd_10044', created_at: iso(4) },
    { id: 'ev4', label: 'Attribution reassigned (late claim)', kind: 'reassignment', ref: 'ra_5521', created_at: iso(7) },
    { id: 'ev5', label: 'Campaign "Lagos Estate Q3" activated', kind: 'campaign', ref: 'cmp_3001', created_at: iso(20) },
  ],
};

const PROGRAM_CONFIG: ProgramConfig = {
  program_enabled: true,
  default_tier: 'Standard',
  tiers: [
    { name: 'Standard', monthly_cap_kobo: 50_000_00, override_pct: 0, disclosure: 'Earnings tied to verified activity only.' },
    { name: 'Ambassador', monthly_cap_kobo: 250_000_00, override_pct: 0, disclosure: 'Vanity codes; no recruitment earnings.' },
    { name: 'Agent', monthly_cap_kobo: 1_000_000_00, override_pct: 5, disclosure: 'Override = % of verified network revenue, capped (§7).' },
  ],
  qualifying_action: 'kyc_plus_first_txn',
  reward_to_ltv_cap_pct: 20,
  welcome_reward_enabled: false,
  updated_at: iso(72),
};

const ROLES: ReferralRole[] = [
  { role: 'Platform Super Admin', scope: 'global', permissions: ['referral.config.manage', 'referral.house.view', 'referral.attribution.reassign', 'referral.ledger.view'] },
  { role: 'Campaign Manager', scope: 'campaign', permissions: ['referral.campaign.manage', 'referral.analytics.view'] },
  { role: 'Finance / Payouts', scope: 'global', permissions: ['referral.ledger.view', 'referral.payout.approve', 'referral.house.view'] },
  { role: 'Risk / Fraud', scope: 'global', permissions: ['referral.risk.manage', 'referral.attribution.reassign'] },
  { role: 'Compliance', scope: 'global', permissions: ['referral.compliance.manage', 'referral.attribution.view', 'referral.house.view'] },
  { role: 'Growth / Analytics', scope: 'global', permissions: ['referral.analytics.view'] },
];

const FLAGS: FeatureFlag[] = [
  { key: 'referral.program', label: 'Referral program', description: 'Master switch for the whole module.', enabled: true, kill_switch: true, phase: 'P1' },
  { key: 'referral.house_capture', label: 'House default-referrer capture', description: 'No-code signups accrue to house account (§7A).', enabled: true, kill_switch: false, phase: 'P1' },
  { key: 'referral.late_claim', label: 'Late code-claim grace window', description: 'Allow post-signup code claims within grace window.', enabled: true, kill_switch: false, phase: 'P1' },
  { key: 'referral.dynamic_rewards', label: 'Dynamic / LTV-priced rewards', description: 'Phase 2 reward pricing engine.', enabled: false, kill_switch: false, phase: 'P2' },
  { key: 'referral.agent_overrides', label: 'Agent activity-based overrides', description: 'Capped overrides on verified network revenue.', enabled: false, kill_switch: false, phase: 'P2' },
  { key: 'referral.merchant_campaigns', label: 'Merchant-funded campaigns', description: 'Referral-as-a-platform (Phase 3).', enabled: false, kill_switch: false, phase: 'P3' },
  { key: 'referral.auto_pause', label: 'Auto-pause on fraud/burn spike', description: 'Emergency budget governor (§7).', enabled: true, kill_switch: true, phase: 'P1' },
];

const AUDIT: ReferralAuditEntry[] = [
  { id: 'au1', actor_id: 'adm_super', actor_role: 'super_admin', action: 'referral.config.update', entity_type: 'referral_config', entity_id: 'singleton', reason: 'Set grace window to 48h', created_at: iso(72) },
  { id: 'au2', actor_id: 'adm_fin', actor_role: 'finance', action: 'referral.reward.manual_grant', entity_type: 'referral_reward_ledger', entity_id: 'rwd_10301', reason: 'Goodwill — disputed claim', created_at: iso(30) },
  { id: 'au3', actor_id: 'adm_risk', actor_role: 'risk', action: 'referral.reward.clawback', entity_type: 'referral_reward_ledger', entity_id: 'rwd_10044', reason: 'Duplicate KYC identity', created_at: iso(4) },
  { id: 'au4', actor_id: 'adm_risk', actor_role: 'risk', action: 'referral.attribution.reassign', entity_type: 'referral_reassignments', entity_id: 'ra_5521', reason: 'Late code claim within grace window', created_at: iso(7) },
];

const ATTRIBUTION_CONFIG: AttributionConfig = {
  attribution_window_hours: 72,
  grace_window_hours: 48,
  fallback_chain: [
    { tier: 'code', label: 'Valid referral code entered', enabled: true },
    { tier: 'deeplink', label: 'Deferred deep-link / click attribution', enabled: true },
    { tier: 'context', label: 'Context-scoped (agent QR / estate / campaign)', enabled: true },
    { tier: 'regional_house', label: 'Regional / segment house account', enabled: false },
    { tier: 'global_house', label: 'Global house / Super-Admin (last resort)', enabled: true },
  ],
  house_account_code: 'SPOT-HOUSE',
  budget_neutral: true,
  welcome_reward_enabled: false,
  self_referral_blocked: true,
  updated_at: iso(72),
};

const CAMPAIGNS: CampaignDetail[] = [
  {
    id: 'cmp_3001', name: 'Lagos Estate Q3', status: 'active', reward_model: 'flat', vertical: 'property',
    funded_by: 'platform', budget_kobo: 5_000_000_00, spent_kobo: 1_840_000_00, starts_at: iso(480), ends_at: null,
    signups: 1240, activations: 760, cost_per_activation_kobo: 242_100, created_at: iso(500),
    audience: 'Lagos KYC-verified users, no active property', geography: ['Lagos', 'Ogun'],
    eligibility: 'KYC + first property enquiry', referrer_reward_kobo: 200_000, referee_reward_kobo: 100_000,
    vesting: 'KYC 40% / first-txn 30% / retained-30d 30%', per_user_cap_kobo: 1_000_000, daily_cap_kobo: 200_000_00,
    roi_guardrail_pct: 30, throttle_per_min: 40, auto_pause_on_fraud: true,
    funnel: [{ stage: 'Click', count: 9800 }, { stage: 'Signup', count: 1240 }, { stage: 'KYC', count: 980 }, { stage: 'Qualifying action', count: 760 }, { stage: 'Reward paid', count: 612 }],
  },
  {
    id: 'cmp_3002', name: 'Bills Cashback Blitz', status: 'paused', reward_model: 'dynamic', vertical: 'bills',
    funded_by: 'platform', budget_kobo: 3_000_000_00, spent_kobo: 2_910_000_00, starts_at: iso(720), ends_at: iso(-240),
    signups: 3200, activations: 2100, cost_per_activation_kobo: 138_500, created_at: iso(740),
    audience: 'All users with no bill payment in 30d', geography: ['Nationwide'],
    eligibility: 'First bill payment ≥ ₦2,000', referrer_reward_kobo: 150_000, referee_reward_kobo: 50_000,
    vesting: 'First-txn 100%', per_user_cap_kobo: 600_000, daily_cap_kobo: 150_000_00,
    roi_guardrail_pct: 25, throttle_per_min: 60, auto_pause_on_fraud: true,
    funnel: [{ stage: 'Click', count: 24000 }, { stage: 'Signup', count: 3200 }, { stage: 'KYC', count: 2600 }, { stage: 'Qualifying action', count: 2100 }, { stage: 'Reward paid', count: 1980 }],
  },
  {
    id: 'cmp_3003', name: 'Merchant: FreshMart Delivery', status: 'draft', reward_model: 'ltv', vertical: 'restaurant',
    funded_by: 'merchant', budget_kobo: 1_500_000_00, spent_kobo: 0, starts_at: iso(-72), ends_at: null,
    signups: 0, activations: 0, cost_per_activation_kobo: 0, created_at: iso(48),
    audience: 'Restaurant-delivery active users', geography: ['Abuja'],
    eligibility: 'First order ≥ ₦3,000', referrer_reward_kobo: 250_000, referee_reward_kobo: 150_000,
    vesting: 'First-order 60% / retained-30d 40%', per_user_cap_kobo: 800_000, daily_cap_kobo: 100_000_00,
    roi_guardrail_pct: 35, throttle_per_min: 30, auto_pause_on_fraud: true,
    funnel: [{ stage: 'Click', count: 0 }, { stage: 'Signup', count: 0 }, { stage: 'KYC', count: 0 }, { stage: 'Qualifying action', count: 0 }, { stage: 'Reward paid', count: 0 }],
  },
];

const REWARD_LEDGER: RewardLedgerEntry[] = [
  { id: 'rwd_10231', beneficiary_id: 'usr_a12', referred_user_id: 'usr_b88', campaign_id: 'cmp_3001', kind: 'referrer', state: 'eligible', amount_kobo: 200_000, currency: 'NGN', is_house: false, excluded_from_override: false, excluded_from_kfactor: false, ledger_entry_id: 'le_55021', idempotency_key: 'idem-aa01', created_at: iso(1), updated_at: iso(1) },
  { id: 'rwd_10230', beneficiary_id: 'usr_b88', referred_user_id: null, campaign_id: 'cmp_3001', kind: 'referee', state: 'vesting', amount_kobo: 100_000, currency: 'NGN', is_house: false, excluded_from_override: false, excluded_from_kfactor: false, ledger_entry_id: null, idempotency_key: 'idem-aa02', created_at: iso(1), updated_at: iso(1) },
  { id: 'rwd_10210', beneficiary_id: 'SPOT-HOUSE', referred_user_id: 'usr_c10', campaign_id: null, kind: 'referrer', state: 'earned', amount_kobo: 200_000, currency: 'NGN', is_house: true, excluded_from_override: true, excluded_from_kfactor: true, ledger_entry_id: 'le_55010', idempotency_key: 'idem-house-1', created_at: iso(3), updated_at: iso(3) },
  { id: 'rwd_10044', beneficiary_id: 'usr_x77', referred_user_id: 'usr_y22', campaign_id: 'cmp_3002', kind: 'referrer', state: 'clawed_back', amount_kobo: 150_000, currency: 'NGN', is_house: false, excluded_from_override: false, excluded_from_kfactor: false, ledger_entry_id: 'le_54900', idempotency_key: 'idem-cb01', created_at: iso(36), updated_at: iso(4) },
  { id: 'rwd_10301', beneficiary_id: 'usr_d33', referred_user_id: null, campaign_id: null, kind: 'manual', state: 'paid', amount_kobo: 50_000, currency: 'NGN', is_house: false, excluded_from_override: true, excluded_from_kfactor: true, ledger_entry_id: 'le_55101', idempotency_key: 'idem-mg01', created_at: iso(30), updated_at: iso(28) },
  { id: 'rwd_10180', beneficiary_id: 'usr_e44', referred_user_id: 'usr_f55', campaign_id: 'cmp_3001', kind: 'override', state: 'pending', amount_kobo: 30_000, currency: 'NGN', is_house: false, excluded_from_override: false, excluded_from_kfactor: false, ledger_entry_id: null, idempotency_key: 'idem-ov01', created_at: iso(12), updated_at: iso(12) },
];

const HOUSE_LEDGER: HouseLedger = {
  accounts: [
    { id: 'ha_1', code: 'SPOT-HOUSE', scope: 'global', region: null, owner_user_id: 'adm_super', non_withdrawable: true, balance_kobo: 18_420_000_00, created_at: iso(8760) },
    { id: 'ha_2', code: 'SPOT-HOUSE-LAG', scope: 'regional', region: 'Lagos', owner_user_id: 'adm_super', non_withdrawable: true, balance_kobo: 4_120_000_00, created_at: iso(4380) },
  ],
  total_house_volume: 5610,
  total_house_value_kobo: 22_540_000_00,
  budget_neutral: true,
  entries: REWARD_LEDGER.filter((r) => r.is_house),
};

const REASSIGNMENTS: Reassignment[] = [
  {
    id: 'ra_5521', attribution_id: 'attr_88120', referred_user_id: 'usr_c10', from_party: 'SPOT-HOUSE', to_party: 'usr_g99',
    reason: 'late_claim', requested_by: 'adm_support', cosigned_by: 'adm_risk', benefits_house: false, status: 'approved',
    audit: [
      { ts: iso(8), actor: 'adm_support', action: 'requested reassignment (late claim within grace)' },
      { ts: iso(7), actor: 'adm_risk', action: 'co-signed & approved' },
    ],
    created_at: iso(8), decided_at: iso(7),
  },
  {
    id: 'ra_5530', attribution_id: 'attr_88500', referred_user_id: 'usr_h11', from_party: 'usr_k22', to_party: 'SPOT-HOUSE',
    reason: 'fraud_correction', requested_by: 'adm_super', cosigned_by: null, benefits_house: true, status: 'pending',
    audit: [{ ts: iso(2), actor: 'adm_super', action: 'requested reassignment — fraudulent referrer; routes to house' }],
    created_at: iso(2), decided_at: null,
  },
  {
    id: 'ra_5540', attribution_id: 'attr_88611', referred_user_id: 'usr_m44', from_party: 'usr_n55', to_party: 'usr_p66',
    reason: 'dispute', requested_by: 'adm_support', cosigned_by: null, benefits_house: false, status: 'pending',
    audit: [{ ts: iso(5), actor: 'adm_support', action: 'requested reassignment — contested attribution' }],
    created_at: iso(5), decided_at: null,
  },
];

// ─── Read API ─────────────────────────────────────────────────────────────────
export async function getReferralDashboard(): Promise<ReferralDashboard> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(DASHBOARD)); }
  return getJson<ReferralDashboard>('/dashboard');
}

export async function getProgramConfig(): Promise<ProgramConfig> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(PROGRAM_CONFIG)); }
  return getJson<ProgramConfig>('/config/program');
}

export async function getReferralRoles(): Promise<ReferralRole[]> {
  if (USE_MOCK) { await delay(); return [...ROLES]; }
  return getJson<ReferralRole[]>('/config/rbac');
}

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  if (USE_MOCK) { await delay(); return [...FLAGS]; }
  return getJson<FeatureFlag[]>('/config/flags');
}

export async function getReferralAudit(): Promise<ReferralAuditEntry[]> {
  if (USE_MOCK) { await delay(); return [...AUDIT]; }
  return getJson<ReferralAuditEntry[]>('/config/audit');
}

export async function getAttributionConfig(): Promise<AttributionConfig> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(ATTRIBUTION_CONFIG)); }
  return getJson<AttributionConfig>('/attribution/config');
}

export async function updateAttributionConfig(cfg: AttributionConfig): Promise<AttributionConfig> {
  // No backend at all: the referral admin group has PUT /config (a general
  // ProgramConfig, a different type from AttributionConfig) but no
  // /attribution/config route of its own anywhere in backend/internal/referral.
  if (USE_MOCK) throw new Error(`Updating attribution config ${NO_BACKEND_YET}`);
  return sendJson<AttributionConfig>('PUT', '/attribution/config', cfg);
}

export async function listCampaigns(status?: string): Promise<CampaignSummary[]> {
  if (USE_MOCK) {
    await delay();
    const rows = CAMPAIGNS.map(({ funnel, audience, geography, eligibility, referrer_reward_kobo, referee_reward_kobo, vesting, per_user_cap_kobo, daily_cap_kobo, roi_guardrail_pct, throttle_per_min, auto_pause_on_fraud, ...s }) => s);
    return status && status !== 'all' ? rows.filter((c) => c.status === status) : rows;
  }
  return getJson<CampaignSummary[]>(`/campaigns${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  if (USE_MOCK) { await delay(); return CAMPAIGNS.find((c) => c.id === id) ?? null; }
  return getJson<CampaignDetail>(`/campaigns/${id}`);
}

export async function createCampaign(draft: CampaignDraft): Promise<{ id: string }> {
  if (USE_MOCK) throw new Error(`Creating a campaign ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<{ id: string }>('POST', '/campaigns', draft);
}

export async function setCampaignStatus(id: string, status: CampaignDetail['status']): Promise<{ ok: true }> {
  if (USE_MOCK) throw new Error(`Setting a campaign status ${NOT_IN_FIXTURE_MODE}`);
  // backend: campaign lifecycle is split into discrete POST verbs, not a status
  // PATCH: POST /campaigns/:id/{activate,pause,end} (campaigns.Handler.Admin*).
  // "throttled" needs a throttle percentage this function's signature doesn't
  // carry (POST /campaigns/:id/throttle requires {pct}); "draft"/"scheduled"
  // have no admin action at all. Map the three that do.
  const verb = status === 'active' ? 'activate' : status === 'paused' ? 'pause' : status === 'ended' ? 'end' : null;
  if (!verb) throw new Error(`Cannot set campaign status to "${status}" directly — no matching admin action exists.`);
  return sendJson<{ ok: true }>('POST', `/campaigns/${id}/${verb}`, {});
}

export async function listRewardLedger(filters?: { state?: string; kind?: string }): Promise<RewardLedgerEntry[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...REWARD_LEDGER];
    if (filters?.state && filters.state !== 'all') rows = rows.filter((r) => r.state === filters.state);
    if (filters?.kind && filters.kind !== 'all') rows = rows.filter((r) => r.kind === filters.kind);
    return rows;
  }
  const qs = new URLSearchParams();
  if (filters?.state && filters.state !== 'all') qs.set('state', filters.state);
  if (filters?.kind && filters.kind !== 'all') qs.set('kind', filters.kind);
  const q = qs.toString();
  return getJson<RewardLedgerEntry[]>(`/rewards${q ? `?${q}` : ''}`);
}

export async function getRewardEntry(id: string): Promise<RewardLedgerEntry | null> {
  if (USE_MOCK) { await delay(); return REWARD_LEDGER.find((r) => r.id === id) ?? null; }
  return getJson<RewardLedgerEntry>(`/rewards/${id}`);
}

export async function manualGrant(input: ManualGrantInput): Promise<{ id: string }> {
  // No backend at all: the reward ledger defines a KindManual entry kind
  // (backend/internal/referral/ledger/service.go) but no handler or route
  // anywhere in backend/internal/referral lets an admin create one via the API
  // — only reads (AdminList) are wired.
  if (USE_MOCK) throw new Error(`Granting a manual reward ${NO_BACKEND_YET}`);
  // Money mutation: backend requires an Idempotency-Key + audit event.
  const res = await fetch(`${adminBase()}/rewards/grant`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as { id: string };
}

export async function executeClawback(input: ClawbackInput): Promise<{ ok: true }> {
  if (USE_MOCK) throw new Error(`Executing a clawback ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /risk/clawbacks (risk.Handler.ExecuteClawback), NOT
  // /rewards/:id/clawback — the reward id and reason travel in the body as
  // {reward_id, reason_code, idempotency_key}, not a path param + {reason}.
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(`${adminBase()}/risk/clawbacks`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ reward_id: input.reward_id, reason_code: input.reason, idempotency_key: idempotencyKey }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return { ok: true };
}

export async function getHouseLedger(): Promise<HouseLedger> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(HOUSE_LEDGER)); }
  return getJson<HouseLedger>('/house');
}

export async function listReassignments(status?: string): Promise<Reassignment[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? REASSIGNMENTS.filter((r) => r.status === status) : [...REASSIGNMENTS]; }
  return getJson<Reassignment[]>(`/attribution/reassignments${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export async function decideReassignment(input: ReassignDecision): Promise<{ ok: true }> {
  // No backend at all: the real endpoint (POST /reassignments,
  // attribution.Handler.Reassign) executes a reassignment immediately in one
  // step (attribution_id, to_party, reason, cosigned_by) — there is no
  // "pending reassignment awaiting approve/reject" concept anywhere in
  // backend/internal/referral/attribution for this {id, decision, cosigner_id,
  // note} shape to decide on.
  if (USE_MOCK) throw new Error(`Deciding a reassignment ${NO_BACKEND_YET}`);
  return sendJson<{ ok: true }>('POST', `/attribution/reassignments/${input.id}/decide`, input);
}
