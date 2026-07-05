// ── Admin — Paymax Connect control-plane service ─────────────────────────────
// Mock by default (mirrors realtorAdminService). Flip with
// NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK=false to hit the live Go backend at
// /api/connect/admin/*. Read-only in Phase 0 (cases + audit + config views).

import { env } from '@/config/env';
import type {
  ConnectCase,
  ConnectAuditEntry,
  ConnectDashboard,
  ConnectUserSummary,
  ConnectUserDetail,
  IdentityReview,
  UnderageFlag,
  ModerationCaseSummary,
  ModerationCaseDetail,
  MediaReviewItem,
  ConnectFinanceSummary,
  GiftTransaction,
  AmlAlert,
  AmlCaseDetail,
  StrFilingResult,
  ConnectPayout,
  VotingContestSummary,
  VotingContestDetail,
} from '@/types/connectAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/connect/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ─── Mock datasets ────────────────────────────────────────────────────────────
const CASES: ConnectCase[] = [
  { id: 'case_1', reporter_id: 'usr_a', subject_id: 'usr_b', type: 'harassment', source_ref: 'message:abc', status: 'open', severity: 'high', resolution: null, assigned_admin: null, notes: null, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  { id: 'case_2', reporter_id: 'usr_c', subject_id: 'usr_d', type: 'scam', source_ref: 'profile:xyz', status: 'investigating', severity: 'critical', resolution: null, assigned_admin: 'adm_1', notes: 'Possible romance-scam script', created_at: new Date(Date.now() - 26 * 3_600_000).toISOString(), updated_at: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'case_3', reporter_id: 'usr_e', subject_id: 'usr_f', type: 'underage', source_ref: null, status: 'resolved', severity: 'critical', resolution: 'banned', assigned_admin: 'adm_2', notes: 'Confirmed under-18 — banned', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
];

const AUDIT: ConnectAuditEntry[] = [
  { id: 'a1', actor_id: 'adm_1', actor_role: 'admin', action: 'connect.case.update', entity_type: 'connect_case', entity_id: 'case_2', reason: null, created_at: new Date(Date.now() - 5 * 3_600_000).toISOString() },
  { id: 'a2', actor_id: 'usr_e', actor_role: null, action: 'connect.agegate.blocked_minor', entity_type: 'connect_age_gate', entity_id: 'usr_e', reason: null, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  { id: 'a3', actor_id: 'usr_a', actor_role: null, action: 'connect.case.open', entity_type: 'connect_case', entity_id: 'case_1', reason: null, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() },
];

// ─── API ──────────────────────────────────────────────────────────────────────
export async function getCases(status?: string): Promise<ConnectCase[]> {
  if (USE_MOCK) { await delay(); return status ? CASES.filter((c) => c.status === status) : [...CASES]; }
  return getJson<ConnectCase[]>(`/cases${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export async function getAudit(): Promise<ConnectAuditEntry[]> {
  if (USE_MOCK) { await delay(); return [...AUDIT]; }
  return getJson<ConnectAuditEntry[]>('/audit');
}

// ─── Shared helpers ────────────────────────────────────────────────────────────
/** Format kobo (minor units) → "₦1,234.56". Always money via this helper. */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

const iso = (hAgo: number) => new Date(Date.now() - hAgo * 3_600_000).toISOString();

// ════════════════════════════════════════════════════════════════════════════
// §11.1 — Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: ConnectDashboard = {
  dau: 18_420, mau: 142_900, matches_today: 3_184, live_sessions: 47,
  gift_volume_today_kobo: 4_820_650_00, gift_volume_30d_kobo: 118_430_900_00,
  open_cases: 23, aml_alerts_open: 6, payouts_pending: 11,
  identity_queue: 38, underage_queue: 4, media_queue: 52,
  activity: [
    { id: 'ev1', kind: 'aml_alert', label: 'Structuring alert on usr_d (gifting-ring rule)', ref: 'aml_2', created_at: iso(0.4) },
    { id: 'ev2', kind: 'case_opened', label: 'Harassment report → case opened', ref: 'case_1', created_at: iso(2) },
    { id: 'ev3', kind: 'payout_requested', label: 'Creator payout requested ₦250,000.00', ref: 'pay_3', created_at: iso(3) },
    { id: 'ev4', kind: 'identity_review', label: 'BVN verification submitted for review', ref: 'idr_2', created_at: iso(4) },
    { id: 'ev5', kind: 'str_filed', label: 'STR filed with NFIU for aml_1', ref: 'NFIU-STR-2026-0418', created_at: iso(6) },
    { id: 'ev6', kind: 'underage', label: 'Suspected-minor account routed to underage queue', ref: 'und_1', created_at: iso(9) },
  ],
};
export async function getConnectDashboard(): Promise<ConnectDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, activity: [...DASHBOARD.activity] }; }
  return getJson<ConnectDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// §11.2 — Users & identity
// ════════════════════════════════════════════════════════════════════════════
const USERS: ConnectUserSummary[] = [
  { id: 'usr_a', handle: '@ada_live', display_name: 'Ada O.', tier: 2, status: 'active', region: 'Lagos', verification: 'full', flags: [], wallet_balance_kobo: 1_240_500_00, created_at: iso(2400), last_active_at: iso(1) },
  { id: 'usr_b', handle: '@tunde_fx', display_name: 'Tunde A.', tier: 1, status: 'restricted', region: 'Abuja', verification: 'bvn', flags: ['velocity'], wallet_balance_kobo: 86_300_00, created_at: iso(1800), last_active_at: iso(3) },
  { id: 'usr_c', handle: '@zara_creates', display_name: 'Zara M.', tier: 3, status: 'active', region: 'Port Harcourt', verification: 'full', flags: [], wallet_balance_kobo: 9_450_000_00, created_at: iso(5200), last_active_at: iso(0.5) },
  { id: 'usr_d', handle: '@chidi_ng', display_name: 'Chidi N.', tier: 1, status: 'suspended', region: 'Lagos', verification: 'selfie', flags: ['structuring', 'gifting_ring'], wallet_balance_kobo: 12_000_00, created_at: iso(900), last_active_at: iso(28) },
  { id: 'usr_e', handle: '@fave_99', display_name: 'Fave K.', tier: 0, status: 'banned', region: 'Kano', verification: 'unverified', flags: ['underage'], wallet_balance_kobo: 0, created_at: iso(120), last_active_at: iso(72) },
];
export async function listConnectUsers(opts?: { status?: string; tier?: number; search?: string }): Promise<ConnectUserSummary[]> {
  if (USE_MOCK) {
    await delay();
    let r = [...USERS];
    if (opts?.status) r = r.filter((u) => u.status === opts.status);
    if (opts?.tier !== undefined) r = r.filter((u) => u.tier === opts.tier);
    if (opts?.search) { const q = opts.search.toLowerCase(); r = r.filter((u) => u.handle.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q) || u.id.includes(q)); }
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.tier !== undefined) qs.set('tier', String(opts.tier));
  if (opts?.search) qs.set('search', opts.search);
  const s = qs.toString();
  return getJson<ConnectUserSummary[]>(`/users${s ? `?${s}` : ''}`);
}
export async function getConnectUser(id: string): Promise<ConnectUserDetail> {
  if (USE_MOCK) {
    await delay();
    const base = USERS.find((u) => u.id === id) ?? USERS[0];
    return {
      ...base,
      email_masked: 'a••••@gmail.com',   // PII masked — never raw
      phone_masked: '+234 80• ••• ••12',
      modes: base.tier >= 2 ? ['dating', 'creator', 'professional'] : ['dating', 'friendship'],
      lifetime_gift_sent_kobo: 3_120_400_00,
      lifetime_gift_received_kobo: 8_905_200_00,
      bvn_status: base.verification === 'full' || base.verification === 'bvn' ? 'verified' : base.verification === 'unverified' ? 'none' : 'pending',
      nin_status: base.verification === 'full' || base.verification === 'nin' ? 'verified' : base.verification === 'unverified' ? 'none' : 'pending',
      devices: [
        { id: 'dev1', label: 'Android 14 · Tecno', last_seen: iso(1), trusted: true },
        { id: 'dev2', label: 'iOS 17 · iPhone 13', last_seen: iso(40), trusted: false },
      ],
      tier_history: [
        { id: 'th1', from_tier: 0, to_tier: 1, reason: 'Phone + BVN verified', created_at: iso(1700) },
        { id: 'th2', from_tier: 1, to_tier: 2, reason: 'NIN + liveness passed', created_at: iso(800) },
      ],
      open_cases: base.flags.length,
    };
  }
  return getJson<ConnectUserDetail>(`/users/${encodeURIComponent(id)}`);
}

const IDENTITY: IdentityReview[] = [
  { id: 'idr_1', user_id: 'usr_b', handle: '@tunde_fx', doc_type: 'national_id', badge_target: 'id', state: 'pending', doc_ref_masked: 'NIN ••••1234', submitted_at: iso(2), liveness_score: null },
  { id: 'idr_2', user_id: 'usr_d', handle: '@chidi_ng', doc_type: 'selfie_liveness', badge_target: 'selfie', state: 'in_review', doc_ref_masked: 'LIVENESS ••••', submitted_at: iso(5), liveness_score: 0.71 },
  { id: 'idr_3', user_id: 'usr_c', handle: '@zara_creates', doc_type: 'bvn', badge_target: 'bvn', state: 'approved', doc_ref_masked: 'BVN ••••8890', submitted_at: iso(30), liveness_score: 0.96 },
  { id: 'idr_4', user_id: 'usr_e', handle: '@fave_99', doc_type: 'passport', badge_target: 'id', state: 'rejected', doc_ref_masked: 'PASSPORT ••••A21', submitted_at: iso(70), liveness_score: 0.44 },
];
export async function listIdentityReviews(state?: string): Promise<IdentityReview[]> {
  if (USE_MOCK) { await delay(); return state ? IDENTITY.filter((i) => i.state === state) : [...IDENTITY]; }
  return getJson<IdentityReview[]>(`/identity${state ? `?state=${encodeURIComponent(state)}` : ''}`);
}

const UNDERAGE: UnderageFlag[] = [
  { id: 'und_1', user_id: 'usr_e', handle: '@fave_99', signal: 'dob_under_18', declared_dob_masked: '20••-••-14', status: 'confirmed_minor', case_id: 'case_3', created_at: iso(72) },
  { id: 'und_2', user_id: 'usr_x', handle: '@jjkid', signal: 'age_estimation', declared_dob_masked: '20••-••-02', status: 'open', case_id: 'case_4', created_at: iso(9) },
  { id: 'und_3', user_id: 'usr_y', handle: '@small_p', signal: 'report', declared_dob_masked: '19••-••-30', status: 'cleared', case_id: 'case_5', created_at: iso(120) },
];
export async function listUnderageFlags(status?: string): Promise<UnderageFlag[]> {
  if (USE_MOCK) { await delay(); return status ? UNDERAGE.filter((u) => u.status === status) : [...UNDERAGE]; }
  return getJson<UnderageFlag[]>(`/underage${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// §11.4 — Moderation
// ════════════════════════════════════════════════════════════════════════════
const MODERATION: ModerationCaseSummary[] = [
  { id: 'mod_1', case_id: 'case_1', content_type: 'message', reason: 'Harassment reported', ai_reason_codes: ['HARASSMENT', 'THREAT'], reporter_id: 'usr_a', subject_id: 'usr_b', severity: 'high', status: 'open', created_at: iso(2) },
  { id: 'mod_2', case_id: 'case_2', content_type: 'profile', reason: 'Romance-scam script', ai_reason_codes: ['FINANCIAL_SOLICITATION', 'SCAM_SCRIPT', 'OFF_PLATFORM_PRESSURE'], reporter_id: 'usr_c', subject_id: 'usr_d', severity: 'critical', status: 'investigating', created_at: iso(26) },
  { id: 'mod_3', case_id: 'case_6', content_type: 'photo', reason: 'Nudity detected', ai_reason_codes: ['NUDITY', 'ADULT_CONTENT'], reporter_id: null, subject_id: 'usr_z', severity: 'high', status: 'open', created_at: iso(4) },
  { id: 'mod_4', case_id: 'case_7', content_type: 'stream', reason: 'Hate speech in live chat', ai_reason_codes: ['HATE_SPEECH'], reporter_id: 'usr_c', subject_id: 'usr_w', severity: 'normal', status: 'dismissed', created_at: iso(48) },
];
export async function listModerationCases(status?: string): Promise<ModerationCaseSummary[]> {
  if (USE_MOCK) { await delay(); return status ? MODERATION.filter((m) => m.status === status) : [...MODERATION]; }
  return getJson<ModerationCaseSummary[]>(`/moderation${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function getModerationCase(id: string): Promise<ModerationCaseDetail> {
  if (USE_MOCK) {
    await delay();
    const base = MODERATION.find((m) => m.id === id || m.case_id === id) ?? MODERATION[0];
    return {
      ...base,
      ai_confidence: 0.87,
      evidence_ref: `vault://evidence/${base.case_id}`,   // pointer, raw content not rendered
      history: [
        { at: base.created_at, actor: 'ai_safety_service', action: 'flagged', note: `codes: ${base.ai_reason_codes.join(', ')}` },
        { at: iso(1), actor: 'adm_1', action: 'opened_case', note: 'Routed from report — never silent' },
      ],
      notes: base.status === 'investigating' ? 'Cross-referencing with AML alert aml_2' : null,
    };
  }
  return getJson<ModerationCaseDetail>(`/moderation/${encodeURIComponent(id)}`);
}

const MEDIA: MediaReviewItem[] = [
  { id: 'med_1', user_id: 'usr_z', handle: '@new_user_1', media_kind: 'profile_photo', ai_reason_codes: ['NUDITY_SUSPECTED'], ai_confidence: 0.62, state: 'pending', submitted_at: iso(1) },
  { id: 'med_2', user_id: 'usr_q', handle: '@creator_q', media_kind: 'gallery', ai_reason_codes: [], ai_confidence: 0.08, state: 'pending', submitted_at: iso(2) },
  { id: 'med_3', user_id: 'usr_r', handle: '@stream_r', media_kind: 'stream_thumbnail', ai_reason_codes: ['VIOLENCE'], ai_confidence: 0.78, state: 'rejected', submitted_at: iso(20) },
  { id: 'med_4', user_id: 'usr_s', handle: '@photo_s', media_kind: 'profile_photo', ai_reason_codes: [], ai_confidence: 0.03, state: 'approved', submitted_at: iso(40) },
];
export async function listMediaReview(state?: string): Promise<MediaReviewItem[]> {
  if (USE_MOCK) { await delay(); return state ? MEDIA.filter((m) => m.state === state) : [...MEDIA]; }
  return getJson<MediaReviewItem[]>(`/media-review${state ? `?state=${encodeURIComponent(state)}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// §11.5 — Finance, gifting & AML
// ════════════════════════════════════════════════════════════════════════════
const FINANCE: ConnectFinanceSummary = {
  gift_volume_today_kobo: 4_820_650_00, gift_volume_30d_kobo: 118_430_900_00,
  paid_vote_volume_30d_kobo: 31_209_400_00, payout_volume_30d_kobo: 76_540_000_00,
  take_rate_30d_kobo: 14_980_300_00, float_balance_kobo: 204_882_100_00,
  ledger_debits_kobo: 412_004_500_00, ledger_credits_kobo: 412_004_500_00,
  pending_payouts_kobo: 8_910_000_00,
};
export async function getConnectFinance(): Promise<ConnectFinanceSummary> {
  if (USE_MOCK) { await delay(); return { ...FINANCE }; }
  return getJson<ConnectFinanceSummary>('/finance');
}

const GIFTS: GiftTransaction[] = [
  { id: 'gift_1', reference: 'GFT-7782', sender_id: 'usr_a', recipient_id: 'usr_c', gift_label: 'Crown', amount_kobo: 500_000_00, fee_kobo: 25_000_00, tier_at_send: 2, limit_state: 'within', status: 'successful', created_at: iso(1) },
  { id: 'gift_2', reference: 'GFT-7783', sender_id: 'usr_d', recipient_id: 'usr_c', gift_label: 'Rose', amount_kobo: 2_000_00, fee_kobo: 100_00, tier_at_send: 1, limit_state: 'near_limit', status: 'successful', created_at: iso(2) },
  { id: 'gift_3', reference: 'GFT-7784', sender_id: 'usr_d', recipient_id: 'usr_b', gift_label: 'Diamond', amount_kobo: 1_000_000_00, fee_kobo: 50_000_00, tier_at_send: 1, limit_state: 'blocked', status: 'failed', created_at: iso(3) },
  { id: 'gift_4', reference: 'GFT-7785', sender_id: 'usr_b', recipient_id: 'usr_a', gift_label: 'Flower', amount_kobo: 1_000_00, fee_kobo: 50_00, tier_at_send: 1, limit_state: 'within', status: 'reversed', created_at: iso(8) },
];
export async function listGifts(opts?: { status?: string; limit_state?: string }): Promise<GiftTransaction[]> {
  if (USE_MOCK) {
    await delay();
    let r = [...GIFTS];
    if (opts?.status) r = r.filter((g) => g.status === opts.status);
    if (opts?.limit_state) r = r.filter((g) => g.limit_state === opts.limit_state);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.limit_state) qs.set('limit_state', opts.limit_state);
  const s = qs.toString();
  return getJson<GiftTransaction[]>(`/gifts${s ? `?${s}` : ''}`);
}

const AML: AmlAlert[] = [
  { id: 'aml_1', subject_id: 'usr_d', reason_codes: ['STRUCT_SUB_THRESHOLD', 'RAPID_SUCCESSION'], rule: 'structuring', amount_kobo: 4_950_000_00, severity: 'critical', status: 'str_filed', case_id: 'case_2', created_at: iso(30) },
  { id: 'aml_2', subject_id: 'usr_d', reason_codes: ['RING_COLLUSION', 'CIRCULAR_FLOW'], rule: 'gifting_ring', amount_kobo: 12_400_000_00, severity: 'critical', status: 'investigating', case_id: 'case_2', created_at: iso(0.4) },
  { id: 'aml_3', subject_id: 'usr_b', reason_codes: ['VELOCITY_24H'], rule: 'velocity', amount_kobo: 880_000_00, severity: 'high', status: 'open', case_id: null, created_at: iso(3) },
  { id: 'aml_4', subject_id: 'usr_p', reason_codes: ['SANCTIONS_NAME_MATCH'], rule: 'sanctions_hit', amount_kobo: 0, severity: 'critical', status: 'escalated', case_id: 'case_8', created_at: iso(12) },
  { id: 'aml_5', subject_id: 'usr_q', reason_codes: ['SMURF_FANOUT'], rule: 'smurfing', amount_kobo: 6_200_000_00, severity: 'high', status: 'cleared', case_id: null, created_at: iso(60) },
];
export async function listAmlAlerts(status?: string): Promise<AmlAlert[]> {
  if (USE_MOCK) { await delay(); return status ? AML.filter((a) => a.status === status) : [...AML]; }
  return getJson<AmlAlert[]>(`/aml${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function getAmlCase(id: string): Promise<AmlCaseDetail> {
  if (USE_MOCK) {
    await delay();
    const base = AML.find((a) => a.id === id) ?? AML[0];
    return {
      ...base,
      window_txn_count: 27,
      window_volume_kobo: base.amount_kobo,
      str_reference: base.status === 'str_filed' ? 'NFIU-STR-2026-0418' : null,
      str_filed_at: base.status === 'str_filed' ? iso(6) : null,
      history: [
        { at: base.created_at, actor: 'aml_engine', action: 'alert_raised', reason_code: base.reason_codes[0] },
        { at: iso(2), actor: 'compliance_1', action: 'investigation_opened' },
        ...(base.status === 'str_filed' ? [{ at: iso(6), actor: 'compliance_1', action: 'str_filed', reason_code: 'NFIU_24H' }] : []),
      ],
      notes: 'Reason codes only — no raw PII in case record.',
    };
  }
  return getJson<AmlCaseDetail>(`/aml/${encodeURIComponent(id)}`);
}
/** File an STR/SAR with the NFIU. Audited; reason codes only. */
export async function fileStr(alertId: string, payload: { reason_code: string; narrative_ref: string }): Promise<StrFilingResult> {
  if (USE_MOCK) {
    await delay();
    return { str_reference: `NFIU-STR-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`, filed_at: new Date().toISOString(), status: 'submitted' };
  }
  return postJson<StrFilingResult>(`/aml/${encodeURIComponent(alertId)}/str`, payload);
}

const PAYOUTS: ConnectPayout[] = [
  { id: 'pay_1', reference: 'PO-3301', user_id: 'usr_c', handle: '@zara_creates', amount_kobo: 2_500_000_00, fee_kobo: 25_000_00, tier: 3, status: 'pending', requested_at: iso(2) },
  { id: 'pay_2', reference: 'PO-3302', user_id: 'usr_a', handle: '@ada_live', amount_kobo: 480_000_00, fee_kobo: 4_800_00, tier: 2, status: 'review', requested_at: iso(5) },
  { id: 'pay_3', reference: 'PO-3303', user_id: 'usr_b', handle: '@tunde_fx', amount_kobo: 120_000_00, fee_kobo: 1_200_00, tier: 1, status: 'rejected', requested_at: iso(20) },
  { id: 'pay_4', reference: 'PO-3304', user_id: 'usr_c', handle: '@zara_creates', amount_kobo: 5_910_000_00, fee_kobo: 59_100_00, tier: 3, status: 'paid', requested_at: iso(50) },
];
export async function listPayouts(status?: string): Promise<ConnectPayout[]> {
  if (USE_MOCK) { await delay(); return status ? PAYOUTS.filter((p) => p.status === status) : [...PAYOUTS]; }
  return getJson<ConnectPayout[]>(`/payouts${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// §11.6 — Voting integrity
// ════════════════════════════════════════════════════════════════════════════
const CONTESTS: VotingContestSummary[] = [
  { id: 'vc_1', title: 'Connect Star — Season 3', status: 'live', paid_votes: 482_300, free_votes: 1_204_900, paid_vote_volume_kobo: 24_115_000_00, integrity_score: 78, flags_open: 2, starts_at: iso(72), ends_at: iso(-48) },
  { id: 'vc_2', title: 'Lagos Creator Cup', status: 'scheduled', paid_votes: 0, free_votes: 0, paid_vote_volume_kobo: 0, integrity_score: 100, flags_open: 0, starts_at: iso(-120), ends_at: iso(-240) },
  { id: 'vc_3', title: 'Naija Voice Finals', status: 'finalized', paid_votes: 901_200, free_votes: 2_889_000, paid_vote_volume_kobo: 45_060_000_00, integrity_score: 91, flags_open: 0, starts_at: iso(600), ends_at: iso(400) },
  { id: 'vc_4', title: 'Weekend PK Battle', status: 'closed', paid_votes: 33_100, free_votes: 88_400, paid_vote_volume_kobo: 1_655_000_00, integrity_score: 54, flags_open: 3, starts_at: iso(200), ends_at: iso(150) },
];
export async function listVotingContests(status?: string): Promise<VotingContestSummary[]> {
  if (USE_MOCK) { await delay(); return status ? CONTESTS.filter((c) => c.status === status) : [...CONTESTS]; }
  return getJson<VotingContestSummary[]>(`/voting${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function getVotingContest(id: string): Promise<VotingContestDetail> {
  if (USE_MOCK) {
    await delay();
    const base = CONTESTS.find((c) => c.id === id) ?? CONTESTS[0];
    return {
      ...base,
      entrants: [
        { id: 'ent_1', name: 'Ada O.', paid_votes: 210_400, free_votes: 540_200, tally_kobo: 10_520_000_00 },
        { id: 'ent_2', name: 'Zara M.', paid_votes: 180_900, free_votes: 430_700, tally_kobo: 9_045_000_00 },
        { id: 'ent_3', name: 'Tunde A.', paid_votes: 91_000, free_votes: 234_000, tally_kobo: 4_550_000_00 },
      ],
      flags: [
        { id: 'vf_1', signal: 'bot_pattern', reason_codes: ['BURST_SAME_DEVICE', 'NO_HUMAN_DWELL'], affected_votes: 4_200, amount_kobo: 210_000_00, status: 'reviewing', created_at: iso(4) },
        { id: 'vf_2', signal: 'vote_buying', reason_codes: ['CIRCULAR_FUNDING'], affected_votes: 1_100, amount_kobo: 55_000_00, status: 'open', created_at: iso(8) },
      ],
      notes: 'Integrity flags reviewed before results finalize.',
    };
  }
  return getJson<VotingContestDetail>(`/voting/${encodeURIComponent(id)}`);
}
