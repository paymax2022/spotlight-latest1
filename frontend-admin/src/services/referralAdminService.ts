// Mock by default (mirrors connectAdminService). Flip with
// /api/referral/admin/*. RBAC: referral.* gates wired on the sidebar by the
// orchestrator. Money is BIGINT kobo throughout.

import { apiRoot } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';
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
  HouseAccount,
  HouseLedgerEntry,
} from '@/types/referralAdmin';

export const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_REFERRAL_USE_MOCK);
/** Named so the fixture banner can cite the exact switch. */
export const USE_MOCK_ENV = 'NEXT_PUBLIC_REFERRAL_USE_MOCK';

// which relied on apiBaseUrl ending in /api/v1. It no longer does (same-origin
// proxy origin instead), so the regex became a silent no-op and every live call
// 404'd. apiRoot() strips any trailing /api/v1 explicitly, so this keeps working
// no matter how apiBaseUrl is spelled. Note: /api/referral/admin (RegisterReferral
// et al. in referral_routes.go / referral_econ_routes.go / referral_trust_routes.go)
// is a DIFFERENT admin surface from the newer Direct Referral Rewards engine's
// /v1/admin/referrals (referral_rewards_routes.go) — every path this file calls
// matches the former, so this base is correct as-is.
function adminBase(): string {
  return `${apiRoot()}/api/referral/admin`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Verified against the real Go routes: backend/internal/referral/{campaigns,risk,
// attribution}/handlers.go + backend/internal/app/referral_{routes,econ_routes,
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

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

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
  // Projected onto the seven columns house.Handler.Ledger actually selects
  // (house/service.go:175): the house view has no beneficiary, campaign,
  // ledger-link or idempotency column, so the fixture carries none either.
  entries: REWARD_LEDGER.filter((r) => r.is_house).map((r) => ({
    id: r.id,
    referred_user_id: r.referred_user_id ?? null,
    kind: r.kind,
    state: r.state,
    amount_kobo: r.amount_kobo,
    currency: r.currency,
    excluded_from_override: r.excluded_from_override,
    excluded_from_kfactor: r.excluded_from_kfactor,
    created_at: r.created_at ?? '',
  })),
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

// The Overview's figures, assembled from the endpoints that exist today. There is
// no aggregate /dashboard route on the backend. A figure whose source is not
// computed yet (GMV, fraud rate, activation, trend, activity) is simply absent
// here, and the page says so. A source that fails to load is listed in
// failedSources, so the page can say what is missing rather than go blank.
export interface DashboardFigures {
  kFactor: number | null;            // /analytics/k-factor (excludes house signups)
  referrers: number | null;          // /analytics/k-factor
  referredSignups: number | null;    // /analytics/k-factor (house excluded)
  houseSignups: number | null;       // /analytics/k-factor
  referralCacKobo: number | null;    // /analytics/cac
  paidCacKobo: number | null;        // /analytics/cac — benchmark; 0 = none set
  rewardSpentKobo: number | null;    // /finance/reward-to-ltv
  rewardToLtv: number | null;        // /finance/reward-to-ltv, as a fraction
  globalBudgetKobo: number | null;   // /finance/budgets — the active global budget
  openAlerts: number | null;         // /risk/dashboard
  activeBlocks: number | null;       // /risk/dashboard
  failedSources: string[];
}

interface KFactorBody { k_factor?: { referrers: number; referred_signups: number; house_signups: number; k_factor: number } }
interface CacBody { cac?: { referral_cac_kobo: number; paid_cac_kobo: number } }
interface RewardToLtvBody { reward_to_ltv?: { reward_spent_kobo: number; ratio_bps: number } }
interface BudgetsBody { budgets?: { scope: string; budget_kobo: number; spent_kobo: number; active: boolean }[] }
interface RiskBody { dashboard?: { open_alerts: number; active_blocks: number } }

export async function getReferralDashboardFigures(): Promise<DashboardFigures> {
  if (USE_MOCK) {
    await delay();
    return {
      kFactor: DASHBOARD.k_factor,
      referrers: null,
      referredSignups: DASHBOARD.referred_signups,
      houseSignups: DASHBOARD.house_signups,
      referralCacKobo: DASHBOARD.referral_cac_kobo,
      paidCacKobo: DASHBOARD.paid_cac_kobo,
      rewardSpentKobo: DASHBOARD.reward_burn_kobo,
      rewardToLtv: DASHBOARD.reward_to_ltv_ratio,
      globalBudgetKobo: DASHBOARD.reward_budget_kobo,
      openAlerts: null,
      activeBlocks: null,
      failedSources: [],
    };
  }
  const labels = ['K-factor', 'CAC', 'Reward spend', 'Budgets', 'Risk'];
  const sources = await Promise.allSettled([
    getJson<KFactorBody>('/analytics/k-factor'),
    getJson<CacBody>('/analytics/cac'),
    getJson<RewardToLtvBody>('/finance/reward-to-ltv'),
    getJson<BudgetsBody>('/finance/budgets'),
    getJson<RiskBody>('/risk/dashboard'),
  ]);
  const failedSources: string[] = [];
  const body = <T,>(i: number): T | null => {
    const r = sources[i];
    if (r.status === 'fulfilled') return r.value as T;
    failedSources.push(labels[i]);
    return null;
  };
  const k = body<KFactorBody>(0)?.k_factor;
  const cac = body<CacBody>(1)?.cac;
  const ltv = body<RewardToLtvBody>(2)?.reward_to_ltv;
  const budgets = body<BudgetsBody>(3)?.budgets;
  const risk = body<RiskBody>(4)?.dashboard;
  const global = budgets?.find((b) => b.scope === 'global' && b.active);
  return {
    kFactor: k?.k_factor ?? null,
    referrers: k?.referrers ?? null,
    referredSignups: k?.referred_signups ?? null,
    houseSignups: k?.house_signups ?? null,
    referralCacKobo: cac?.referral_cac_kobo ?? null,
    paidCacKobo: cac?.paid_cac_kobo ?? null,
    rewardSpentKobo: ltv?.reward_spent_kobo ?? null,
    rewardToLtv: ltv ? ltv.ratio_bps / 10000 : null,
    globalBudgetKobo: global?.budget_kobo ?? null,
    openAlerts: risk?.open_alerts ?? null,
    activeBlocks: risk?.active_blocks ?? null,
    failedSources,
  };
}

/**
 * The program tab reads the ONLY config route the backend mounts:
 * GET /api/referral/admin/config (referral_routes.go:143, guard
 * referral.config.view), which answers referralconfig.Config —
 * attribution_window_hours, grace_window_hours, fallback_chain,
 * house_account_code, budget_neutral, welcome_reward_enabled. Of the fields
 * this tab shows, only the welcome-reward switch is in that row; the program
 * on/off, default tier, tier ladder, qualifying action, reward-to-LTV cap and
 * last-updated have no column and no other route, so they stay absent and the
 * page renders an em-dash instead of a fabricated "Enabled".
 *
 * It used to call GET /config/program, a path Go never registers: the page died
 * with "Request failed (404)" before showing anything real.
 */
export async function getProgramConfig(): Promise<ProgramConfig> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(PROGRAM_CONFIG)); }
  const cfg = await getJson<ConfigRowWire>('/config');
  return { welcome_reward_enabled: cfg.welcome_reward_enabled === true };
}

