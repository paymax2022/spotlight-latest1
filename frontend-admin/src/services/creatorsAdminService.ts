// ── Admin — Paymax Creators (Storefront, Tips, Subs, Gated content) control-plane ─
// Mock by default (mirrors events / savings admin services). Flip with
// NEXT_PUBLIC_CREATORS_USE_MOCK=false to hit the live Go backend at /api/creators/admin/*.
// RBAC: creators.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout. Surfaces NL-5 (perks not returns),
// NL-10 (KYC payout gate), NL-11 (content & age safety), NL-12 (immutable audit).

import { env } from '@/config/env';
import type {
  CreatorsDashboard,
  CreatorVerificationItem,
  CreatorDecision,
  CreatorDecisionResult,
  ContentModItem,
  ContentModAction,
  ContentModResult,
  AgeRating,
  CreatorBillingItem,
  CreatorPayoutItem,
  PayoutDecision,
  CreatorPayoutResult,
  CreatorFeeConfig,
  CreatorFeeConfigResult,
  CreatorFraudSignal,
  CreatorFraudAction,
  CreatorFraudActionResult,
} from '@/types/creatorsAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_CREATORS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/creators/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Verified against backend/internal/creators/handler.go. The admin group here
// is mounted at /api/creators/admin, but the module's own route registration
// re-adds a "/creators" segment on top of that (admin.POST("/creators/:creatorId/
// approve", ...) etc.) — so real paths are /api/creators/admin/creators/...,
// not /api/creators/admin/... directly. Functions with a real route throw
// NOT_IN_FIXTURE_MODE; functions with no reachable route throw NO_BACKEND_YET
// instead, since flipping the mock flag would not reach a working call either
// way. See docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_CREATORS_USE_MOCK=false to make this change against the live backend.';
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
const isoAhead = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
// Fixture audit id. Deliberately NOT shaped like a real one: the fixture path
// writes no audit record, and returning `aud_7f3k9x2p` made the response look
// like proof that one exists. If this string ever appears in a support ticket or
// a screenshot, it should be self-evidently not an audit trail.
const aud = () => 'fixture-no-audit-record';

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: CreatorsDashboard = {
  creators_total: 12_840,
  creators_verified: 8_210,
  creators_pending_verification: 214,
  active_subscriptions: 46_320,
  tips_volume_30d_kobo: 184_200_000_00,
  subs_revenue_30d_kobo: 322_800_000_00,
  gated_revenue_30d_kobo: 96_400_000_00,
  gross_creator_earnings_30d_kobo: 603_400_000_00,
  platform_fee_30d_kobo: 60_340_000_00,
  take_rate: 0.10,
  payout_liability_kobo: 148_700_000_00,
  payouts_kyc_hold: 37,
  payouts_kyc_hold_kobo: 22_400_000_00,
  content_pending_moderation: 412,
  content_flagged_open: 28,
  billing_failed_open: 1_120,
  fraud_open: 14,
  earnings_trend: Array.from({ length: 14 }).map((_, i) => {
    const tips = (5_400_000 + i * 180_000 + Math.round(Math.sin(i / 2) * 600_000)) * 100;
    const subs = (9_800_000 + i * 240_000) * 100;
    const gated = (2_900_000 + i * 90_000) * 100;
    return { date: dateStr(13 - i), tips_kobo: tips, subs_kobo: subs, gated_kobo: gated };
  }),
  top_creators: [
    { id: 'cr_8841', handle_masked: '@TiwaVibes•••', earnings_30d_kobo: 18_420_000_00, subscribers: 9_420, category: 'Music' },
    { id: 'cr_8702', handle_masked: '@LagosFoodie•••', earnings_30d_kobo: 12_180_000_00, subscribers: 6_310, category: 'Food' },
    { id: 'cr_8650', handle_masked: '@SkitMasterNG•••', earnings_30d_kobo: 9_640_000_00, subscribers: 14_220, category: 'Comedy' },
    { id: 'cr_8540', handle_masked: '@AfroDance•••', earnings_30d_kobo: 7_220_000_00, subscribers: 4_180, category: 'Dance' },
    { id: 'cr_8501', handle_masked: '@TechBro9ja•••', earnings_30d_kobo: 5_980_000_00, subscribers: 3_040, category: 'Tech' },
  ],
  activity: [
    { id: 'ac1', kind: 'creator_verified', label: 'Creator verified & storefront enabled — "@TiwaVibes"', ref: 'cr_8841', created_at: iso(0.4) },
    { id: 'ac2', kind: 'content_flagged', label: 'Gated post auto-flagged for age review (NL-11) — minor-audience risk', ref: 'cnt_5521', created_at: iso(1.2) },
    { id: 'ac3', kind: 'payout_held', label: 'Creator payout held — KYC tier insufficient (NL-10)', ref: 'po_3310', created_at: iso(2.5) },
    { id: 'ac4', kind: 'sub_failed', label: 'Subscription renewal failed — card declined, retry scheduled', ref: 'sub_2207', created_at: iso(3.1) },
    { id: 'ac5', kind: 'self_tip_flag', label: 'Self-tip pattern flagged — creator tipping own jar from linked wallet', ref: 'fr_2188', created_at: iso(6) },
    { id: 'ac6', kind: 'fee_updated', label: 'Tip fee config updated to 100 bps — recorded to audit (NL-12)', ref: 'cfg_001', created_at: iso(20) },
  ],
};
export async function getCreatorsDashboard(): Promise<CreatorsDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, earnings_trend: [...DASHBOARD.earnings_trend], top_creators: [...DASHBOARD.top_creators], activity: [...DASHBOARD.activity] }; }
  return getJson<CreatorsDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Verification queue
