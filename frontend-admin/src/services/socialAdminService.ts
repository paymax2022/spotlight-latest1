// ── Admin — Paymax Social Pay (P2P / Split / Pools) ops control-plane service ──
// Mock by default (mirrors stays / savings admin services). Flip with
// NEXT_PUBLIC_SOCIAL_USE_MOCK=false to hit the live Go backend at /api/social/admin/*.
// RBAC: social.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout. Surfaces NL-8 (money is a ledger;
// corrections are reversing entries only), NL-10 (KYC gates & AML velocity limits),
// NL-12 (immutable audit on every state change).

import { env } from '@/config/env';
import type {
  SocialDashboard,
  SocialLimits,
  VelocityLimit,
  UpdateLimitsResult,
  ReversalRecord,
  ReverseTxnResult,
  SocialDispute,
  CashtagRecord,
  CashtagDecision,
  CashtagReviewResult,
} from '@/types/socialAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_SOCIAL_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/social/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Verified against backend/internal/social (Handler.Register): the only admin
// route registered is GET /splits/:id. No reversal, cashtag-review, or
// velocity-limits mutation exists anywhere in the module or in the ledger
// service it would depend on — grepped for "Reverse" as a ledger method
// (zero matches, the ledger has no reversal capability at all), "/cashtags"
// (the cashtag package only implements Claim/Resolve/HandleFor, no admin
// moderation), and "/limits" (AML config is a static Go struct literal with
// no persisted/dynamic store or setter). See docs/audit/ADMIN_SIMULATED_WRITES.md.
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

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: SocialDashboard = {
  p2p_volume_today_kobo: 184_200_000_00,
  p2p_volume_30d_kobo: 5_104_800_000_00,
  p2p_count_today: 12_840,
  p2p_count_30d: 384_120,
  avg_p2p_value_kobo: 13_290_00,
  splits_active: 1_420,
  split_outstanding_kobo: 38_400_000_00,
  pools_active: 612,
  pool_held_kobo: 142_900_000_00,
  reversals_pending: 9,
  reversals_value_kobo: 2_140_000_00,
  disputes_open: 14,
  limit_breaches_24h: 31,
  aml_flags_open: 6,
  cashtags_flagged: 4,
  volume_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    p2p_kobo: (150_000_000 + i * 2_400_000 + Math.round(Math.sin(i / 2) * 8_000_000)) * 100,
    split_kobo: (8_000_000 + i * 120_000 + Math.round(Math.cos(i / 3) * 900_000)) * 100,
    pool_kobo: (4_000_000 + i * 90_000 + Math.round(Math.sin(i / 4) * 600_000)) * 100,
  })),
  activity: [
    { id: 'ev1', kind: 'reversal', label: 'Reversal posted — wrong-recipient P2P corrected via reversing entry (NL-8)', ref: 'rev_2201', created_at: iso(0.3) },
    { id: 'ev2', kind: 'limit_breach', label: 'Velocity limit breach blocked — Tier-1 daily cap exceeded (NL-10)', ref: 'lim_8841', created_at: iso(0.7) },
    { id: 'ev3', kind: 'dispute_opened', label: 'Payment dispute opened — goods-not-received claim on P2P send', ref: 'dsp_5510', created_at: iso(1.4) },
    { id: 'ev4', kind: 'pool_payout', label: 'Group pool payout released to organiser — ₦620,000.00', ref: 'pool_410', created_at: iso(3.2) },
    { id: 'ev5', kind: 'split_settled', label: 'Split bill fully collected — 6/6 shares settled', ref: 'spl_9920', created_at: iso(5) },
    { id: 'ev6', kind: 'aml_flag', label: 'AML review raised — structuring pattern across cashtag handle', ref: 'aml_330', created_at: iso(8) },
  ],
};
export async function getSocialDashboard(): Promise<SocialDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, volume_trend: [...DASHBOARD.volume_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<SocialDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Velocity / AML limits (NL-10)
// ════════════════════════════════════════════════════════════════════════════
const LIMITS: SocialLimits = {
  updated_at: iso(72),
  limits: [
    { id: 'lim_t1', scope: 'tier1', label: 'Tier 1 (BVN only)', per_txn_kobo: 50_000_00, daily_kobo: 200_000_00, monthly_kobo: 2_000_000_00, daily_count: 20, aml_review_threshold_kobo: 100_000_00, enabled: true, updated_at: iso(72) },
    { id: 'lim_t2', scope: 'tier2', label: 'Tier 2 (BVN + ID)', per_txn_kobo: 500_000_00, daily_kobo: 2_000_000_00, monthly_kobo: 20_000_000_00, daily_count: 60, aml_review_threshold_kobo: 1_000_000_00, enabled: true, updated_at: iso(72) },
    { id: 'lim_t3', scope: 'tier3', label: 'Tier 3 (full KYC + address)', per_txn_kobo: 5_000_000_00, daily_kobo: 20_000_000_00, monthly_kobo: 200_000_000_00, daily_count: 120, aml_review_threshold_kobo: 5_000_000_00, enabled: true, updated_at: iso(72) },
    { id: 'lim_g', scope: 'global', label: 'Global circuit-breaker', per_txn_kobo: 10_000_000_00, daily_kobo: 50_000_000_00, monthly_kobo: 500_000_000_00, daily_count: 200, aml_review_threshold_kobo: 5_000_000_00, enabled: true, updated_at: iso(72) },
  ],
};
export async function getLimits(): Promise<SocialLimits> {
  if (USE_MOCK) { await delay(); return { ...LIMITS, limits: LIMITS.limits.map((l) => ({ ...l })) }; }
  return getJson<SocialLimits>('/limits');
}
export async function updateLimits(limits: VelocityLimit[]): Promise<UpdateLimitsResult> {
  // The OLD fixture message here also fabricated a compliance claim ("Before/
  // after recorded to immutable audit") — the same pattern
  // docs/audit/ADMIN_SIMULATED_WRITES.md calls "the most dangerous strings in
  // this codebase", missed by the checker's claim-pattern regex only because
  // of a lowercase "recorded" vs its capitalized "Recorded". Removed
  // regardless — see the comment above for why there's no backend to reach.
  if (USE_MOCK) throw new Error(`Updating velocity limits ${NO_BACKEND_YET}`);
  return sendJson<UpdateLimitsResult>('PUT', '/limits', { limits });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Reversal tooling
// ════════════════════════════════════════════════════════════════════════════
const REVERSALS: ReversalRecord[] = [
  { id: 'rev_2201', txn_ref: 'p2p_99120', from_masked: 'Ifeoma C•••', to_masked: 'Wrong R•••', amount_kobo: 45_000_00, reason: 'wrong_recipient', status: 'pending', requested_by_masked: 'agent_kola', requested_at: iso(0.3), resolved_at: null },
  { id: 'rev_2190', txn_ref: 'p2p_98840', from_masked: 'Bisi A•••', to_masked: 'Mule X•••', amount_kobo: 120_000_00, reason: 'fraud', status: 'pending', requested_by_masked: 'risk_team', requested_at: iso(4), resolved_at: null },
  { id: 'rev_2155', txn_ref: 'p2p_98010', from_masked: 'Uche N•••', to_masked: 'Sade O•••', amount_kobo: 15_000_00, reason: 'duplicate', status: 'reversed', requested_by_masked: 'agent_tomi', requested_at: iso(30), resolved_at: iso(28) },
  { id: 'rev_2090', txn_ref: 'p2p_96550', from_masked: 'Femi L•••', to_masked: 'Tola B•••', amount_kobo: 8_000_00, reason: 'wrong_recipient', status: 'rejected', requested_by_masked: 'agent_kola', requested_at: iso(72), resolved_at: iso(70) },
];
export async function listReversals(opts?: { status?: string; q?: string }): Promise<ReversalRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...REVERSALS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.txn_ref.toLowerCase().includes(q) || r.from_masked.toLowerCase().includes(q) || r.to_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ReversalRecord[]>(`/reversals${qs.toString() ? `?${qs}` : ''}`);
}
export async function reverseTxn(id: string, reason: string): Promise<ReverseTxnResult> {
  if (USE_MOCK) throw new Error(`Reversing a transaction ${NO_BACKEND_YET}`);
  return sendJson<ReverseTxnResult>('POST', `/reversals/${id}/reverse`, { reason });
}

// ════════════════════════════════════════════════════════════════════════════
// D · Disputes (request / payment / split / pool)
// ════════════════════════════════════════════════════════════════════════════
const DISPUTES: SocialDispute[] = [
  { id: 'dsp_5510', kind: 'payment', txn_ref: 'p2p_99001', complainant_masked: 'Tola B•••', respondent_masked: 'Seller K•••', amount_kobo: 85_000_00, reason: 'goods_not_received', status: 'open', opened_at: iso(1.4), updated_at: iso(1.4) },
  { id: 'dsp_5490', kind: 'request', txn_ref: 'req_44120', complainant_masked: 'Ada N•••', respondent_masked: 'Chika E•••', amount_kobo: 20_000_00, reason: 'unauthorised_request', status: 'investigating', opened_at: iso(20), updated_at: iso(6) },
  { id: 'dsp_5450', kind: 'split', txn_ref: 'spl_9810', complainant_masked: 'Yemi S•••', respondent_masked: 'Group host', amount_kobo: 12_500_00, reason: 'incorrect_share', status: 'resolved', opened_at: iso(96), updated_at: iso(40) },
  { id: 'dsp_5400', kind: 'pool', txn_ref: 'pool_402', complainant_masked: 'Musa I•••', respondent_masked: 'Pool organiser', amount_kobo: 60_000_00, reason: 'payout_not_received', status: 'rejected', opened_at: iso(140), updated_at: iso(100) },
];
export async function listSocialDisputes(opts?: { status?: string; kind?: string; q?: string }): Promise<SocialDispute[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...DISPUTES];
    if (opts?.status) rows = rows.filter((d) => d.status === opts.status);
    if (opts?.kind) rows = rows.filter((d) => d.kind === opts.kind);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((d) => d.txn_ref.toLowerCase().includes(q) || d.complainant_masked.toLowerCase().includes(q) || d.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<SocialDispute[]>(`/disputes${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Cashtag directory (handle abuse / impersonation review)
// ════════════════════════════════════════════════════════════════════════════
const CASHTAGS: CashtagRecord[] = [
  { id: 'tag_1', handle: '@chioma', owner_masked: 'Chioma A•••', status: 'verified', flag_reason: null, txn_count_30d: 142, volume_30d_kobo: 1_840_000_00, created_at: dateStr(220) },
  { id: 'tag_2', handle: '@gtbank', owner_masked: 'Unknown U•••', status: 'flagged', flag_reason: 'impersonation', txn_count_30d: 9, volume_30d_kobo: 420_000_00, created_at: dateStr(4) },
  { id: 'tag_3', handle: '@paymax', owner_masked: 'system', status: 'reserved', flag_reason: 'reserved', txn_count_30d: 0, volume_30d_kobo: 0, created_at: dateStr(500) },
  { id: 'tag_4', handle: '@quickloan', owner_masked: 'Suspect S•••', status: 'flagged', flag_reason: 'abuse', txn_count_30d: 311, volume_30d_kobo: 12_400_000_00, created_at: dateStr(12) },
  { id: 'tag_5', handle: '@tundeb', owner_masked: 'Tunde B•••', status: 'active', flag_reason: null, txn_count_30d: 64, volume_30d_kobo: 980_000_00, created_at: dateStr(60) },
];
export async function listCashtags(opts?: { status?: string; q?: string }): Promise<CashtagRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CASHTAGS];
    if (opts?.status) rows = rows.filter((c) => c.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((c) => c.handle.toLowerCase().includes(q) || c.owner_masked.toLowerCase().includes(q) || c.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CashtagRecord[]>(`/cashtags${qs.toString() ? `?${qs}` : ''}`);
}
export async function reviewCashtag(id: string, decision: CashtagDecision, note?: string): Promise<CashtagReviewResult> {
  if (USE_MOCK) throw new Error(`Reviewing a cashtag ${NO_BACKEND_YET}`);
  return sendJson<CashtagReviewResult>('POST', `/cashtags/${id}/review`, { decision, note });
}