/**
 * GET /api/referral/admin/ledger — the reward ledger list (ledger.Handler.
 * AdminList, referral_routes.go:155, guard referral.ledger.view).
 *
 * The route answers `{entries: […]}` (ledger/service.go:667), which the page's
 * `!rows || rows.length === 0` guard is not false for, so the array has to be
 * lifted here; and it takes only ?beneficiary=, so the state and kind dropdowns
 * narrow the rows it returned rather than being dropped on the floor. The
 * handler reads 200 rows newest-first — the table says so in its footnote.
 */
interface LedgerEntryWire {
  id: string;
  beneficiary_id?: string;
  house_account_id?: string;
  referred_user_id?: string;
  kind: string;
  state: string;
  amount_kobo: number;
  currency: string;
  is_house: boolean;
  excluded_from_override: boolean;
  excluded_from_kfactor: boolean;
}

export async function listRewardLedger(filters?: { state?: string; kind?: string; beneficiary?: string }): Promise<RewardLedgerEntry[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...REWARD_LEDGER];
    if (filters?.state && filters.state !== 'all') rows = rows.filter((r) => r.state === filters.state);
    if (filters?.kind && filters.kind !== 'all') rows = rows.filter((r) => r.kind === filters.kind);
    return rows;
  }
  const qs = new URLSearchParams();
  if (filters?.beneficiary) qs.set('beneficiary', filters.beneficiary);
  const q = qs.toString();
  const body = await getJson<unknown>(`/ledger${q ? `?${q}` : ''}`);
  const rows = Array.isArray(body) ? body as LedgerEntryWire[] : (body as { entries?: LedgerEntryWire[] }).entries ?? [];
  return rows
    .filter((r) => (!filters?.state || filters.state === 'all' || r.state === filters.state)
      && (!filters?.kind || filters.kind === 'all' || r.kind === filters.kind))
    .map((r) => ({
      id: r.id,
      beneficiary_id: r.beneficiary_id,
      referred_user_id: r.referred_user_id,
      house_account_id: r.house_account_id,
      kind: r.kind as RewardLedgerEntry['kind'],
      state: r.state as RewardLedgerEntry['state'],
      amount_kobo: r.amount_kobo,
      currency: r.currency,
      is_house: r.is_house,
      excluded_from_override: r.excluded_from_override,
      excluded_from_kfactor: r.excluded_from_kfactor,
      // ledger.Entry has no created_at/updated_at, no campaign and no
      // idempotency key: the "Updated" column renders "not reported" rather
      // than an "in NaNd ago" made of an undefined timestamp.
    }));
}

