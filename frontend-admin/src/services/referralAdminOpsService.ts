// ── Referral Admin OPS service (RA2) ─────────────────────────────────────────
// Mock by default (mirrors referralAdminService). Flip with
// NEXT_PUBLIC_REFERRAL_USE_MOCK=false to hit the live Go backend at
// /api/referral/admin/*. RBAC: referral.* gates wired on the sidebar by the
// orchestrator. Money is BIGINT kobo throughout.

import { env } from '@/config/env';
import type {
  Payout,
  Reconciliation,
  BudgetBurn,
  Float,
  RiskDashboard,
  RiskRule,
  CaseDetail,
  BlocklistEntry,
  ClawbackRecord,
  ReviewItem,
  CompliancePolicy,
  Disclosure,
  AmlAlert,
  ConsentRecord,
  ReferralUserSummary,
  ReferralUser360,
  InterveneInput,
  MissionAdmin,
  RankAdmin,
  LeaderboardConfig,
  ContestAdmin,
  AnalyticsOverview,
  FunnelData,
  SegmentationData,
  Ambassador,
  AmbassadorApplication,
  AgentNetwork,
  OverridePolicy,
  MerchantSummary,
  MerchantDetail,
} from '@/types/referralAdminOps';

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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown, idempotent = false): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (idempotent && typeof crypto !== 'undefined' && 'randomUUID' in crypto) headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`${adminBase()}${path}`, { method, headers, body: JSON.stringify(body) });
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

const PAYOUTS: Payout[] = [
  { id: 'po_4001', beneficiary_id: 'usr_a12', beneficiary_name: 'Chidi Okafor', wallet_id: 'wal_a12', reward_ids: ['rwd_10231'], amount_kobo: 200_000, currency: 'NGN', status: 'pending', risk_flag: 'low', requested_at: iso(2), approved_by: null, approved_at: null, idempotency_key: 'idem-po-4001' },
  { id: 'po_4002', beneficiary_id: 'usr_e44', beneficiary_name: 'Aisha Bello', wallet_id: 'wal_e44', reward_ids: ['rwd_10180', 'rwd_10182'], amount_kobo: 480_000, currency: 'NGN', status: 'pending', risk_flag: 'high', requested_at: iso(5), approved_by: null, approved_at: null, idempotency_key: 'idem-po-4002' },
  { id: 'po_4003', beneficiary_id: 'usr_d33', beneficiary_name: 'Tunde Adeyemi', wallet_id: 'wal_d33', reward_ids: ['rwd_10301'], amount_kobo: 50_000, currency: 'NGN', status: 'approved', risk_flag: 'low', requested_at: iso(28), approved_by: 'adm_fin', approved_at: iso(26), idempotency_key: 'idem-po-4003' },
  { id: 'po_4004', beneficiary_id: 'usr_x77', beneficiary_name: 'Ngozi Eze', wallet_id: 'wal_x77', reward_ids: ['rwd_10044'], amount_kobo: 150_000, currency: 'NGN', status: 'on_hold', risk_flag: 'critical', requested_at: iso(36), approved_by: null, approved_at: null, idempotency_key: 'idem-po-4004' },
  { id: 'po_4005', beneficiary_id: 'usr_g99', beneficiary_name: 'Emeka Nwosu', wallet_id: 'wal_g99', reward_ids: ['rwd_10250'], amount_kobo: 320_000, currency: 'NGN', status: 'paid', risk_flag: 'low', requested_at: iso(72), approved_by: 'adm_fin', approved_at: iso(70), idempotency_key: 'idem-po-4005' },
];

const RECONCILIATION: Reconciliation = {
  as_of: iso(1),
  total_accrued_kobo: 12_840_000_00,
  total_credited_kobo: 12_810_000_00,
  total_settled_kobo: 11_920_000_00,
  unmatched_kobo: 30_000_00,
  rows: Array.from({ length: 7 }).map((_, i) => {
    const accrued = (1_800_000 + i * 42_000) * 100;
    const credited = accrued - (i === 2 ? 30_000_00 : 0);
    const settled = credited - 120_000_00;
    const variance = accrued - credited;
    return {
      id: `rec_${i}`,
      date: dateStr(6 - i),
      ledger_accrued_kobo: accrued,
      wallet_credited_kobo: credited,
      payout_settled_kobo: settled,
      variance_kobo: variance,
      status: variance === 0 ? 'matched' : i === 2 ? 'investigating' : 'variance',
    };
  }),
};

const BUDGET_BURN: BudgetBurn = {
  as_of: iso(1),
  program_budget_kobo: 25_000_000_00,
  program_spent_kobo: 12_840_000_00,
  reward_to_ltv_ratio: 0.14,
  reward_to_ltv_cap_pct: 20,
  lines: [
    { scope: 'Program (all)', budget_kobo: 25_000_000_00, spent_kobo: 12_840_000_00, burn_rate_kobo_per_day: 410_000_00, projected_exhaust_date: dateStr(-30), alert: 'ok' },
    { scope: 'Lagos Estate Q3', budget_kobo: 5_000_000_00, spent_kobo: 1_840_000_00, burn_rate_kobo_per_day: 92_000_00, projected_exhaust_date: dateStr(-34), alert: 'ok' },
    { scope: 'Bills Cashback Blitz', budget_kobo: 3_000_000_00, spent_kobo: 2_910_000_00, burn_rate_kobo_per_day: 145_000_00, projected_exhaust_date: dateStr(-1), alert: 'breach' },
    { scope: 'Property vertical', budget_kobo: 8_000_000_00, spent_kobo: 6_400_000_00, burn_rate_kobo_per_day: 220_000_00, projected_exhaust_date: dateStr(-7), alert: 'warn' },
  ],
  trend: Array.from({ length: 14 }).map((_, i) => ({ date: dateStr(13 - i), spent_kobo: (380_000 + i * 12_000) * 100 })),
};