// ════════════════════════════════════════════════════════════════════════════
const VERIFICATIONS: CreatorVerificationItem[] = [
  { id: 'cr_9001', handle_masked: '@NaijaChef•••', legal_name_masked: 'Adaeze O•••', category: 'Food', city: 'Lagos', status: 'submitted', kyc_tier: 'tier2', kyc_verified: true, followers: 24_800, storefront_complete: true, id_docs_present: true, flagged_terms: false, submitted_at: iso(6), created_at: iso(48) },
  { id: 'cr_9002', handle_masked: '@BeatPlug•••', legal_name_masked: 'Tunde A•••', category: 'Music', city: 'Ibadan', status: 'submitted', kyc_tier: 'tier1', kyc_verified: true, followers: 9_200, storefront_complete: false, id_docs_present: true, flagged_terms: false, submitted_at: iso(20), created_at: iso(72) },
  { id: 'cr_9003', handle_masked: '@QuickCashKing•••', legal_name_masked: 'Unknown•••', category: 'Other', city: 'Lagos', status: 'submitted', kyc_tier: 'tier0', kyc_verified: false, followers: 1_200, storefront_complete: true, id_docs_present: false, flagged_terms: true, submitted_at: iso(3), created_at: iso(12) },
  { id: 'cr_9004', handle_masked: '@PHComedy•••', legal_name_masked: 'Chioma E•••', category: 'Comedy', city: 'Port Harcourt', status: 'in_review', kyc_tier: 'tier2', kyc_verified: true, followers: 42_100, storefront_complete: true, id_docs_present: true, flagged_terms: false, submitted_at: iso(30), created_at: iso(60) },
  { id: 'cr_9005', handle_masked: '@FitGirlNG•••', legal_name_masked: 'Bola K•••', category: 'Fitness', city: 'Abuja', status: 'approved', kyc_tier: 'tier3', kyc_verified: true, followers: 88_400, storefront_complete: true, id_docs_present: true, flagged_terms: false, submitted_at: iso(120), created_at: iso(240) },
];
export async function listCreatorVerifications(opts?: { status?: string; q?: string }): Promise<CreatorVerificationItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...VERIFICATIONS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.handle_masked.toLowerCase().includes(q) || r.legal_name_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CreatorVerificationItem[]>(`/verifications${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideCreator(id: string, decision: CreatorDecision, note?: string): Promise<CreatorDecisionResult> {
  if (USE_MOCK) throw new Error(`Deciding a creator verification ${NOT_IN_FIXTURE_MODE}`);
  // backend: only two verbs exist — POST /creators/:creatorId/approve (AdminApprove)
  // and POST /creators/:creatorId/suspend (AdminSuspend), both with NO body (uid
  // comes from auth context). "reject" and "request_changes" have no backend
  // equivalent — Service has no Reject method at all.
  if (decision === 'reject' || decision === 'request_changes') {
    throw new Error(`Deciding "${decision}" on a creator verification ${NO_BACKEND_YET}`);
  }
  const verb = decision === 'approve' ? 'approve' : 'suspend';
  return sendJson<CreatorDecisionResult>('POST', `/creators/${id}/${verb}`, {});
}

// ════════════════════════════════════════════════════════════════════════════
// C · Content moderation + age controls (NL-11)
// ════════════════════════════════════════════════════════════════════════════
const CONTENT: ContentModItem[] = [
  { id: 'cnt_5521', creator_handle_masked: '@SkitMasterNG•••', kind: 'gated_post', title: 'Behind the scenes (18+)', is_paid: true, price_kobo: 2_000_00, age_rating: 'mature_18', status: 'flagged', auto_flags: ['minor_audience_risk', 'suggestive_thumbnail'], reports_count: 4, submitted_at: iso(1), created_at: iso(2) },
  { id: 'cnt_5530', creator_handle_masked: '@NaijaChef•••', kind: 'video', title: 'Jollof rice masterclass', is_paid: false, price_kobo: 0, age_rating: 'all', status: 'pending', auto_flags: [], reports_count: 0, submitted_at: iso(5), created_at: iso(6) },
  { id: 'cnt_5540', creator_handle_masked: '@BeatPlug•••', kind: 'audio', title: 'Unreleased single (preview)', is_paid: true, price_kobo: 1_500_00, age_rating: 'teen', status: 'pending', auto_flags: ['copyright_match_low'], reports_count: 1, submitted_at: iso(8), created_at: iso(9) },
  { id: 'cnt_5560', creator_handle_masked: '@QuickCashKing•••', kind: 'gated_post', title: 'Make ₦1m daily — paid guide', is_paid: true, price_kobo: 5_000_00, age_rating: 'all', status: 'pending', auto_flags: ['scam_keywords', 'financial_promise'], reports_count: 9, submitted_at: iso(2), created_at: iso(3) },
  { id: 'cnt_5580', creator_handle_masked: '@FitGirlNG•••', kind: 'video', title: 'Home workout routine', is_paid: false, price_kobo: 0, age_rating: 'all', status: 'approved', auto_flags: [], reports_count: 0, submitted_at: iso(40), created_at: iso(48) },
];
export async function listContentModeration(opts?: { status?: string; age_rating?: string; q?: string }): Promise<ContentModItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CONTENT];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.age_rating) rows = rows.filter((r) => r.age_rating === opts.age_rating);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.creator_handle_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.age_rating) qs.set('age_rating', opts.age_rating);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ContentModItem[]>(`/content${qs.toString() ? `?${qs}` : ''}`);
}
export async function moderateContent(id: string, action: ContentModAction, age_rating?: AgeRating, note?: string): Promise<ContentModResult> {
  if (USE_MOCK) throw new Error(`Moderating content ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /creators/content/:contentId/moderate (AdminModerate), body
  // {decision: "APPROVED"|"REJECTED", reason} — the OLD /content/:id/moderate
  // path, {action, age_rating, note} fields, and lowercase action values all
  // matched nothing. "flag" has no backend equivalent (ModerationState is only
  // PENDING/APPROVED/REJECTED); age_rating is not accepted by this endpoint at
  // all — it is never persisted server-side regardless of what's sent.
  if (action === 'flag') throw new Error(`Flagging content ${NO_BACKEND_YET}`);
  return sendJson<ContentModResult>('POST', `/creators/content/${id}/moderate`, {
    decision: action === 'approve' ? 'APPROVED' : 'REJECTED',
    reason: note,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// D · Subscription billing + failed-renewal
// ════════════════════════════════════════════════════════════════════════════
const BILLING: CreatorBillingItem[] = [
  { id: 'sub_2207', subscriber_masked: 'Emeka•••', creator_handle_masked: '@TiwaVibes•••', tier_name: 'Gold', amount_kobo: 3_000_00, cycle: 'monthly', status: 'failed', retries: 2, max_retries: 4, next_attempt_at: isoAhead(24), last_failure_reason: 'card_declined: insufficient funds', started_at: dateStr(120), created_at: iso(3) },
  { id: 'sub_2210', subscriber_masked: 'Funke•••', creator_handle_masked: '@LagosFoodie•••', tier_name: 'Silver', amount_kobo: 1_500_00, cycle: 'monthly', status: 'past_due', retries: 1, max_retries: 4, next_attempt_at: isoAhead(6), last_failure_reason: 'card_declined: do_not_honour', started_at: dateStr(90), created_at: iso(12) },
  { id: 'sub_2240', subscriber_masked: 'Ibrahim•••', creator_handle_masked: '@SkitMasterNG•••', tier_name: 'Bronze', amount_kobo: 1_000_00, cycle: 'monthly', status: 'active', retries: 0, max_retries: 4, next_attempt_at: isoAhead(720), last_failure_reason: null, started_at: dateStr(30), created_at: iso(48) },
  { id: 'sub_2260', subscriber_masked: 'Ngozi•••', creator_handle_masked: '@FitGirlNG•••', tier_name: 'Annual VIP', amount_kobo: 30_000_00, cycle: 'annual', status: 'cancelled', retries: 0, max_retries: 4, next_attempt_at: null, last_failure_reason: 'user_cancelled', started_at: dateStr(400), created_at: iso(72) },
];
export async function listCreatorBilling(opts?: { status?: string; q?: string }): Promise<CreatorBillingItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...BILLING];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.subscriber_masked.toLowerCase().includes(q) || r.creator_handle_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CreatorBillingItem[]>(`/billing${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Payout queue (KYC-gated, NL-10)
// ════════════════════════════════════════════════════════════════════════════
const PAYOUTS: CreatorPayoutItem[] = [
  { id: 'po_3301', creator_handle_masked: '@TiwaVibes•••', kyc_tier: 'tier2', kyc_verified: true, gross_earnings_kobo: 18_420_000_00, fees_kobo: 1_842_000_00, net_payable_kobo: 16_578_000_00, status: 'pending', bank_masked: 'GTB ••• 4821', requested_at: iso(4), created_at: iso(4) },
  { id: 'po_3310', creator_handle_masked: '@QuickCashKing•••', kyc_tier: 'tier0', kyc_verified: false, gross_earnings_kobo: 2_400_000_00, fees_kobo: 240_000_00, net_payable_kobo: 2_160_000_00, status: 'kyc_hold', bank_masked: 'OPay ••• 0091', requested_at: iso(8), created_at: iso(8) },
  { id: 'po_3320', creator_handle_masked: '@LagosFoodie•••', kyc_tier: 'tier3', kyc_verified: true, gross_earnings_kobo: 12_180_000_00, fees_kobo: 1_218_000_00, net_payable_kobo: 10_962_000_00, status: 'paid', bank_masked: 'Access ••• 7733', requested_at: iso(120), created_at: iso(120) },
  { id: 'po_3340', creator_handle_masked: '@AfroDance•••', kyc_tier: 'tier1', kyc_verified: true, gross_earnings_kobo: 7_220_000_00, fees_kobo: 722_000_00, net_payable_kobo: 6_498_000_00, status: 'pending', bank_masked: 'Kuda ••• 2210', requested_at: iso(10), created_at: iso(10) },
];
export async function listCreatorPayouts(opts?: { status?: string; q?: string }): Promise<CreatorPayoutItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PAYOUTS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.creator_handle_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CreatorPayoutItem[]>(`/payouts${qs.toString() ? `?${qs}` : ''}`);
}
export async function decidePayout(id: string, decision: PayoutDecision, note?: string): Promise<CreatorPayoutResult> {
    // No endpoint exists for this action, so there is nothing this can do but
    // say so. Returning a success value here told the operator the decision had
    // been applied when nothing had — see docs/audit/ADMIN_SIMULATED_WRITES.md.
    // Client-side validation above still runs, so bad input is still caught.
    throw new Error(
      'Creator payout decisions is not available in this environment — no backend endpoint exists yet. Nothing was changed.',
    );
  return sendJson<CreatorPayoutResult>('POST', `/payouts/${id}/decide`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// F · Fee config
// ════════════════════════════════════════════════════════════════════════════
const FEE_CONFIG: CreatorFeeConfig = {
  generated_at: iso(0.2),
  tip_fee_bps: 100,
  subscription_fee_bps: 1000,
  gated_content_fee_bps: 1500,
  min_payout_kobo: 5_000_00,
  payout_kyc_min_tier: 'tier2',
  hold_period_days: 7,
  updated_by_masked: 'admin:fola•••',
  updated_at: iso(20),
};
export async function getFeeConfig(): Promise<CreatorFeeConfig> {
  if (USE_MOCK) { await delay(); return { ...FEE_CONFIG }; }
  return getJson<CreatorFeeConfig>('/fees');
}
export async function updateFeeConfig(patch: Partial<CreatorFeeConfig>, note?: string): Promise<CreatorFeeConfigResult> {
  // No backend at all: no fee-config route (GET or PATCH) exists anywhere in
  // backend/internal/creators — grepped for "fee config"/"FeeConfig"/
  // "tip_fee"/"subscription_fee"/"gated_content_fee", zero matches.
  if (USE_MOCK) throw new Error(`Updating creator fee config ${NO_BACKEND_YET}`);
  return sendJson<CreatorFeeConfigResult>('PATCH', '/fees', { ...patch, note });
}

// ════════════════════════════════════════════════════════════════════════════
// G · Abuse / self-tip fraud
// ════════════════════════════════════════════════════════════════════════════
const FRAUD: CreatorFraudSignal[] = [
  { id: 'fr_2188', creator_handle_masked: '@SkitMasterNG•••', kind: 'self_tip', subject_masked: 'wlt linked•••', detail: 'Creator tipping own jar from a freshly funded linked wallet — 18 tips in 4 minutes', severity: 'high', amount_kobo: 1_800_000_00, status: 'open', created_at: iso(2) },
  { id: 'fr_2190', creator_handle_masked: '@QuickCashKing•••', kind: 'chargeback_ring', subject_masked: '6 subscribers•••', detail: 'Cluster of subs paid then charged back within 48h — likely card-testing ring', severity: 'critical', amount_kobo: 3_000_000_00, status: 'open', created_at: iso(5) },
  { id: 'fr_2201', creator_handle_masked: '@BeatPlug•••', kind: 'tip_wash', subject_masked: 'wlt Ade•••', detail: 'Tips routed back to sender via P2P shortly after — possible wash/layering', severity: 'medium', amount_kobo: 420_000_00, status: 'investigating', created_at: iso(9) },
  { id: 'fr_2215', creator_handle_masked: '@AfroDance•••', kind: 'content_recycle', subject_masked: 'cnt batch•••', detail: 'Re-uploading another creator\'s content behind paywall', severity: 'low', amount_kobo: 90_000_00, status: 'cleared', created_at: iso(30) },
];
export async function listCreatorFraud(opts?: { status?: string; kind?: string; q?: string }): Promise<CreatorFraudSignal[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...FRAUD];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.subject_masked.toLowerCase().includes(q) || r.creator_handle_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.kind) qs.set('kind', opts.kind);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CreatorFraudSignal[]>(`/fraud${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideCreatorFraud(id: string, action: CreatorFraudAction, note?: string): Promise<CreatorFraudActionResult> {
  // No backend at all: grepped backend/internal/creators for "fraud" — zero
  // matches anywhere in handler.go/service.go/model.go. No fraud queue, no
  // fraud action verb, nothing wired.
  if (USE_MOCK) throw new Error(`Actioning a creator fraud signal ${NO_BACKEND_YET}`);
  return sendJson<CreatorFraudActionResult>('POST', `/fraud/${id}/action`, { action, note });
}