export async function getRewardEntry(id: string): Promise<RewardLedgerEntry | null> {
  if (USE_MOCK) { await delay(); return REWARD_LEDGER.find((r) => r.id === id) ?? null; }
  // No single-entry route exists: the ledger package registers GET /ledger
  // (AdminList) and nothing keyed by reward id, so /rewards/:id was always a
  // 404. The list carries every field the row has.
  throw new Error(`Opening reward ${id} ${NO_BACKEND_YET} The ledger is read as a list (GET /ledger); no route serves one entry by id.`);
}

export async function manualGrant(input: ManualGrantInput): Promise<{ id: string }> {
  // No backend at all: the reward ledger defines a KindManual entry kind
  // (backend/internal/referral/ledger/service.go) but no handler or route
  // anywhere in backend/internal/referral lets an admin create one via the API
  // — only reads (AdminList) are wired.
  void input;
  throw new Error(`Granting a manual reward ${NO_BACKEND_YET} POST /ledger/:id/clawback and the campaign fund routes are the reward money actions that exist.`);
}

/**
 * The three admin tabs beyond the config row have no backend: the referral
 * admin group registers GET and PUT /config only (referral_routes.go:143-146),
 * so /config/rbac, /config/flags and /config/audit were invented paths whose
 * 404 killed the whole page through Promise.all. Refusing here says what is
 * missing; the page shows each tab on its own.
 */
export async function getReferralRoles(): Promise<ReferralRole[]> {
  if (USE_MOCK) { await delay(); return [...ROLES]; }
  throw new Error(`Listing referral RBAC roles ${NO_BACKEND_YET} The admin group registers GET and PUT /config only; no RBAC roster route exists in backend/internal/referral.`);
}

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  if (USE_MOCK) { await delay(); return [...FLAGS]; }
  throw new Error(`Listing referral feature flags ${NO_BACKEND_YET} No kill-switch or flag catalogue route is registered; the platform module registry lives behind /api/v1/admin, not in the referral console.`);
}

export async function getReferralAudit(): Promise<ReferralAuditEntry[]> {
  if (USE_MOCK) { await delay(); return [...AUDIT]; }
  throw new Error(`Reading the referral audit trail ${NO_BACKEND_YET} The referral_engine_events stream is written by the engine (events package) and has no admin read route.`);
}

/**
 * referralconfig.Config (backend/internal/referral/config/service.go:18) — the
 * singleton referral_config row, which IS the attribution configuration.
 */
interface ConfigRowWire {
  attribution_window_hours?: number;
  grace_window_hours?: number;
  fallback_chain?: string[];
  house_account_code?: string;
  budget_neutral?: boolean;
  welcome_reward_enabled?: boolean;
}