const FLOAT: Float = {
  as_of: iso(1),
  total_balance_kobo: 48_200_000_00,
  total_reserved_kobo: 12_840_000_00,
  total_available_kobo: 35_360_000_00,
  positions: [
    { id: 'fl_1', account: 'Reward float (Paystack)', provider: 'Paystack', balance_kobo: 30_000_000_00, reserved_kobo: 8_400_000_00, available_kobo: 21_600_000_00, threshold_kobo: 5_000_000_00, status: 'healthy', updated_at: iso(1) },
    { id: 'fl_2', account: 'Operating wallet', provider: 'Internal', balance_kobo: 15_000_000_00, reserved_kobo: 3_900_000_00, available_kobo: 11_100_000_00, threshold_kobo: 4_000_000_00, status: 'healthy', updated_at: iso(2) },
    { id: 'fl_3', account: 'Merchant settlement float', provider: 'Internal', balance_kobo: 3_200_000_00, reserved_kobo: 540_000_00, available_kobo: 2_660_000_00, threshold_kobo: 3_000_000_00, status: 'low', updated_at: iso(3) },
  ],
};

const RISK_DASHBOARD: RiskDashboard = {
  fraud_rate: 0.018,
  open_cases: 7,
  amount_at_risk_kobo: 2_340_000_00,
  blocked_24h: 14,
  clawbacks_30d_kobo: 980_000_00,
  alerts: [
    { id: 'al_1', kind: 'device_farm', severity: 'critical', subject_id: 'usr_x77', detail: '11 accounts share device fingerprint d4f...91', amount_at_risk_kobo: 1_200_000_00, created_at: iso(3) },
    { id: 'al_2', kind: 'velocity', severity: 'high', subject_id: 'usr_e44', detail: '38 referrals in 1h — exceeds velocity rule', amount_at_risk_kobo: 480_000_00, created_at: iso(5) },
    { id: 'al_3', kind: 'kyc_dup', severity: 'high', subject_id: 'usr_q12', detail: 'BVN matches existing verified identity', amount_at_risk_kobo: 200_000_00, created_at: iso(8) },
    { id: 'al_4', kind: 'self_referral', severity: 'normal', subject_id: 'usr_r33', detail: 'Referee device == referrer device', amount_at_risk_kobo: 150_000_00, created_at: iso(12) },
    { id: 'al_5', kind: 'burn_spike', severity: 'high', subject_id: 'cmp_3002', detail: 'Burn 2.1× expected on Bills Cashback Blitz', amount_at_risk_kobo: 310_000_00, created_at: iso(14) },
  ],
  burn_anomaly_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    expected_kobo: (380_000 + i * 10_000) * 100,
    actual_kobo: (380_000 + i * 10_000 + (i === 11 ? 420_000 : Math.round(Math.sin(i) * 20_000))) * 100,
  })),
};

const RISK_RULES: RiskRule[] = [
  { id: 'rl_1', name: 'Referral velocity cap', category: 'velocity', description: 'Max referrals per hour per account', threshold: '> 20 / hour', action: 'hold', enabled: true, hits_30d: 142, updated_at: iso(72) },
  { id: 'rl_2', name: 'Shared device fingerprint', category: 'device', description: 'Multiple accounts on one device', threshold: '> 3 accounts / device', action: 'block', enabled: true, hits_30d: 58, updated_at: iso(120) },
  { id: 'rl_3', name: 'KYC identity dedup', category: 'kyc_dedup', description: 'BVN / NIN collision across accounts', threshold: 'exact match', action: 'clawback', enabled: true, hits_30d: 21, updated_at: iso(200) },
  { id: 'rl_4', name: 'Self-referral block', category: 'behavioural', description: 'Same identity/device for referrer & referee', threshold: 'match', action: 'block', enabled: true, hits_30d: 33, updated_at: iso(300) },
  { id: 'rl_5', name: 'Dormant-then-burst', category: 'behavioural', description: 'Account dormant 30d then bursts referrals', threshold: 'pattern', action: 'flag', enabled: false, hits_30d: 9, updated_at: iso(48) },
];

const CASES: CaseDetail[] = [
  {
    id: 'case_701', subject_id: 'usr_x77', subject_name: 'Ngozi Eze', status: 'investigating', severity: 'critical',
    reason: 'Suspected device farm — 11 linked accounts', risk_score: 88, amount_at_risk_kobo: 1_200_000_00, assigned_to: 'adm_risk',
    linked_accounts: ['usr_x77', 'usr_y22', 'usr_z33', 'usr_z34'], linked_devices: ['d4f...91', 'a1b...02'],
    evidence: [
      { ts: iso(36), kind: 'device', detail: '11 accounts share fingerprint d4f...91' },
      { ts: iso(34), kind: 'velocity', detail: 'Referral burst: 38 in 1h' },
      { ts: iso(30), kind: 'kyc', detail: '2 accounts reuse same selfie hash' },
    ],
    audit: [
      { ts: iso(36), actor: 'system', action: 'case auto-opened by rule rl_2' },
      { ts: iso(30), actor: 'adm_risk', action: 'assigned to self; payout placed on hold' },
    ],
    created_at: iso(36), resolved_at: null,
  },
  {
    id: 'case_702', subject_id: 'usr_e44', subject_name: 'Aisha Bello', status: 'open', severity: 'high',
    reason: 'Velocity rule breach', risk_score: 64, amount_at_risk_kobo: 480_000_00, assigned_to: null,
    linked_accounts: ['usr_e44'], linked_devices: ['c7e...44'],
    evidence: [{ ts: iso(5), kind: 'velocity', detail: '38 referrals in 1h' }],
    audit: [{ ts: iso(5), actor: 'system', action: 'case auto-opened by rule rl_1' }],
    created_at: iso(5), resolved_at: null,
  },
];

const BLOCKLIST: BlocklistEntry[] = [
  { id: 'bl_1', type: 'device', list: 'block', value: 'd4f...91', reason: 'Device farm (case_701)', added_by: 'adm_risk', created_at: iso(30) },
  { id: 'bl_2', type: 'identity', list: 'block', value: 'BVN 2218****901', reason: 'KYC dedup abuse', added_by: 'adm_risk', created_at: iso(120) },
  { id: 'bl_3', type: 'account', list: 'block', value: 'usr_z33', reason: 'Mule account', added_by: 'adm_risk', created_at: iso(200) },
  { id: 'bl_4', type: 'bank', list: 'allow', value: 'GTBank 0123****', reason: 'Verified high-value partner', added_by: 'adm_super', created_at: iso(400) },
];

const CLAWBACKS: ClawbackRecord[] = [
  { id: 'cb_9001', reward_id: 'rwd_10044', beneficiary_id: 'usr_x77', amount_kobo: 150_000, reason: 'Duplicate KYC identity', status: 'recovered', recovered_kobo: 150_000, executed_by: 'adm_risk', created_at: iso(36), resolved_at: iso(4) },
  { id: 'cb_9002', reward_id: 'rwd_10090', beneficiary_id: 'usr_q12', amount_kobo: 200_000, reason: 'Self-referral', status: 'executing', recovered_kobo: 0, executed_by: 'adm_risk', created_at: iso(8), resolved_at: null },
  { id: 'cb_9003', reward_id: 'rwd_10120', beneficiary_id: 'usr_r33', amount_kobo: 80_000, reason: 'Invalid qualifying action', status: 'pending', recovered_kobo: 0, executed_by: null, created_at: iso(2), resolved_at: null },
  { id: 'cb_9004', reward_id: 'rwd_10001', beneficiary_id: 'usr_w88', amount_kobo: 120_000, reason: 'Chargeback on funding txn', status: 'failed', recovered_kobo: 0, executed_by: 'adm_risk', created_at: iso(96), resolved_at: iso(80) },
];

const REVIEW_QUEUE: ReviewItem[] = [
  { id: 'rv_1', reward_id: 'rwd_10180', beneficiary_id: 'usr_e44', amount_kobo: 30_000, hold_reason: 'Velocity flag', risk_score: 64, flagged_by_rule: 'rl_1', status: 'held', created_at: iso(5) },
  { id: 'rv_2', reward_id: 'rwd_10250', beneficiary_id: 'usr_g99', amount_kobo: 320_000, hold_reason: 'Manual hold — high value', risk_score: 22, flagged_by_rule: null, status: 'held', created_at: iso(10) },
  { id: 'rv_3', reward_id: 'rwd_10090', beneficiary_id: 'usr_q12', amount_kobo: 200_000, hold_reason: 'KYC dedup', risk_score: 78, flagged_by_rule: 'rl_3', status: 'held', created_at: iso(8) },
];

const COMPLIANCE_POLICY: CompliancePolicy = {
  jurisdiction: 'Nigeria (NDPC / SEC / FCCPC / CBN)',
  pyramid_line_enforced: true,
  activity_based_only: true,
  max_downline_depth: 2,
  tier_caps: [
    { tier: 'Standard', monthly_cap_kobo: 50_000_00, override_pct: 0 },
    { tier: 'Ambassador', monthly_cap_kobo: 250_000_00, override_pct: 0 },
    { tier: 'Agent', monthly_cap_kobo: 1_000_000_00, override_pct: 5 },
  ],
  jurisdiction_toggles: [
    { region: 'Nigeria', program_enabled: true, note: 'Activity-based earnings only; disclosures required.' },
    { region: 'Ghana', program_enabled: false, note: 'Pending local legal review.' },
    { region: 'Kenya', program_enabled: false, note: 'Not launched.' },
  ],
  updated_at: iso(72),
};

const DISCLOSURES: Disclosure[] = [
  { id: 'dsc_1', title: 'Referral Program Terms', version: 'v3.2', status: 'active', effective_date: dateStr(30), acceptance_rate: 0.94, required: true, updated_at: iso(72) },
  { id: 'dsc_2', title: 'Earnings Disclosure', version: 'v2.0', status: 'active', effective_date: dateStr(45), acceptance_rate: 0.91, required: true, updated_at: iso(200) },
  { id: 'dsc_3', title: 'Agent Override Disclosure', version: 'v1.3', status: 'active', effective_date: dateStr(20), acceptance_rate: 0.88, required: true, updated_at: iso(48) },
  { id: 'dsc_4', title: 'Referral Program Terms', version: 'v4.0', status: 'draft', effective_date: dateStr(-7), acceptance_rate: 0, required: true, updated_at: iso(6) },
  { id: 'dsc_5', title: 'Earnings Disclosure', version: 'v1.0', status: 'archived', effective_date: dateStr(400), acceptance_rate: 1, required: false, updated_at: iso(8000) },
];

const AML_ALERTS: AmlAlert[] = [
  { id: 'aml_1', subject_id: 'usr_e44', pattern: 'structuring', amount_kobo: 480_000, severity: 'high', status: 'investigating', created_at: iso(5) },
  { id: 'aml_2', subject_id: 'usr_x77', pattern: 'layering', amount_kobo: 1_200_000, severity: 'critical', status: 'open', created_at: iso(3) },
  { id: 'aml_3', subject_id: 'usr_w88', pattern: 'velocity', amount_kobo: 120_000, severity: 'normal', status: 'cleared', created_at: iso(96) },
];