/**
 * Attribution config is the same GET /config row the program tab reads — the
 * route is not /attribution/config (no such registration exists anywhere in
 * backend/internal/referral, which is why the tab 404'd). fallback_chain is a
 * plain array of tier names in Go, lifted into the entries the UI labels.
 * self_referral_blocked and updated_at have no column in that row.
 */
export async function getAttributionConfig(): Promise<AttributionConfig> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(ATTRIBUTION_CONFIG)); }
  const cfg = await getJson<ConfigRowWire>('/config');
  return {
    attribution_window_hours: cfg.attribution_window_hours ?? 0,
    grace_window_hours: cfg.grace_window_hours ?? 0,
    fallback_chain: (cfg.fallback_chain ?? []).map((tier) => ({
      tier: tier as AttributionConfig['fallback_chain'][number]['tier'],
      label: tier.replace(/_/g, ' '),
      enabled: true,
    })),
    house_account_code: cfg.house_account_code ?? '',
    budget_neutral: cfg.budget_neutral === true,
    welcome_reward_enabled: cfg.welcome_reward_enabled === true,
  };
}

/**
 * The attribution WRITE has no route either: PUT /config updates the same
 * singleton row with the program fields, and no /attribution/config exists, so
 * saving this form used to POST into a 404 and still show a success banner.
 */
export async function updateAttributionConfig(cfg: AttributionConfig): Promise<AttributionConfig> {
  // Same row, same route as the read: PUT /api/referral/admin/config (guard
  // referral.config.manage). referralconfig.Update accepts the attribution
  // fields, which are exactly what this form holds.
  if (USE_MOCK) throw new Error(`Updating attribution config ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<AttributionConfig>('PUT', '/config', {
    attribution_window_hours: cfg.attribution_window_hours,
    grace_window_hours: cfg.grace_window_hours,
    fallback_chain: cfg.fallback_chain.map((f) => f.tier),
    house_account_code: cfg.house_account_code,
    budget_neutral: cfg.budget_neutral,
    welcome_reward_enabled: cfg.welcome_reward_enabled,
  });
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
  // have no admin action at all. Map the three that do.
  const verb = status === 'active' ? 'activate' : status === 'paused' ? 'pause' : status === 'ended' ? 'end' : null;
  if (!verb) throw new Error(`Cannot set campaign status to "${status}" directly — no matching admin action exists.`);
  return sendJson<{ ok: true }>('POST', `/campaigns/${id}/${verb}`, {});
}

// listRewardLedger, getRewardEntry and manualGrant live above, on the routes
// the ledger package actually registers (GET /ledger; no by-id read, no grant).

export async function executeClawback(input: ClawbackInput): Promise<{ ok: true }> {
  if (USE_MOCK) throw new Error(`Executing a clawback ${NOT_IN_FIXTURE_MODE}`);
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

/**
 * The house ledger reads GET /house/ledger.
 *
 * It used to read GET /house, which is the sibling route that answers with the
 * house ACCOUNT only (house/service.go:147 GetGlobal marshals an Account, no
 * entries, no totals). The page then did `data.entries.map(...)` over undefined
 * and the whole screen fell over, which is why /admin/referral/house reported
 * "This page couldn't load" rather than showing a ledger.
 *
 * The envelope from Ledger() is named — {house, non_withdrawable, total_count,
 * total_kobo, entries} — so the console's own field names are mapped here:
 * total_count is the volume the KPI labels, and budget_neutral comes from the
 * account's non_withdrawable flag rather than a switch the API never reports.
 */
export async function getHouseLedger(): Promise<HouseLedger> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(HOUSE_LEDGER)); }
  const raw = await getJson<HouseLedgerPayload>('/house/ledger');
  return {
    accounts: [raw.house],
    total_house_volume: raw.total_count ?? 0,
    total_house_value_kobo: raw.total_kobo ?? 0,
    budget_neutral: Boolean(raw.non_withdrawable ?? raw.house?.non_withdrawable),
    entries: raw.entries ?? [],
  };
}

interface HouseLedgerPayload {
  house: HouseAccount;
  non_withdrawable?: boolean;
  total_count?: number;
  total_kobo?: number;
  entries?: HouseLedgerEntry[];
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