const CONSENTS: ConsentRecord[] = [
  { id: 'cs_1', user_id: 'usr_a12', consent_type: 'referral_terms', granted: true, version: 'v3.2', retention_until: dateStr(-365), source: 'onboarding', updated_at: iso(720) },
  { id: 'cs_2', user_id: 'usr_a12', consent_type: 'marketing', granted: false, version: 'v3.2', retention_until: dateStr(-365), source: 'settings', updated_at: iso(48) },
  { id: 'cs_3', user_id: 'usr_e44', consent_type: 'data_share', granted: true, version: 'v3.2', retention_until: dateStr(-365), source: 'onboarding', updated_at: iso(120) },
  { id: 'cs_4', user_id: 'usr_d33', consent_type: 'profiling', granted: true, version: 'v3.2', retention_until: dateStr(-365), source: 'onboarding', updated_at: iso(200) },
];

const USERS: ReferralUserSummary[] = [
  { id: 'usr_a12', name: 'Chidi Okafor', roles: ['referrer'], status: 'active', total_earned_kobo: 640_000, referrals_count: 12, risk_score: 18, created_at: iso(2000) },
  { id: 'usr_e44', name: 'Aisha Bello', roles: ['referrer', 'ambassador'], status: 'restricted', total_earned_kobo: 2_480_000, referrals_count: 88, risk_score: 64, created_at: iso(3000) },
  { id: 'usr_g99', name: 'Emeka Nwosu', roles: ['agent'], status: 'active', total_earned_kobo: 4_120_000, referrals_count: 210, risk_score: 30, created_at: iso(5000) },
  { id: 'usr_x77', name: 'Ngozi Eze', roles: ['referrer'], status: 'suspended', total_earned_kobo: 150_000, referrals_count: 11, risk_score: 88, created_at: iso(800) },
];

const USER_360: Record<string, ReferralUser360> = {
  usr_a12: {
    id: 'usr_a12', name: 'Chidi Okafor', email: 'chidi@example.com', phone: '+234 803 *** 1122', roles: ['referrer'],
    status: 'active', kyc_tier: 'Tier 2', risk_score: 18, total_earned_kobo: 640_000, pending_kobo: 200_000, clawed_back_kobo: 0,
    referrals_count: 12, active_referrals: 9,
    referrals: [
      { id: 'rf_1', user_id: 'usr_b88', state: 'activated', reward_kobo: 200_000, created_at: iso(1) },
      { id: 'rf_2', user_id: 'usr_c10', state: 'kyc', reward_kobo: 0, created_at: iso(48) },
    ],
    earnings: [
      { id: 'rwd_10231', kind: 'referrer', state: 'eligible', amount_kobo: 200_000, created_at: iso(1) },
      { id: 'rwd_09980', kind: 'referrer', state: 'paid', amount_kobo: 200_000, created_at: iso(240) },
    ],
    audit: [{ ts: iso(2000), actor: 'system', action: 'account created' }],
    created_at: iso(2000),
  },
  usr_x77: {
    id: 'usr_x77', name: 'Ngozi Eze', email: 'ngozi@example.com', phone: '+234 701 *** 4455', roles: ['referrer'],
    status: 'suspended', kyc_tier: 'Tier 1', risk_score: 88, total_earned_kobo: 150_000, pending_kobo: 0, clawed_back_kobo: 150_000,
    referrals_count: 11, active_referrals: 0,
    referrals: [{ id: 'rf_9', user_id: 'usr_y22', state: 'flagged', reward_kobo: 0, created_at: iso(36) }],
    earnings: [{ id: 'rwd_10044', kind: 'referrer', state: 'clawed_back', amount_kobo: 150_000, created_at: iso(36) }],
    audit: [
      { ts: iso(36), actor: 'system', action: 'case_701 opened — device farm' },
      { ts: iso(30), actor: 'adm_risk', action: 'account suspended' },
      { ts: iso(4), actor: 'adm_risk', action: 'reward rwd_10044 clawed back' },
    ],
    created_at: iso(800),
  },
};

const MISSIONS: MissionAdmin[] = [
  { id: 'ms_1', name: 'First 5 verified referrals', condition: 'Refer 5 KYC-verified users', points_reward: 500, status: 'active', participants: 1240, completions: 380, starts_at: iso(720), ends_at: null },
  { id: 'ms_2', name: 'Property power week', condition: '3 property enquiries from referrals in 7d', points_reward: 750, status: 'active', participants: 410, completions: 92, starts_at: iso(168), ends_at: iso(-168) },
  { id: 'ms_3', name: 'Streak builder', condition: 'At least 1 referral/day for 7 days', points_reward: 300, status: 'draft', participants: 0, completions: 0, starts_at: iso(-48), ends_at: null },
];

const RANKS: RankAdmin[] = [
  { id: 'rk_1', name: 'Starter', threshold_points: 0, badge: 'bronze', perks: 'Standard caps', holders: 8200 },
  { id: 'rk_2', name: 'Connector', threshold_points: 1000, badge: 'silver', perks: 'Priority support', holders: 1340 },
  { id: 'rk_3', name: 'Champion', threshold_points: 5000, badge: 'gold', perks: 'Higher caps, early features', holders: 210 },
  { id: 'rk_4', name: 'Legend', threshold_points: 20000, badge: 'platinum', perks: 'Ambassador track invite', holders: 24 },
];

const LEADERBOARDS: LeaderboardConfig[] = [
  { id: 'lb_1', name: 'Global referrals', scope: 'global', metric: 'referrals', reset_cycle: 'monthly', prize: 'Recognition + badge', status: 'active' },
  { id: 'lb_2', name: 'Lagos activations', scope: 'regional', metric: 'activations', reset_cycle: 'weekly', prize: 'Featured profile', status: 'active' },
  { id: 'lb_3', name: 'Q3 campaign points', scope: 'campaign', metric: 'points', reset_cycle: 'seasonal', prize: 'Top-rank perks', status: 'paused' },
];

const CONTESTS: ContestAdmin[] = [
  { id: 'ct_1', name: 'June referral sprint', starts_at: iso(72), ends_at: iso(-168), participants: 920, status: 'active', prize: 'Champion badge + perks' },
  { id: 'ct_2', name: 'Estate quarter challenge', starts_at: iso(-168), ends_at: iso(-2160), participants: 0, status: 'scheduled', prize: 'Featured ambassador slot' },
];

const ANALYTICS: AnalyticsOverview = {
  k_factor: 0.42,
  k_factor_incl_house: 0.71,
  share_rate: 0.34,
  invite_accept_rate: 0.28,
  referral_cac_kobo: 185_000,
  paid_cac_kobo: 420_000,
  blended_cac_kobo: 290_000,
  trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    k_factor: 0.36 + i * 0.005,
    referral_cac_kobo: 200_000 - i * 1_100,
    paid_cac_kobo: 420_000 + Math.round(Math.sin(i) * 8_000),
  })),
};

const FUNNEL: FunnelData = {
  stages: [
    { stage: 'Invite sent', count: 42000 },
    { stage: 'Click', count: 24000 },
    { stage: 'Signup', count: 8420 },
    { stage: 'KYC', count: 6100 },
    { stage: 'Activated', count: 5140 },
    { stage: 'Retained 30d', count: 3980 },
  ],
  conversion_overall: 3980 / 42000,
};

const SEGMENTATION: SegmentationData = {
  referred_signups: 8420,
  house_default_signups: 5610,
  paid_signups: 6200,
  k_factor_true: 0.42,
  k_factor_naive_incl_house: 0.71,
  segments: [
    { segment: 'referred', label: 'Genuine viral (referred)', signups: 8420, activated: 5140, cac_kobo: 185_000, counts_toward_kfactor: true },
    { segment: 'house_default', label: 'Organic — house_default (§7A.6)', signups: 5610, activated: 3210, cac_kobo: 0, counts_toward_kfactor: false },
    { segment: 'paid', label: 'Paid acquisition', signups: 6200, activated: 3720, cac_kobo: 420_000, counts_toward_kfactor: false },
  ],
};

const AMBASSADORS: Ambassador[] = [
  { id: 'usr_e44', name: 'Aisha Bello', tier: 'Ambassador', status: 'restricted', network_size: 0, total_earned_kobo: 2_480_000, override_earned_kobo: 0, joined_at: iso(3000) },
  { id: 'usr_g99', name: 'Emeka Nwosu', tier: 'Agent', status: 'active', network_size: 42, total_earned_kobo: 4_120_000, override_earned_kobo: 820_000, joined_at: iso(5000) },
  { id: 'usr_k22', name: 'Bola Akande', tier: 'Agent', status: 'active', network_size: 18, total_earned_kobo: 1_640_000, override_earned_kobo: 310_000, joined_at: iso(4200) },
];

const APPLICATIONS: AmbassadorApplication[] = [
  { id: 'app_1', applicant_id: 'usr_m44', applicant_name: 'Sade Williams', requested_tier: 'Ambassador', reach: '32k IG followers (lifestyle)', kyc_status: 'verified', status: 'pending', submitted_at: iso(20) },
  { id: 'app_2', applicant_id: 'usr_n55', applicant_name: 'Ibrahim Musa', requested_tier: 'Agent', reach: 'Estate agent network — Abuja', kyc_status: 'pending', status: 'pending', submitted_at: iso(48) },
  { id: 'app_3', applicant_id: 'usr_p66', applicant_name: 'Grace Obi', requested_tier: 'Ambassador', reach: '8k TikTok', kyc_status: 'failed', status: 'rejected', submitted_at: iso(200) },
];

const NETWORKS: AgentNetwork[] = [
  { id: 'net_1', agent_id: 'usr_g99', agent_name: 'Emeka Nwosu', depth: 2, downline_count: 42, max_depth_cap: 2, verified_activity_kobo: 16_400_000_00, override_paid_kobo: 820_000 },
  { id: 'net_2', agent_id: 'usr_k22', agent_name: 'Bola Akande', depth: 1, downline_count: 18, max_depth_cap: 2, verified_activity_kobo: 6_200_000_00, override_paid_kobo: 310_000 },
];

const OVERRIDE_POLICY: OverridePolicy = {
  activity_based_only: true,
  max_depth: 2,
  override_pct_by_tier: [
    { tier: 'Ambassador', pct: 0, monthly_cap_kobo: 0 },
    { tier: 'Agent', pct: 5, monthly_cap_kobo: 1_000_000_00 },
  ],
  recruitment_earnings_blocked: true,
  house_excluded_from_overrides: true,
  updated_at: iso(72),
};

const MERCHANTS: MerchantSummary[] = [
  { id: 'mer_1', name: 'FreshMart Delivery', category: 'Restaurant', status: 'onboarding', kyc_status: 'pending', campaigns: 1, funded_kobo: 1_500_000_00, take_rate_pct: 12, joined_at: iso(48) },
  { id: 'mer_2', name: 'QuickRide Transport', category: 'Mobility', status: 'active', kyc_status: 'verified', campaigns: 3, funded_kobo: 4_200_000_00, take_rate_pct: 10, joined_at: iso(2000) },
  { id: 'mer_3', name: 'EstatePro Realty', category: 'Property', status: 'suspended', kyc_status: 'verified', campaigns: 2, funded_kobo: 2_800_000_00, take_rate_pct: 15, joined_at: iso(3200) },
];

const MERCHANT_DETAIL: Record<string, MerchantDetail> = {
  mer_2: {
    id: 'mer_2', name: 'QuickRide Transport', category: 'Mobility', status: 'active', kyc_status: 'verified',
    campaigns: 3, funded_kobo: 4_200_000_00, take_rate_pct: 10, joined_at: iso(2000),
    contact_email: 'partners@quickride.example', contact_phone: '+234 909 *** 7788', api_key_active: true,
    revenue_share_pct: 10, outstanding_balance_kobo: 320_000_00,
    campaign_list: [
      { id: 'cmp_5001', name: 'Ride & refer', status: 'active', funded_kobo: 2_000_000_00, spent_kobo: 1_240_000_00 },
      { id: 'cmp_5002', name: 'Airport runs promo', status: 'ended', funded_kobo: 1_200_000_00, spent_kobo: 1_180_000_00 },
      { id: 'cmp_5003', name: 'Weekend cashback', status: 'paused', funded_kobo: 1_000_000_00, spent_kobo: 410_000_00 },
    ],
    invoices: [
      { id: 'inv_1', period: '2026-05', amount_kobo: 420_000_00, status: 'paid' },
      { id: 'inv_2', period: '2026-06', amount_kobo: 320_000_00, status: 'due' },
    ],
    audit: [
      { ts: iso(2000), actor: 'adm_cm', action: 'merchant onboarded & KYC verified' },
      { ts: iso(720), actor: 'adm_cm', action: 'campaign cmp_5001 approved' },
    ],
  },
};

// ─── FINANCE (A-FIN) ───────────────────────────────────────────────────────────
export async function listPayouts(status?: string): Promise<Payout[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? PAYOUTS.filter((p) => p.status === status) : [...PAYOUTS]; }
  return getJson<Payout[]>(`/finance/payouts${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function approvePayout(id: string, note: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Money mutation: backend requires Idempotency-Key + audit event.
  return sendJson<{ ok: true }>('POST', `/finance/payouts/${id}/approve`, { note }, true);
}
export async function getReconciliation(): Promise<Reconciliation> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(RECONCILIATION)); }
  return getJson<Reconciliation>('/finance/reconciliation');
}
export async function getBudgetBurn(): Promise<BudgetBurn> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(BUDGET_BURN)); }
  return getJson<BudgetBurn>('/finance/budget');
}
export async function getFloat(): Promise<Float> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(FLOAT)); }
  return getJson<Float>('/finance/float');
}

// ─── RISK (A-RSK) ────────────────────────────────────────────────────────────
export async function getRiskDashboard(): Promise<RiskDashboard> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(RISK_DASHBOARD)); }
  return getJson<RiskDashboard>('/risk/dashboard');
}
export async function listRiskRules(): Promise<RiskRule[]> {
  if (USE_MOCK) { await delay(); return [...RISK_RULES]; }
  return getJson<RiskRule[]>('/risk/rules');
}
export async function getCase(id: string): Promise<CaseDetail | null> {
  if (USE_MOCK) { await delay(); return CASES.find((c) => c.id === id) ?? null; }
  return getJson<CaseDetail>(`/risk/cases/${id}`);
}
export async function listCases(status?: string): Promise<CaseDetail[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? CASES.filter((c) => c.status === status) : [...CASES]; }
  return getJson<CaseDetail[]>(`/risk/cases${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function listBlocklist(list?: string): Promise<BlocklistEntry[]> {
  if (USE_MOCK) { await delay(); return list && list !== 'all' ? BLOCKLIST.filter((b) => b.list === list) : [...BLOCKLIST]; }
  return getJson<BlocklistEntry[]>(`/risk/blocklist${list && list !== 'all' ? `?list=${encodeURIComponent(list)}` : ''}`);
}
export async function listClawbacks(status?: string): Promise<ClawbackRecord[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? CLAWBACKS.filter((c) => c.status === status) : [...CLAWBACKS]; }
  return getJson<ClawbackRecord[]>(`/risk/clawbacks${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function executeClawbackOps(rewardId: string, reason: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<{ ok: true }>('POST', `/risk/rewards/${rewardId}/clawback`, { reason }, true);
}
export async function listReviewQueue(): Promise<ReviewItem[]> {
  if (USE_MOCK) { await delay(); return [...REVIEW_QUEUE]; }
  return getJson<ReviewItem[]>('/risk/review-queue');
}
export async function decideReview(id: string, decision: 'approved' | 'rejected', note: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<{ ok: true }>('POST', `/risk/review-queue/${id}/decide`, { decision, note }, true);
}

// ─── COMPLIANCE (A-CMPL) ──────────────────────────────────────────────────────
export async function getCompliancePolicy(): Promise<CompliancePolicy> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(COMPLIANCE_POLICY)); }
  return getJson<CompliancePolicy>('/compliance/policy');
}
export async function listDisclosures(status?: string): Promise<Disclosure[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? DISCLOSURES.filter((d) => d.status === status) : [...DISCLOSURES]; }
  return getJson<Disclosure[]>(`/compliance/disclosures${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function listAmlAlerts(status?: string): Promise<AmlAlert[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? AML_ALERTS.filter((a) => a.status === status) : [...AML_ALERTS]; }
  return getJson<AmlAlert[]>(`/compliance/aml${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function listConsents(type?: string): Promise<ConsentRecord[]> {
  if (USE_MOCK) { await delay(); return type && type !== 'all' ? CONSENTS.filter((c) => c.consent_type === type) : [...CONSENTS]; }
  return getJson<ConsentRecord[]>(`/compliance/consents${type && type !== 'all' ? `?type=${encodeURIComponent(type)}` : ''}`);
}

// ─── USERS & GRAPH (A-USR) ────────────────────────────────────────────────────
export async function listReferralUsers(filters?: { role?: string; status?: string; q?: string }): Promise<ReferralUserSummary[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...USERS];
    if (filters?.role && filters.role !== 'all') rows = rows.filter((u) => u.roles.includes(filters.role!));
    if (filters?.status && filters.status !== 'all') rows = rows.filter((u) => u.status === filters.status);
    if (filters?.q) { const q = filters.q.toLowerCase(); rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)); }
    return rows;
  }
  const qs = new URLSearchParams();
  if (filters?.role && filters.role !== 'all') qs.set('role', filters.role);
  if (filters?.status && filters.status !== 'all') qs.set('status', filters.status);
  if (filters?.q) qs.set('q', filters.q);
  const q = qs.toString();
  return getJson<ReferralUserSummary[]>(`/users${q ? `?${q}` : ''}`);
}
export async function getReferralUser360(id: string): Promise<ReferralUser360 | null> {
  if (USE_MOCK) { await delay(); return USER_360[id] ?? USER_360.usr_a12 ?? null; }
  return getJson<ReferralUser360>(`/users/${id}`);
}
export async function interveneUser(input: InterveneInput): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Money-affecting / account-state mutation: audited + idempotent.
  return sendJson<{ ok: true }>('POST', `/users/${input.user_id}/intervene`, input, true);
}

// ─── GAMIFICATION (A-GAM) ─────────────────────────────────────────────────────
export async function listMissionsAdmin(status?: string): Promise<MissionAdmin[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? MISSIONS.filter((m) => m.status === status) : [...MISSIONS]; }
  return getJson<MissionAdmin[]>(`/gamification/missions${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function listRanksAdmin(): Promise<RankAdmin[]> {
  if (USE_MOCK) { await delay(); return [...RANKS]; }
  return getJson<RankAdmin[]>('/gamification/ranks');
}
export async function listLeaderboards(): Promise<LeaderboardConfig[]> {
  if (USE_MOCK) { await delay(); return [...LEADERBOARDS]; }
  return getJson<LeaderboardConfig[]>('/gamification/leaderboards');
}
export async function listContests(): Promise<ContestAdmin[]> {
  if (USE_MOCK) { await delay(); return [...CONTESTS]; }
  return getJson<ContestAdmin[]>('/gamification/contests');
}

// ─── ANALYTICS / BI (A-BI) ────────────────────────────────────────────────────
export async function getAnalytics(): Promise<AnalyticsOverview> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(ANALYTICS)); }
  return getJson<AnalyticsOverview>('/analytics');
}
export async function getFunnel(): Promise<FunnelData> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(FUNNEL)); }
  return getJson<FunnelData>('/analytics/funnel');
}
export async function getSegmentation(): Promise<SegmentationData> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(SEGMENTATION)); }
  return getJson<SegmentationData>('/analytics/segmentation');
}

// ─── AMBASSADORS / AGENTS (A-AMB) ─────────────────────────────────────────────
export async function listAmbassadors(tier?: string): Promise<Ambassador[]> {
  if (USE_MOCK) { await delay(); return tier && tier !== 'all' ? AMBASSADORS.filter((a) => a.tier === tier) : [...AMBASSADORS]; }
  return getJson<Ambassador[]>(`/ambassadors${tier && tier !== 'all' ? `?tier=${encodeURIComponent(tier)}` : ''}`);
}
export async function listApplications(status?: string): Promise<AmbassadorApplication[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? APPLICATIONS.filter((a) => a.status === status) : [...APPLICATIONS]; }
  return getJson<AmbassadorApplication[]>(`/ambassadors/applications${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function decideApplication(id: string, decision: 'approved' | 'rejected', note: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<{ ok: true }>('POST', `/ambassadors/applications/${id}/decide`, { decision, note }, true);
}
export async function listNetworks(): Promise<AgentNetwork[]> {
  if (USE_MOCK) { await delay(); return [...NETWORKS]; }
  return getJson<AgentNetwork[]>('/ambassadors/networks');
}
export async function getOverridePolicy(): Promise<OverridePolicy> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(OVERRIDE_POLICY)); }
  return getJson<OverridePolicy>('/ambassadors/override-policy');
}

// ─── MERCHANTS / PARTNERS (A-MER) ─────────────────────────────────────────────
export async function listMerchants(status?: string): Promise<MerchantSummary[]> {
  if (USE_MOCK) { await delay(); return status && status !== 'all' ? MERCHANTS.filter((m) => m.status === status) : [...MERCHANTS]; }
  return getJson<MerchantSummary[]>(`/merchants${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function getMerchant(id: string): Promise<MerchantDetail | null> {
  if (USE_MOCK) { await delay(); return MERCHANT_DETAIL[id] ?? MERCHANT_DETAIL.mer_2 ?? null; }
  return getJson<MerchantDetail>(`/merchants/${id}`);
}
export async function approveMerchantCampaign(merchantId: string, campaignId: string, note: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<{ ok: true }>('POST', `/merchants/${merchantId}/campaigns/${campaignId}/approve`, { note }, true);
}


// ── Ambassador approval queue (live) ─────────────────────────────────────────
// These hit the endpoints the Go backend actually exposes:
//   GET  /api/referral/admin/network/ambassadors?status=<status>   referral.amb.view
//   POST /api/referral/admin/network/ambassadors/:id/status        referral.amb.manage
//
// The older listAmbassadors/listApplications/decideApplication above target
// paths (/ambassadors/applications/:id/decide) that no backend route serves.
// They are left untouched for the existing directory page rather than
// repointed, since that page's row shape differs from this one.

/** Backend lifecycle for referral_ambassadors.status. */
export type AmbassadorQueueStatus = 'applied' | 'approved' | 'suspended' | 'rejected';

/** A decision an admin can take. 'applied' is the inbox, not a decision. */
export type AmbassadorDecision = 'approved' | 'suspended' | 'rejected';

export interface AmbassadorQueueRow {
  id: string;
  userId: string;
  tier: string;
  status: AmbassadorQueueStatus;
  /** The disclosure the applicant accepted, stored verbatim. */
  disclosureText: string;
  disclosureAcceptedAt: string | null;
  appliedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface BackendAmbassadorRow {
  id: string;
  user_id: string;
  tier: string;
  status: string;
  disclosure_text?: string;
  disclosure_accepted_at?: string | null;
  applied_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
}

function mapAmbassadorRow(a: BackendAmbassadorRow): AmbassadorQueueRow {
  return {
    id: a.id,
    userId: a.user_id,
    tier: a.tier,
    status: (a.status as AmbassadorQueueStatus) ?? 'applied',
    disclosureText: a.disclosure_text ?? '',
    disclosureAcceptedAt: a.disclosure_accepted_at ?? null,
    appliedAt: a.applied_at,
    approvedBy: a.approved_by ?? null,
    approvedAt: a.approved_at ?? null,
  };
}

/** Surfaces the backend's own message — "missing permission: ..." beats "(403)". */
async function readAmbErr(res: Response): Promise<string> {
  try {
    const b = await res.json();
    if (typeof b?.error === 'string' && b.error.trim()) return b.error;
  } catch { /* non-JSON body */ }
  if (res.status === 401) return 'Your admin session has expired. Sign in again.';
  if (res.status === 403) return 'You do not have permission to do that.';
  return `Request failed (${res.status})`;
}

export async function listAmbassadorQueue(status?: string): Promise<AmbassadorQueueRow[]> {
  const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${adminBase()}/network/ambassadors${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readAmbErr(res));
  const body = await res.json();
  const rows = (body?.ambassadors ?? body?.data?.ambassadors ?? []) as BackendAmbassadorRow[];
  return rows.map(mapAmbassadorRow);
}

export async function setAmbassadorStatus(id: string, status: AmbassadorDecision): Promise<void> {
  const res = await fetch(`${adminBase()}/network/ambassadors/${id}/status`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await readAmbErr(res));
}


// ── Override policies (live) ─────────────────────────────────────────────────
// GET /api/referral/admin/network/override-policies  (referral.network.view)
//
// The older getOverridePolicy() above targets /ambassadors/override-policy,
// which no backend route serves, and its shape carries policy-level flags
// (activity_based_only, max_depth, recruitment_earnings_blocked,
// house_excluded_from_overrides) that no endpoint returns — they were mock
// inventions. They are NOT reproduced here: rendering an unsourced
// "Recruitment earnings: Blocked" tile asserts a compliance property the
// system never actually reported.

export interface OverridePolicyRow {
  id: string;
  tier: string;
  /** Override rate in basis points; 200 bps = 2%. */
  overrideBps: number;
  perMemberCapKobo: number;
  monthlyCapKobo: number;
  isActive: boolean;
}

interface BackendOverridePolicy {
  id: string;
  tier: string;
  override_bps: number;
  per_member_cap_kobo: number;
  monthly_cap_kobo: number;
  is_active: boolean;
}

export async function listOverridePolicies(): Promise<OverridePolicyRow[]> {
  const res = await fetch(`${adminBase()}/network/override-policies`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readAmbErr(res));
  const body = await res.json();
  const rows = (body?.policies ?? body?.data?.policies ?? []) as BackendOverridePolicy[];
  return rows
    .map((p) => ({
      id: p.id,
      tier: p.tier,
      overrideBps: p.override_bps ?? 0,
      perMemberCapKobo: p.per_member_cap_kobo ?? 0,
      monthlyCapKobo: p.monthly_cap_kobo ?? 0,
      isActive: !!p.is_active,
    }))
    // The API returns tiers alphabetically (bronze, gold, platinum, silver),
    // which reads as arbitrary in a ladder. Order by rate so the table climbs
    // in tier order without hardcoding tier names the backend may add to.
    .sort((a, b) => a.overrideBps - b.overrideBps);
}


// ── Agent networks (live) ────────────────────────────────────────────────────
// GET /api/referral/admin/network/networks  (referral.amb.view)
//
// The older listNetworks() above targets /ambassadors/networks, which no
// backend route served — the admin endpoint did not exist until it was added
// alongside this. Its shape also carried depth / max_depth_cap /
// verified_activity_kobo / override_paid_kobo, none of which the API returns.

export interface AgentNetworkRow {
  id: string;
  leadUserId: string;
  name: string;
  networkType: string;
  status: string;
  memberCount: number;
  /** Members excluded from override chains (house-attributed, §7A.2). */
  houseAttributedCount: number;
  createdAt: string;
}

interface BackendNetworkSummary {
  id: string;
  lead_user_id: string;
  name: string;
  network_type: string;
  status: string;
  created_at: string;
  member_count: number;
  house_attributed_count: number;
}

export async function listAgentNetworks(status?: string): Promise<AgentNetworkRow[]> {
  const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${adminBase()}/network/networks${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readAmbErr(res));
  const body = await res.json();
  const rows = (body?.networks ?? body?.data?.networks ?? []) as BackendNetworkSummary[];
  return rows.map((n) => ({
    id: n.id,
    leadUserId: n.lead_user_id,
    name: n.name,
    networkType: n.network_type,
    status: n.status,
    memberCount: n.member_count ?? 0,
    houseAttributedCount: n.house_attributed_count ?? 0,
    createdAt: n.created_at,
  }));
}
