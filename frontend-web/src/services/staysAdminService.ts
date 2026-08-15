// ── Admin — Paymax Stays (hotel booking) ops control-plane service ───────────
// Mock by default (mirrors connect / insurance admin services). Flip with
// NEXT_PUBLIC_STAYS_USE_MOCK=false to hit the live Go backend at /api/stays/admin/*.
// RBAC: stays.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout. Source-rail + supplier + FX are
// always disclosed (PRD §5 dual-rail, §12 money/recon).

import { env } from '@/config/env';
import type {
  StaysDashboard,
  Supplier,
  MappingRecord,
  MappingResolution,
  MappingStatus,
  ModerationItem,
  ModerationDecision,
  ModerationStatus,
  ContentQaItem,
  CoverageRow,
  ReservationSummary,
  ReservationDetail,
  ManualActionResult,
  ManualActionType,
  RefundRequest,
  RefundDecision,
  RefundStatus,
  OverbookingCase,
  ReconciliationSummary,
  BreakResolution,
  BreakStatus,
  HotelPayout,
  MarkupRule,
  FxConfig,
  CommissionEntry,
  LoyaltyConfig,
  Promotion,
  Review,
  ReviewModeration,
  ReviewStatus,
  CmsEntry,
  MerchandisingSlot,
  FraudCase,
  ReliabilityScore,
  Agent,
  KycCase,
  KycDecision,
  KycStatus,
  AdminUserRole,
  AuditLog,
  PlatformConfig,
  NotificationTemplate,
} from '@/types/staysAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_STAYS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/stays/admin');
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
// Generic minor-unit money formatter for non-NGN supplier currencies (disclosure).
export function formatMoney(minor: number, currency: string): string {
  if (currency === 'NGN') return formatNaira(minor);
  const major = (minor ?? 0) / 100;
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  return `${sym[currency] ?? currency + ' '}${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const dateAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════
// A · Overview / supply
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: StaysDashboard = {
  gmv_today_kobo: 41_820_000_00,
  gmv_30d_kobo: 1_184_500_000_00,
  bookings_today: 312,
  bookings_30d: 9_840,
  take_rate: 0.114,
  conversion: 0.038,
  net_revenue_30d_kobo: 135_033_000_00,
  commission_30d_kobo: 28_410_000_00,
  reconciliation_breaks_open: 9,
  reconciliation_break_value_kobo: 7_240_500_00,
  refunds_pending: 17,
  paid_unconfirmed: 3,
  mapping_conflicts_open: 12,
  moderation_pending: 8,
  avg_booking_value_kobo: 120_375_00,
  supplier_mix: [
    { supplier: 'ratehawk', rail: 'BEDBANK', bookings: 5_120, gmv_kobo: 642_300_000_00, share_pct: 0.542 },
    { supplier: 'zentrumhub', rail: 'BEDBANK', bookings: 2_940, gmv_kobo: 358_200_000_00, share_pct: 0.302 },
    { supplier: 'direct', rail: 'DIRECT', bookings: 1_780, gmv_kobo: 184_000_000_00, share_pct: 0.155 },
  ],
  gmv_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    gmv_kobo: (34_000_000 + i * 920_000 + Math.round(Math.sin(i / 2) * 3_200_000)) * 100,
    net_kobo: (3_900_000 + i * 110_000 + Math.round(Math.cos(i / 3) * 410_000)) * 100,
  })),
  activity: [
    { id: 'ev1', kind: 'paid_unconfirmed', label: 'Paid-but-unconfirmed flagged — RateHawk prebook OK, book pending', ref: 'rsv_88120', created_at: iso(0.3) },
    { id: 'ev2', kind: 'booking_confirmed', label: 'Booking confirmed — Eko Hotels & Suites (direct) ₦485,000.00', ref: 'rsv_88210', created_at: iso(0.8) },
    { id: 'ev3', kind: 'reconciliation_break', label: 'Net-rate mismatch on ZentrumHub statement batch', ref: 'rec_5521', created_at: iso(1.5) },
    { id: 'ev4', kind: 'book_failed', label: 'Book failed → hold auto-released, no debit (sold out at supplier)', ref: 'rsv_88190', created_at: iso(2) },
    { id: 'ev5', kind: 'mapping_conflict', label: 'Cross-supplier conflict — Radisson Blu Ikeja (RateHawk vs ZentrumHub)', ref: 'map_3310', created_at: iso(3) },
    { id: 'ev6', kind: 'payout_sent', label: 'Hotel payout sent (Naira) — Transcorp Hilton ₦2,140,000.00', ref: 'pay_7720', created_at: iso(6) },
    { id: 'ev7', kind: 'refund_issued', label: 'Fast-path refund issued — paid-but-unconfirmed ₦96,000.00', ref: 'ref_4401', created_at: iso(9) },
  ],
};
export async function getDashboard(): Promise<StaysDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, supplier_mix: [...DASHBOARD.supplier_mix], gmv_trend: [...DASHBOARD.gmv_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<StaysDashboard>('/dashboard');
}

const SUPPLIERS: Supplier[] = [
  {
    supplier_code: 'ratehawk', display_name: 'RateHawk (Emerging Travel Group)', rail: 'BEDBANK', status: 'healthy',
    base_url: 'https://api.worldota.net/api/b2b/v3', api_key_masked: 'rh_live_••••••••7c41', webhook_secret_masked: 'whsec_••••••a91c',
    sandbox: false, uptime_pct: 99.92, search_p95_ms: 1_420, prebook_success_pct: 0.981, book_success_pct: 0.965,
    properties_live: 184_200, open_breaks: 3, currencies: ['USD', 'EUR', 'NGN'], updated_at: iso(0.5),
  },
  {
    supplier_code: 'zentrumhub', display_name: 'ZentrumHub Bedbank', rail: 'BEDBANK', status: 'degraded',
    base_url: 'https://api.zentrumhub.com/v1', api_key_masked: 'zh_live_••••••••2b13', webhook_secret_masked: 'whsec_••••••2d77',
    sandbox: false, uptime_pct: 98.41, search_p95_ms: 3_980, prebook_success_pct: 0.942, book_success_pct: 0.918,
    properties_live: 96_400, open_breaks: 5, currencies: ['USD', 'GBP', 'NGN'], updated_at: iso(0.4),
  },
  {
    supplier_code: 'direct', display_name: 'Paymax Direct Inventory (ari-svc)', rail: 'DIRECT', status: 'healthy',
    base_url: 'internal://stays/ari-svc', api_key_masked: 'n/a (internal)', webhook_secret_masked: 'whsec_••••••5f02',
    sandbox: false, uptime_pct: 99.98, search_p95_ms: 220, prebook_success_pct: 0.997, book_success_pct: 0.994,
    properties_live: 1_184, open_breaks: 1, currencies: ['NGN'], updated_at: iso(0.2),
  },
];
export async function listSuppliers(): Promise<Supplier[]> {
  if (USE_MOCK) { await delay(); return SUPPLIERS.map((s) => ({ ...s, currencies: [...s.currencies] })); }
  return getJson<Supplier[]>('/suppliers');
}

const MAPPING: MappingRecord[] = [
  {
    id: 'map_3310', city: 'Lagos', confidence: 0.91, status: 'pending', conflict_reason: 'Same geo + name token match across 2 bedbank suppliers; star rating differs (4 vs 5).', created_at: iso(3),
    candidates: [
      { supplier_code: 'ratehawk', rail: 'BEDBANK', supplier_property_ref: 'rh_5512', name: 'Radisson Blu Anchorage Hotel Ikeja', address: '1A Ozumba Mbadiwe Ave, VI', star_rating: 5, lowest_total_kobo: 312_000_00, currency: 'NGN' },
      { supplier_code: 'zentrumhub', rail: 'BEDBANK', supplier_property_ref: 'zh_8841', name: 'Radisson Blu Ikeja', address: '1 Ozumba Mbadiwe, Victoria Island', star_rating: 4, lowest_total_kobo: 298_000_00, currency: 'NGN' },
    ],
  },
  {
    id: 'map_3318', city: 'Abuja', confidence: 0.74, status: 'pending', conflict_reason: 'Direct hotel may duplicate a bedbank listing — address fuzzy match 0.74.', created_at: iso(8),
    candidates: [
      { supplier_code: 'direct', rail: 'DIRECT', supplier_property_ref: 'dir_220', name: 'Transcorp Hilton Abuja', address: '1 Aguiyi Ironsi St, Maitama', star_rating: 5, lowest_total_kobo: 410_000_00, currency: 'NGN' },
      { supplier_code: 'ratehawk', rail: 'BEDBANK', supplier_property_ref: 'rh_9920', name: 'Transcorp Hilton', address: 'Aguiyi Ironsi Street, Maitama', star_rating: 5, lowest_total_kobo: 438_000_00, currency: 'NGN' },
    ],
  },
  {
    id: 'map_3290', city: 'Port Harcourt', confidence: 0.96, status: 'merged', conflict_reason: 'High-confidence auto-merge candidate, confirmed by ops.', created_at: iso(30),
    candidates: [
      { supplier_code: 'ratehawk', rail: 'BEDBANK', supplier_property_ref: 'rh_3001', name: 'Hotel Presidential PH', address: 'Aba Road, Port Harcourt', star_rating: 4, lowest_total_kobo: 188_000_00, currency: 'NGN' },
      { supplier_code: 'zentrumhub', rail: 'BEDBANK', supplier_property_ref: 'zh_4410', name: 'Hotel Presidential Port Harcourt', address: 'Aba Rd, PH', star_rating: 4, lowest_total_kobo: 191_000_00, currency: 'NGN' },
    ],
  },
];
export async function getMappingQueue(opts?: { status?: string }): Promise<MappingRecord[]> {
  if (USE_MOCK) {
    await delay();
    let r = MAPPING.map((m) => ({ ...m, candidates: m.candidates.map((c) => ({ ...c })) }));
    if (opts?.status) r = r.filter((m) => m.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<MappingRecord[]>(`/mapping${qs}`);
}
export async function resolveMapping(id: string, payload: { status: MappingStatus; note?: string }): Promise<MappingResolution> {
  if (USE_MOCK) { await delay(); return { id, status: payload.status, resolved_at: new Date().toISOString() }; }
  return sendJson<MappingResolution>('POST', `/mapping/${encodeURIComponent(id)}/resolve`, payload);
}

const MODERATION: ModerationItem[] = [
  { id: 'mod_701', property_name: 'The Wheatbaker Ikoyi', hotelier_masked: 'Bola A••••', city: 'Lagos', star_rating: 5, rooms: 78, status: 'pending_review', photos_count: 24, flags: [], submitted_at: iso(12) },
  { id: 'mod_702', property_name: 'Nordic Hotel Lekki', hotelier_masked: 'Femi O••••', city: 'Lagos', star_rating: 4, rooms: 42, status: 'pending_review', photos_count: 9, flags: ['few_photos', 'no_cancellation_policy'], submitted_at: iso(20) },
  { id: 'mod_703', property_name: 'BON Hotel Abuja', hotelier_masked: 'Aisha M••••', city: 'Abuja', star_rating: 4, rooms: 120, status: 'needs_changes', photos_count: 31, flags: ['amenities_incomplete'], submitted_at: iso(48) },
  { id: 'mod_704', property_name: 'Swiss Spirit Danag', hotelier_masked: 'Tunde K••••', city: 'Enugu', star_rating: 3, rooms: 36, status: 'approved', photos_count: 18, flags: [], submitted_at: iso(96) },
  { id: 'mod_705', property_name: 'Unverified Lodge VI', hotelier_masked: 'Chika E••••', city: 'Lagos', star_rating: 2, rooms: 14, status: 'rejected', photos_count: 3, flags: ['kyc_failed', 'stock_photos'], submitted_at: iso(120) },
];
export async function listModeration(opts?: { status?: string }): Promise<ModerationItem[]> {
  if (USE_MOCK) {
    await delay();
    let r = MODERATION.map((m) => ({ ...m, flags: [...m.flags] }));
    if (opts?.status) r = r.filter((m) => m.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<ModerationItem[]>(`/moderation${qs}`);
}
export async function approveProperty(id: string, payload: { status: ModerationStatus; note?: string }): Promise<ModerationDecision> {
  if (USE_MOCK) { await delay(); return { id, status: payload.status, decided_at: new Date().toISOString() }; }
  return sendJson<ModerationDecision>('POST', `/moderation/${encodeURIComponent(id)}/decide`, payload);
}

const CONTENT_QA: ContentQaItem[] = [
  { id: 'cq_1', property_name: 'Nordic Hotel Lekki', rail: 'DIRECT', supplier_code: 'direct', issue_type: 'low_res_photo', severity: 'medium', status: 'pending', detail: '6 of 9 photos below 1280px width.', flagged_at: iso(20) },
  { id: 'cq_2', property_name: 'Radisson Blu Anchorage', rail: 'BEDBANK', supplier_code: 'ratehawk', issue_type: 'duplicate_image', severity: 'low', status: 'pending', detail: 'Hero image duplicated across 3 room types.', flagged_at: iso(28) },
  { id: 'cq_3', property_name: 'BON Hotel Abuja', rail: 'DIRECT', supplier_code: 'direct', issue_type: 'description_thin', severity: 'high', status: 'failed', detail: 'Description under 120 chars; no amenities listed.', flagged_at: iso(40) },
  { id: 'cq_4', property_name: 'Eko Hotels & Suites', rail: 'DIRECT', supplier_code: 'direct', issue_type: 'watermark', severity: 'medium', status: 'pending', detail: 'Third-party watermark detected on 2 images.', flagged_at: iso(50) },
  { id: 'cq_5', property_name: 'Hotel Presidential PH', rail: 'BEDBANK', supplier_code: 'zentrumhub', issue_type: 'missing_amenities', severity: 'low', status: 'passed', detail: 'Amenities backfilled from supplier feed.', flagged_at: iso(72) },
];
export async function listContentQa(opts?: { status?: string; severity?: string }): Promise<ContentQaItem[]> {
  if (USE_MOCK) {
    await delay();
    let r = CONTENT_QA.map((c) => ({ ...c }));
    if (opts?.status) r = r.filter((c) => c.status === opts.status);
    if (opts?.severity) r = r.filter((c) => c.severity === opts.severity);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.severity) qs.set('severity', opts.severity);
  const s = qs.toString();
  return getJson<ContentQaItem[]>(`/content-qa${s ? `?${s}` : ''}`);
}

const COVERAGE: CoverageRow[] = [
  { city: 'Lagos', state: 'Lagos', bedbank_properties: 1_240, direct_properties: 412, total_properties: 1_652, demand_index: 98, gap_score: 12, bookings_30d: 4_120 },
  { city: 'Abuja', state: 'FCT', bedbank_properties: 880, direct_properties: 318, total_properties: 1_198, demand_index: 91, gap_score: 18, bookings_30d: 2_980 },
  { city: 'Port Harcourt', state: 'Rivers', bedbank_properties: 410, direct_properties: 96, total_properties: 506, demand_index: 72, gap_score: 41, bookings_30d: 980 },
  { city: 'Ibadan', state: 'Oyo', bedbank_properties: 220, direct_properties: 64, total_properties: 284, demand_index: 58, gap_score: 52, bookings_30d: 410 },
  { city: 'Enugu', state: 'Enugu', bedbank_properties: 140, direct_properties: 48, total_properties: 188, demand_index: 54, gap_score: 61, bookings_30d: 280 },
  { city: 'Kano', state: 'Kano', bedbank_properties: 96, direct_properties: 22, total_properties: 118, demand_index: 49, gap_score: 78, bookings_30d: 120 },
  { city: 'Calabar', state: 'Cross River', bedbank_properties: 88, direct_properties: 34, total_properties: 122, demand_index: 63, gap_score: 44, bookings_30d: 240 },
  { city: 'Uyo', state: 'Akwa Ibom', bedbank_properties: 52, direct_properties: 18, total_properties: 70, demand_index: 41, gap_score: 82, bookings_30d: 90 },
];
export async function getCoverage(): Promise<CoverageRow[]> {
  if (USE_MOCK) { await delay(); return COVERAGE.map((c) => ({ ...c })); }
  return getJson<CoverageRow[]>('/coverage');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Reservations / support
// ════════════════════════════════════════════════════════════════════════════
const RESERVATIONS: ReservationDetail[] = [
  {
    id: 'rsv_88210', supplier_ref: 'DIR-CONF-77120', rail: 'DIRECT', supplier_code: 'direct', property_name: 'Eko Hotels & Suites',
    city: 'Lagos', guest_masked: 'Ada O••••', state: 'CONFIRMED', check_in: dateAhead(6), check_out: dateAhead(9), rooms: 1,
    gross_amount_kobo: 485_000_00, currency: 'NGN', created_at: iso(0.8),
    room_type: 'Deluxe King', rate_plan: 'Flexible — free cancel 48h', board: 'Breakfast included', occupancy: '2 adults',
    refundable: true, cancellation_policy: 'Free cancellation until 48h before check-in, then 1 night charged.',
    net_rate_kobo: 430_000_00, markup_kobo: 55_000_00, tax_amount_kobo: 36_375_00, fx_rate: null, fx_supplier_currency: null,
    payment_method: 'wallet', idempotency_key: 'idem-rsv-88210', book_token_ref: 'tok_aa12', guest_email_masked: 'a••@gmail.com',
    guest_phone_masked: '+234 80•• ••12', consent_version: 'NDPA-v2',
    timeline: [
      { at: iso(1.0), state: 'OFFER_SELECTED', actor: 'guest' },
      { at: iso(0.95), state: 'PREBOOK_OK', actor: 'ari-svc', note: 'Live price + availability re-checked' },
      { at: iso(0.9), state: 'PAYMENT_HELD', actor: 'settlement', note: 'Wallet hold ₦485,000.00 (escrow)' },
      { at: iso(0.85), state: 'BOOKING', actor: 'stays-svc' },
      { at: iso(0.8), state: 'CONFIRMED', actor: 'direct', note: 'supplier_ref DIR-CONF-77120; hold charged; allotment decremented' },
    ],
    ledger: [
      { id: 'l1', kind: 'HOLD', amount_kobo: 485_000_00, ledger_ref: 'led_h_991', status: 'reversed', created_at: iso(0.9) },
      { id: 'l2', kind: 'CHARGE', amount_kobo: 485_000_00, ledger_ref: 'led_c_991', status: 'settled', created_at: iso(0.8) },
      { id: 'l3', kind: 'COMMISSION', amount_kobo: 55_000_00, ledger_ref: 'rev_c_991', status: 'settled', created_at: iso(0.8) },
    ],
  },
  {
    id: 'rsv_88120', supplier_ref: '', rail: 'BEDBANK', supplier_code: 'ratehawk', property_name: 'Radisson Blu Anchorage Ikeja',
    city: 'Lagos', guest_masked: 'Tunde A••••', state: 'PAYMENT_HELD', check_in: dateAhead(2), check_out: dateAhead(4), rooms: 1,
    gross_amount_kobo: 312_000_00, currency: 'NGN', created_at: iso(0.3),
    room_type: 'Superior Twin', rate_plan: 'Non-refundable', board: 'Room only', occupancy: '2 adults',
    refundable: false, cancellation_policy: 'Non-refundable rate.',
    net_rate_kobo: 280_000_00, markup_kobo: 32_000_00, tax_amount_kobo: 23_400_00, fx_rate: 1_640.50, fx_supplier_currency: 'USD',
    payment_method: 'wallet', idempotency_key: 'idem-rsv-88120', book_token_ref: 'tok_bb55', guest_email_masked: 't••@yahoo.com',
    guest_phone_masked: '+234 70•• ••88', consent_version: 'NDPA-v2',
    timeline: [
      { at: iso(0.45), state: 'OFFER_SELECTED', actor: 'guest' },
      { at: iso(0.4), state: 'PREBOOK_OK', actor: 'ratehawk', note: 'Net rate $170.68 @ 1640.50 → ₦280,000.00' },
      { at: iso(0.3), state: 'PAYMENT_HELD', actor: 'settlement', note: 'Hold placed; supplier book call pending — PAID-BUT-UNCONFIRMED watch' },
    ],
    ledger: [
      { id: 'l1', kind: 'HOLD', amount_kobo: 312_000_00, ledger_ref: 'led_h_770', status: 'pending', created_at: iso(0.3) },
    ],
  },
  {
    id: 'rsv_88190', supplier_ref: '', rail: 'BEDBANK', supplier_code: 'zentrumhub', property_name: 'Transcorp Hilton Abuja',
    city: 'Abuja', guest_masked: 'Zara M••••', state: 'BOOK_FAILED', check_in: dateAhead(10), check_out: dateAhead(12), rooms: 2,
    gross_amount_kobo: 876_000_00, currency: 'NGN', created_at: iso(2),
    room_type: 'Executive Room', rate_plan: 'Flexible', board: 'Breakfast included', occupancy: '4 adults',
    refundable: true, cancellation_policy: 'Free cancellation until 72h before.',
    net_rate_kobo: 790_000_00, markup_kobo: 86_000_00, tax_amount_kobo: 65_700_00, fx_rate: 1_640.50, fx_supplier_currency: 'GBP',
    payment_method: 'wallet', idempotency_key: 'idem-rsv-88190', book_token_ref: 'tok_cc77', guest_email_masked: 'z••@outlook.com',
    guest_phone_masked: '+234 81•• ••34', consent_version: 'NDPA-v2',
    timeline: [
      { at: iso(2.2), state: 'PREBOOK_OK', actor: 'zentrumhub' },
      { at: iso(2.1), state: 'PAYMENT_HELD', actor: 'settlement', note: 'Hold ₦876,000.00' },
      { at: iso(2.05), state: 'BOOKING', actor: 'stays-svc' },
      { at: iso(2.0), state: 'BOOK_FAILED', actor: 'zentrumhub', note: 'Supplier returned SOLD_OUT after prebook' },
      { at: iso(1.99), state: 'VOID', actor: 'system', note: 'Hold auto-released, NO DEBIT (mandatory invariant)' },
    ],
    ledger: [
      { id: 'l1', kind: 'HOLD', amount_kobo: 876_000_00, ledger_ref: 'led_h_819', status: 'reversed', created_at: iso(2.1) },
      { id: 'l2', kind: 'RELEASE', amount_kobo: 876_000_00, ledger_ref: 'led_r_819', status: 'settled', created_at: iso(1.99) },
    ],
  },
  {
    id: 'rsv_88060', supplier_ref: 'RH-CONF-55012', rail: 'BEDBANK', supplier_code: 'ratehawk', property_name: 'The Wheatbaker Ikoyi',
    city: 'Lagos', guest_masked: 'Chidi N••••', state: 'COMPLETED', check_in: dateStr(8), check_out: dateStr(5), rooms: 1,
    gross_amount_kobo: 540_000_00, currency: 'NGN', created_at: iso(360),
    room_type: 'Garden Suite', rate_plan: 'Flexible', board: 'Half board', occupancy: '2 adults, 1 child',
    refundable: true, cancellation_policy: 'Free cancellation until 24h before.',
    net_rate_kobo: 488_000_00, markup_kobo: 52_000_00, tax_amount_kobo: 40_500_00, fx_rate: 1_635.00, fx_supplier_currency: 'USD',
    payment_method: 'card', idempotency_key: 'idem-rsv-88060', book_token_ref: 'tok_dd01', guest_email_masked: 'c••@gmail.com',
    guest_phone_masked: '+234 90•• ••77', consent_version: 'NDPA-v2',
    timeline: [
      { at: iso(361), state: 'CONFIRMED', actor: 'ratehawk' },
      { at: iso(120), state: 'COMPLETED', actor: 'system', note: 'Stay completed; review window open' },
    ],
    ledger: [
      { id: 'l1', kind: 'CHARGE', amount_kobo: 540_000_00, ledger_ref: 'led_c_606', status: 'settled', created_at: iso(360) },
      { id: 'l2', kind: 'COMMISSION', amount_kobo: 52_000_00, ledger_ref: 'rev_c_606', status: 'settled', created_at: iso(360) },
    ],
  },
  {
    id: 'rsv_88001', supplier_ref: 'DIR-CONF-44001', rail: 'DIRECT', supplier_code: 'direct', property_name: 'Transcorp Hilton Abuja',
    city: 'Abuja', guest_masked: 'Fave K••••', state: 'CANCELLED_BY_GUEST', check_in: dateStr(2), check_out: dateAhead(1), rooms: 1,
    gross_amount_kobo: 410_000_00, currency: 'NGN', created_at: iso(200),
    room_type: 'King Deluxe', rate_plan: 'Flexible', board: 'Breakfast included', occupancy: '2 adults',
    refundable: true, cancellation_policy: 'Free cancellation until 48h before, then 50% charged.',
    net_rate_kobo: 365_000_00, markup_kobo: 45_000_00, tax_amount_kobo: 30_750_00, fx_rate: null, fx_supplier_currency: null,
    payment_method: 'wallet', idempotency_key: 'idem-rsv-88001', book_token_ref: 'tok_ee44', guest_email_masked: 'f••@gmail.com',
    guest_phone_masked: '+234 80•• ••99', consent_version: 'NDPA-v2',
    timeline: [
      { at: iso(200), state: 'CONFIRMED', actor: 'direct' },
      { at: iso(60), state: 'CANCELLED_BY_GUEST', actor: 'guest', note: 'Cancelled within free window — full refund' },
    ],
    ledger: [
      { id: 'l1', kind: 'CHARGE', amount_kobo: 410_000_00, ledger_ref: 'led_c_440', status: 'reversed', created_at: iso(200) },
      { id: 'l2', kind: 'REFUND', amount_kobo: 410_000_00, ledger_ref: 'led_rf_440', status: 'settled', created_at: iso(60) },
    ],
  },
];
function stripReservation(r: ReservationDetail): ReservationSummary {
  const { room_type, rate_plan, board, occupancy, refundable, cancellation_policy, net_rate_kobo, markup_kobo, tax_amount_kobo, fx_rate, fx_supplier_currency, payment_method, idempotency_key, book_token_ref, guest_email_masked, guest_phone_masked, consent_version, timeline, ledger, ...rest } = r;
  void room_type; void rate_plan; void board; void occupancy; void refundable; void cancellation_policy; void net_rate_kobo; void markup_kobo; void tax_amount_kobo; void fx_rate; void fx_supplier_currency; void payment_method; void idempotency_key; void book_token_ref; void guest_email_masked; void guest_phone_masked; void consent_version; void timeline; void ledger;
  return rest;
}
export async function listReservations(opts?: { state?: string; rail?: string; supplier_code?: string; q?: string }): Promise<ReservationSummary[]> {
  if (USE_MOCK) {
    await delay();
    let r = RESERVATIONS.map(stripReservation);
    if (opts?.state) r = r.filter((x) => x.state === opts.state);
    if (opts?.rail) r = r.filter((x) => x.rail === opts.rail);
    if (opts?.supplier_code) r = r.filter((x) => x.supplier_code === opts.supplier_code);
    if (opts?.q) { const s = opts.q.toLowerCase(); r = r.filter((x) => x.id.includes(s) || x.supplier_ref.toLowerCase().includes(s) || x.property_name.toLowerCase().includes(s) || x.guest_masked.toLowerCase().includes(s)); }
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.rail) qs.set('rail', opts.rail);
  if (opts?.supplier_code) qs.set('supplier_code', opts.supplier_code);
  if (opts?.q) qs.set('q', opts.q);
  const s = qs.toString();
  return getJson<ReservationSummary[]>(`/reservations${s ? `?${s}` : ''}`);
}
export async function getReservation(id: string): Promise<ReservationDetail> {
  if (USE_MOCK) { await delay(); const r = RESERVATIONS.find((x) => x.id === id) ?? RESERVATIONS[0]; return { ...r, timeline: r.timeline.map((t) => ({ ...t })), ledger: r.ledger.map((l) => ({ ...l })) }; }
  return getJson<ReservationDetail>(`/reservations/${encodeURIComponent(id)}`);
}
export async function manualAction(id: string, payload: { action: ManualActionType; reason: string }): Promise<ManualActionResult> {
  if (USE_MOCK) {
    await delay();
    const newState: Record<ManualActionType, ReservationDetail['state']> = { confirm: 'CONFIRMED', force_cancel: 'CANCELLED_BY_HOTEL', rebook: 'CONFIRMED', release_hold: 'VOID' };
    return { reservation_id: id, action: payload.action, new_state: newState[payload.action], ledger_ref: payload.action === 'release_hold' ? 'led_release_new' : 'led_new', performed_at: new Date().toISOString() };
  }
  return sendJson<ManualActionResult>('POST', `/reservations/${encodeURIComponent(id)}/manual-action`, payload);
}

const REFUNDS: RefundRequest[] = [
  { id: 'ref_4401', reference: 'RFD-4401', reservation_id: 'rsv_88120', rail: 'BEDBANK', supplier_code: 'ratehawk', reason: 'paid_unconfirmed', fast_path: true, amount_kobo: 96_000_00, currency: 'NGN', status: 'pending', guest_masked: 'Tunde A••••', requested_at: iso(0.4) },
  { id: 'ref_4402', reference: 'RFD-4402', reservation_id: 'rsv_88190', rail: 'BEDBANK', supplier_code: 'zentrumhub', reason: 'book_failed', fast_path: true, amount_kobo: 876_000_00, currency: 'NGN', status: 'paid', guest_masked: 'Zara M••••', requested_at: iso(2) },
  { id: 'ref_4403', reference: 'RFD-4403', reservation_id: 'rsv_88001', rail: 'DIRECT', supplier_code: 'direct', reason: 'guest_cancel', fast_path: false, amount_kobo: 410_000_00, currency: 'NGN', status: 'paid', guest_masked: 'Fave K••••', requested_at: iso(60) },
  { id: 'ref_4404', reference: 'RFD-4404', reservation_id: 'rsv_87990', rail: 'DIRECT', supplier_code: 'direct', reason: 'hotel_cancel', fast_path: false, amount_kobo: 230_000_00, currency: 'NGN', status: 'pending', guest_masked: 'Ngozi P••••', requested_at: iso(18) },
  { id: 'ref_4405', reference: 'RFD-4405', reservation_id: 'rsv_87880', rail: 'BEDBANK', supplier_code: 'ratehawk', reason: 'dispute', fast_path: false, amount_kobo: 150_000_00, currency: 'NGN', status: 'rejected', guest_masked: 'Emeka U••••', requested_at: iso(96) },
];
export async function listRefunds(opts?: { status?: string; fast_path?: boolean }): Promise<RefundRequest[]> {
  if (USE_MOCK) {
    await delay();
    let r = REFUNDS.map((x) => ({ ...x }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    if (opts?.fast_path !== undefined) r = r.filter((x) => x.fast_path === opts.fast_path);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.fast_path !== undefined) qs.set('fast_path', String(opts.fast_path));
  const s = qs.toString();
  return getJson<RefundRequest[]>(`/refunds${s ? `?${s}` : ''}`);
}
export async function decideRefund(id: string, payload: { decision: RefundStatus; note?: string }): Promise<RefundDecision> {
  if (USE_MOCK) { await delay(); return { id, status: payload.decision, decided_at: new Date().toISOString() }; }
  return sendJson<RefundDecision>('POST', `/refunds/${encodeURIComponent(id)}/decide`, payload);
}

const OVERBOOKING: OverbookingCase[] = [
  { id: 'ob_3301', reservation_id: 'rsv_87990', property_name: 'BON Hotel Abuja', rail: 'DIRECT', case_type: 'overbooking', status: 'open', guest_masked: 'Ngozi P••••', check_in: dateAhead(1), amount_kobo: 230_000_00, currency: 'NGN', detail: 'Hotel reports no room despite confirmed direct booking — rebook or refund + goodwill.', created_at: iso(18) },
  { id: 'ob_3302', reservation_id: 'rsv_87800', property_name: 'Radisson Blu Anchorage', rail: 'BEDBANK', case_type: 'overbooking', status: 'rebooked', guest_masked: 'Sade B••••', check_in: dateStr(1), amount_kobo: 312_000_00, currency: 'NGN', detail: 'Rebooked to comparable 5-star; price difference absorbed.', created_at: iso(50) },
  { id: 'ob_3303', reservation_id: 'rsv_87700', property_name: 'Eko Hotels & Suites', rail: 'DIRECT', case_type: 'no_show', status: 'resolved', guest_masked: 'Ibrahim S••••', check_in: dateStr(4), amount_kobo: 161_666_00, currency: 'NGN', detail: 'No-show — 1 night charged per policy; remainder released.', created_at: iso(96) },
  { id: 'ob_3304', reservation_id: 'rsv_87650', property_name: 'Transcorp Hilton Abuja', rail: 'BEDBANK', case_type: 'no_show', status: 'open', guest_masked: 'Halima Y••••', check_in: dateStr(1), amount_kobo: 218_000_00, currency: 'NGN', detail: 'Supplier flagged no-show; awaiting policy charge confirmation.', created_at: iso(20) },
];
export async function listOverbooking(opts?: { status?: string; case_type?: string }): Promise<OverbookingCase[]> {
  if (USE_MOCK) {
    await delay();
    let r = OVERBOOKING.map((x) => ({ ...x }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    if (opts?.case_type) r = r.filter((x) => x.case_type === opts.case_type);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.case_type) qs.set('case_type', opts.case_type);
  const s = qs.toString();
  return getJson<OverbookingCase[]>(`/overbooking${s ? `?${s}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// C · Money / pricing
// ════════════════════════════════════════════════════════════════════════════
const RECONCILIATION: ReconciliationSummary = {
  open_breaks: 9,
  break_value_kobo: 7_240_500_00,
  sla_breached: 3,
  matched_30d: 9_410,
  unmatched_statement_lines: 14,
  breaks: [
    { id: 'rec_5521', supplier_code: 'zentrumhub', rail: 'BEDBANK', break_type: 'net_rate', reservation_id: 'rsv_88190', paymax_amount_kobo: 790_000_00, supplier_amount_kobo: 802_000_00, delta_kobo: -12_000_00, currency: 'NGN', status: 'open', age_hours: 80, sla_breached: true, detail: 'Supplier invoiced net rate ₦12,000 higher than booked (FX drift on GBP leg).', created_at: iso(80) },
    { id: 'rec_5522', supplier_code: 'ratehawk', rail: 'BEDBANK', break_type: 'commission', reservation_id: 'rsv_88060', paymax_amount_kobo: 52_000_00, supplier_amount_kobo: 49_400_00, delta_kobo: 2_600_00, currency: 'NGN', status: 'investigating', age_hours: 36, sla_breached: false, detail: 'Commission basis mismatch — markup vs net-rate margin attribution.', created_at: iso(36) },
    { id: 'rec_5523', supplier_code: 'zentrumhub', rail: 'BEDBANK', break_type: 'missing_statement', reservation_id: null, paymax_amount_kobo: 0, supplier_amount_kobo: 298_000_00, delta_kobo: -298_000_00, currency: 'NGN', status: 'open', age_hours: 12, sla_breached: false, detail: 'Supplier statement line with no matching Paymax reservation.', created_at: iso(12) },
    { id: 'rec_5524', supplier_code: 'direct', rail: 'DIRECT', break_type: 'payout', reservation_id: 'rsv_88210', paymax_amount_kobo: 430_000_00, supplier_amount_kobo: 430_000_00, delta_kobo: 0, currency: 'NGN', status: 'resolved', age_hours: 200, sla_breached: false, detail: 'Resolved — timing difference cleared on next settlement run.', created_at: iso(200) },
    { id: 'rec_5525', supplier_code: 'ratehawk', rail: 'BEDBANK', break_type: 'refund', reservation_id: 'rsv_87880', paymax_amount_kobo: 150_000_00, supplier_amount_kobo: 142_500_00, delta_kobo: 7_500_00, currency: 'NGN', status: 'open', age_hours: 54, sla_breached: true, detail: 'Supplier refund short by cancellation penalty not passed through.', created_at: iso(54) },
  ],
};
export async function getReconciliation(opts?: { status?: string; break_type?: string; supplier_code?: string }): Promise<ReconciliationSummary> {
  if (USE_MOCK) {
    await delay();
    let breaks = RECONCILIATION.breaks.map((b) => ({ ...b }));
    if (opts?.status) breaks = breaks.filter((b) => b.status === opts.status);
    if (opts?.break_type) breaks = breaks.filter((b) => b.break_type === opts.break_type);
    if (opts?.supplier_code) breaks = breaks.filter((b) => b.supplier_code === opts.supplier_code);
    return { ...RECONCILIATION, breaks };
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.break_type) qs.set('break_type', opts.break_type);
  if (opts?.supplier_code) qs.set('supplier_code', opts.supplier_code);
  const s = qs.toString();
  return getJson<ReconciliationSummary>(`/reconciliation${s ? `?${s}` : ''}`);
}
export async function resolveBreak(id: string, payload: { resolution: string; status: BreakStatus; note?: string }): Promise<BreakResolution> {
  if (USE_MOCK) { await delay(); return { id, status: payload.status, resolved_at: new Date().toISOString() }; }
  return sendJson<BreakResolution>('POST', `/reconciliation/${encodeURIComponent(id)}/resolve`, payload);
}

const PAYOUTS: HotelPayout[] = [
  { id: 'pay_7720', reference: 'PAY-7720', hotelier_masked: 'Transcorp H••••', property_name: 'Transcorp Hilton Abuja', bookings_count: 18, gross_kobo: 2_380_000_00, commission_kobo: 240_000_00, net_payable_kobo: 2_140_000_00, status: 'paid', bank_masked: 'GTBank ••••4412', scheduled_for: dateStr(2), paid_at: iso(6) },
  { id: 'pay_7721', reference: 'PAY-7721', hotelier_masked: 'Eko H••••', property_name: 'Eko Hotels & Suites', bookings_count: 42, gross_kobo: 6_120_000_00, commission_kobo: 642_000_00, net_payable_kobo: 5_478_000_00, status: 'scheduled', bank_masked: 'Zenith ••••8810', scheduled_for: dateAhead(2), paid_at: null },
  { id: 'pay_7722', reference: 'PAY-7722', hotelier_masked: 'Wheatbaker••••', property_name: 'The Wheatbaker Ikoyi', bookings_count: 9, gross_kobo: 1_980_000_00, commission_kobo: 198_000_00, net_payable_kobo: 1_782_000_00, status: 'pending', bank_masked: 'Access ••••2201', scheduled_for: dateAhead(1), paid_at: null },
  { id: 'pay_7723', reference: 'PAY-7723', hotelier_masked: 'BON Hotel••••', property_name: 'BON Hotel Abuja', bookings_count: 6, gross_kobo: 880_000_00, commission_kobo: 88_000_00, net_payable_kobo: 792_000_00, status: 'held', bank_masked: 'UBA ••••7702', scheduled_for: dateAhead(3), paid_at: null },
  { id: 'pay_7719', reference: 'PAY-7719', hotelier_masked: 'Nordic H••••', property_name: 'Nordic Hotel Lekki', bookings_count: 3, gross_kobo: 410_000_00, commission_kobo: 41_000_00, net_payable_kobo: 369_000_00, status: 'failed', bank_masked: 'Kuda ••••0099', scheduled_for: dateStr(1), paid_at: null },
];
export async function listPayouts(opts?: { status?: string }): Promise<HotelPayout[]> {
  if (USE_MOCK) {
    await delay();
    let r = PAYOUTS.map((p) => ({ ...p }));
    if (opts?.status) r = r.filter((p) => p.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<HotelPayout[]>(`/payouts${qs}`);
}

const MARKUP_RULES: MarkupRule[] = [
  { id: 'mk_1', scope: 'global', match: 'all', markup_pct: 10, commission_pct: 0, rail: 'ALL', priority: 100, enabled: true, updated_at: iso(400) },
  { id: 'mk_2', scope: 'supplier', match: 'ratehawk', markup_pct: 12, commission_pct: 0, rail: 'BEDBANK', priority: 50, enabled: true, updated_at: iso(200) },
  { id: 'mk_3', scope: 'supplier', match: 'zentrumhub', markup_pct: 11, commission_pct: 0, rail: 'BEDBANK', priority: 50, enabled: true, updated_at: iso(180) },
  { id: 'mk_4', scope: 'destination', match: 'Lagos', markup_pct: 13, commission_pct: 0, rail: 'ALL', priority: 40, enabled: true, updated_at: iso(120) },
  { id: 'mk_5', scope: 'tier', match: 'tier_gold', markup_pct: 8, commission_pct: 0, rail: 'ALL', priority: 30, enabled: true, updated_at: iso(90) },
  { id: 'mk_6', scope: 'season', match: 'Dec 15 – Jan 5', markup_pct: 16, commission_pct: 0, rail: 'ALL', priority: 20, enabled: false, updated_at: iso(60) },
  { id: 'mk_7', scope: 'supplier', match: 'direct', markup_pct: 0, commission_pct: 10, rail: 'DIRECT', priority: 45, enabled: true, updated_at: iso(40) },
];
export async function getMarkupRules(): Promise<MarkupRule[]> {
  if (USE_MOCK) { await delay(); return MARKUP_RULES.map((r) => ({ ...r })); }
  return getJson<MarkupRule[]>('/markup-rules');
}
export async function updateMarkupRules(rules: MarkupRule[]): Promise<MarkupRule[]> {
  if (USE_MOCK) { await delay(); return rules.map((r) => ({ ...r, updated_at: new Date().toISOString() })); }
  return sendJson<MarkupRule[]>('PUT', '/markup-rules', { rules });
}

const FX: FxConfig = {
  base_currency: 'NGN', display_currency: 'NGN', auto_update: true, rate_ttl_minutes: 30,
  rates: [
    { pair: 'USD/NGN', base: 'USD', quote: 'NGN', mid_rate: 1_632.40, buy_spread_pct: 0.5, sell_spread_pct: 0.5, applied_rate: 1_640.50, source: 'fx-svc (CBN+market blend)', updated_at: iso(0.3) },
    { pair: 'EUR/NGN', base: 'EUR', quote: 'NGN', mid_rate: 1_768.10, buy_spread_pct: 0.6, sell_spread_pct: 0.6, applied_rate: 1_778.70, source: 'fx-svc', updated_at: iso(0.3) },
    { pair: 'GBP/NGN', base: 'GBP', quote: 'NGN', mid_rate: 2_064.20, buy_spread_pct: 0.6, sell_spread_pct: 0.6, applied_rate: 2_076.60, source: 'fx-svc', updated_at: iso(0.3) },
  ],
};
export async function getFX(): Promise<FxConfig> {
  if (USE_MOCK) { await delay(); return { ...FX, rates: FX.rates.map((r) => ({ ...r })) }; }
  return getJson<FxConfig>('/fx');
}

const COMMISSION: CommissionEntry[] = [
  { id: 'com_991', reservation_id: 'rsv_88210', rail: 'DIRECT', supplier_code: 'direct', source: 'direct_commission', amount_kobo: 55_000_00, basis: '10% direct-rail commission on net', revenue_ledger_ref: 'rev_c_991', reconciled: true, reversed: false, created_at: iso(0.8) },
  { id: 'com_606', reservation_id: 'rsv_88060', rail: 'BEDBANK', supplier_code: 'ratehawk', source: 'markup', amount_kobo: 52_000_00, basis: 'Markup over net rate', revenue_ledger_ref: 'rev_c_606', reconciled: true, reversed: false, created_at: iso(360) },
  { id: 'com_819', reservation_id: 'rsv_88190', rail: 'BEDBANK', supplier_code: 'zentrumhub', source: 'markup', amount_kobo: 86_000_00, basis: 'Markup over net rate', revenue_ledger_ref: 'rev_c_819', reconciled: false, reversed: true, created_at: iso(2) },
  { id: 'com_440', reservation_id: 'rsv_88001', rail: 'DIRECT', supplier_code: 'direct', source: 'direct_commission', amount_kobo: 45_000_00, basis: '10% direct-rail commission', revenue_ledger_ref: 'rev_c_440', reconciled: false, reversed: true, created_at: iso(200) },
  { id: 'com_770', reservation_id: 'rsv_88120', rail: 'BEDBANK', supplier_code: 'ratehawk', source: 'net_rate_margin', amount_kobo: 32_000_00, basis: 'Net-rate margin (pending confirm)', revenue_ledger_ref: 'rev_c_770', reconciled: false, reversed: false, created_at: iso(0.3) },
];
export async function listCommission(opts?: { rail?: string; reconciled?: boolean; source?: string }): Promise<CommissionEntry[]> {
  if (USE_MOCK) {
    await delay();
    let r = COMMISSION.map((c) => ({ ...c }));
    if (opts?.rail) r = r.filter((c) => c.rail === opts.rail);
    if (opts?.source) r = r.filter((c) => c.source === opts.source);
    if (opts?.reconciled !== undefined) r = r.filter((c) => c.reconciled === opts.reconciled);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.rail) qs.set('rail', opts.rail);
  if (opts?.source) qs.set('source', opts.source);
  if (opts?.reconciled !== undefined) qs.set('reconciled', String(opts.reconciled));
  const s = qs.toString();
  return getJson<CommissionEntry[]>(`/commission${s ? `?${s}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// D · Growth / content
// ════════════════════════════════════════════════════════════════════════════
const LOYALTY: LoyaltyConfig = {
  enabled: true, program_name: 'Paymax Stays Rewards', point_value_kobo: 100, expiry_months: 18,
  members: 28_410, points_outstanding: 4_182_000, liability_kobo: 418_200_000,
  tiers: [
    { tier: 'Explorer', threshold_nights: 0, earn_rate_pct: 2, perks: ['Member rates', 'Free cancellation on flexible'] },
    { tier: 'Silver', threshold_nights: 10, earn_rate_pct: 3, perks: ['Late checkout', 'Room upgrade (subject to availability)'] },
    { tier: 'Gold', threshold_nights: 25, earn_rate_pct: 4, perks: ['Guaranteed upgrade', 'Welcome amenity', 'Priority support'] },
    { tier: 'Platinum', threshold_nights: 50, earn_rate_pct: 5, perks: ['Suite upgrades', 'Free breakfast', 'Dedicated concierge'] },
  ],
};
export async function getLoyalty(): Promise<LoyaltyConfig> {
  if (USE_MOCK) { await delay(); return { ...LOYALTY, tiers: LOYALTY.tiers.map((t) => ({ ...t, perks: [...t.perks] })) }; }
  return getJson<LoyaltyConfig>('/loyalty');
}

const PROMOTIONS: Promotion[] = [
  { id: 'promo_1', code: 'LAGOS15', name: 'Lagos Weekender', type: 'percent_off', value: 15, scope: 'Lagos · weekends', status: 'active', redemptions: 1_204, budget_kobo: 50_000_000_00, spent_kobo: 18_400_000_00, starts_at: dateStr(20), ends_at: dateAhead(40) },
  { id: 'promo_2', code: 'STAY3PAY2', name: 'Stay 3 Pay 2', type: 'free_night', value: 1, scope: 'Direct hotels · 3+ nights', status: 'active', redemptions: 312, budget_kobo: 30_000_000_00, spent_kobo: 9_100_000_00, starts_at: dateStr(10), ends_at: dateAhead(20) },
  { id: 'promo_3', code: 'NEWGUEST', name: 'First booking cashback', type: 'cashback', value: 5, scope: 'New guests · all rails', status: 'active', redemptions: 2_980, budget_kobo: 40_000_000_00, spent_kobo: 31_200_000_00, starts_at: dateStr(60), ends_at: dateAhead(5) },
  { id: 'promo_4', code: 'DET10K', name: 'Detty December ₦10k off', type: 'amount_off', value: 10_000, scope: 'All cities · Dec', status: 'scheduled', redemptions: 0, budget_kobo: 80_000_000_00, spent_kobo: 0, starts_at: dateAhead(160), ends_at: dateAhead(195) },
  { id: 'promo_5', code: 'EASTER22', name: 'Easter flash', type: 'percent_off', value: 22, scope: 'All rails', status: 'expired', redemptions: 880, budget_kobo: 20_000_000_00, spent_kobo: 19_800_000_00, starts_at: dateStr(120), ends_at: dateStr(90) },
];
export async function listPromotions(opts?: { status?: string }): Promise<Promotion[]> {
  if (USE_MOCK) {
    await delay();
    let r = PROMOTIONS.map((p) => ({ ...p }));
    if (opts?.status) r = r.filter((p) => p.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<Promotion[]>(`/promotions${qs}`);
}

const REVIEWS: Review[] = [
  { id: 'rev_9001', property_name: 'Eko Hotels & Suites', reservation_id: 'rsv_88060', author_masked: 'Chidi N••••', rating: 5, title: 'Excellent stay', body: 'Great service and clean rooms. Will book again via Paymax.', status: 'pending', flags: [], has_response: false, created_at: iso(20) },
  { id: 'rev_9002', property_name: 'BON Hotel Abuja', reservation_id: 'rsv_87990', author_masked: 'Ngozi P••••', rating: 2, title: 'Overbooked on arrival', body: 'Booking was confirmed but no room. Had to be rebooked elsewhere.', status: 'flagged', flags: ['mentions_overbooking', 'low_rating'], has_response: false, created_at: iso(40) },
  { id: 'rev_9003', property_name: 'Radisson Blu Anchorage', reservation_id: 'rsv_87800', author_masked: 'Sade B••••', rating: 4, title: 'Good but pricey', body: 'Comfortable and central. Breakfast could be better.', status: 'published', flags: [], has_response: true, created_at: iso(72) },
  { id: 'rev_9004', property_name: 'Nordic Hotel Lekki', reservation_id: 'rsv_87700', author_masked: 'Ibrahim S••••', rating: 1, title: 'spam link here http://bit.ly/x', body: 'Visit my site for cheap deals!!!', status: 'flagged', flags: ['spam', 'external_link'], has_response: false, created_at: iso(96) },
  { id: 'rev_9005', property_name: 'The Wheatbaker Ikoyi', reservation_id: 'rsv_88060', author_masked: 'Ada O••••', rating: 5, title: 'Luxury done right', body: 'Beautiful suite and attentive staff.', status: 'published', flags: [], has_response: false, created_at: iso(120) },
];
export async function listReviews(opts?: { status?: string }): Promise<Review[]> {
  if (USE_MOCK) {
    await delay();
    let r = REVIEWS.map((x) => ({ ...x, flags: [...x.flags] }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<Review[]>(`/reviews${qs}`);
}
export async function moderateReview(id: string, payload: { status: ReviewStatus; note?: string }): Promise<ReviewModeration> {
  if (USE_MOCK) { await delay(); return { id, status: payload.status, decided_at: new Date().toISOString() }; }
  return sendJson<ReviewModeration>('POST', `/reviews/${encodeURIComponent(id)}/moderate`, payload);
}

const CMS: CmsEntry[] = [
  { id: 'cms_1', type: 'city', title: 'Hotels in Lagos', slug: 'lagos', status: 'published', meta_description: 'Book the best hotels in Lagos — Victoria Island, Ikoyi, Lekki & Ikeja.', properties_linked: 1_652, updated_at: iso(48) },
  { id: 'cms_2', type: 'city', title: 'Hotels in Abuja', slug: 'abuja', status: 'published', meta_description: 'Top-rated hotels in Abuja FCT — Maitama, Wuse & Asokoro.', properties_linked: 1_198, updated_at: iso(72) },
  { id: 'cms_3', type: 'landmark', title: 'Hotels near Murtala Muhammed Airport', slug: 'lagos-airport-hotels', status: 'published', meta_description: 'Convenient airport hotels near MMA Lagos.', properties_linked: 84, updated_at: iso(120) },
  { id: 'cms_4', type: 'guide', title: 'Detty December travel guide', slug: 'detty-december-guide', status: 'draft', meta_description: 'Where to stay for Detty December in Lagos.', properties_linked: 0, updated_at: iso(12) },
  { id: 'cms_5', type: 'seo_page', title: 'Cheap hotels in Port Harcourt', slug: 'cheap-hotels-port-harcourt', status: 'published', meta_description: 'Affordable hotels in Port Harcourt from ₦18,000/night.', properties_linked: 506, updated_at: iso(200) },
];
export async function listCms(opts?: { type?: string; status?: string }): Promise<CmsEntry[]> {
  if (USE_MOCK) {
    await delay();
    let r = CMS.map((x) => ({ ...x }));
    if (opts?.type) r = r.filter((x) => x.type === opts.type);
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.type) qs.set('type', opts.type);
  if (opts?.status) qs.set('status', opts.status);
  const s = qs.toString();
  return getJson<CmsEntry[]>(`/cms${s ? `?${s}` : ''}`);
}

const MERCHANDISING: MerchandisingSlot[] = [
  { id: 'mer_1', placement: 'home_hero', property_name: 'Eko Hotels & Suites', rail: 'DIRECT', position: 1, status: 'active', starts_at: dateStr(5), ends_at: dateAhead(25), impressions: 412_000, clicks: 8_240 },
  { id: 'mer_2', placement: 'city_top', property_name: 'The Wheatbaker Ikoyi', rail: 'BEDBANK', position: 1, status: 'active', starts_at: dateStr(10), ends_at: dateAhead(20), impressions: 188_000, clicks: 4_120 },
  { id: 'mer_3', placement: 'deal_strip', property_name: 'Radisson Blu Anchorage', rail: 'BEDBANK', position: 2, status: 'active', starts_at: dateStr(3), ends_at: dateAhead(12), impressions: 96_000, clicks: 2_010 },
  { id: 'mer_4', placement: 'app_banner', property_name: 'Transcorp Hilton Abuja', rail: 'DIRECT', position: 1, status: 'scheduled', starts_at: dateAhead(2), ends_at: dateAhead(30), impressions: 0, clicks: 0 },
  { id: 'mer_5', placement: 'home_hero', property_name: 'Nordic Hotel Lekki', rail: 'DIRECT', position: 2, status: 'ended', starts_at: dateStr(60), ends_at: dateStr(10), impressions: 240_000, clicks: 3_100 },
];
export async function listMerchandising(opts?: { placement?: string; status?: string }): Promise<MerchandisingSlot[]> {
  if (USE_MOCK) {
    await delay();
    let r = MERCHANDISING.map((x) => ({ ...x }));
    if (opts?.placement) r = r.filter((x) => x.placement === opts.placement);
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.placement) qs.set('placement', opts.placement);
  if (opts?.status) qs.set('status', opts.status);
  const s = qs.toString();
  return getJson<MerchandisingSlot[]>(`/merchandising${s ? `?${s}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Trust / risk / agents
// ════════════════════════════════════════════════════════════════════════════
const FRAUD: FraudCase[] = [
  { id: 'frd_1', reservation_id: 'rsv_88120', rail: 'BEDBANK', guest_masked: 'Tunde A••••', risk_score: 82, signals: ['velocity_5_bookings_1h', 'new_device', 'mismatched_billing_geo'], amount_kobo: 312_000_00, currency: 'NGN', status: 'open', detail: 'High booking velocity + new device on non-refundable rate.', created_at: iso(0.4) },
  { id: 'frd_2', reservation_id: 'rsv_87880', rail: 'BEDBANK', guest_masked: 'Emeka U••••', risk_score: 67, signals: ['chargeback_history', 'high_value'], amount_kobo: 540_000_00, currency: 'NGN', status: 'reviewing', detail: 'Prior chargeback on file; high-value booking.', created_at: iso(48) },
  { id: 'frd_3', reservation_id: 'rsv_87700', rail: 'DIRECT', guest_masked: 'Ibrahim S••••', risk_score: 34, signals: ['first_booking'], amount_kobo: 161_666_00, currency: 'NGN', status: 'cleared', detail: 'First booking, otherwise clean — cleared.', created_at: iso(96) },
  { id: 'frd_4', reservation_id: 'rsv_87650', rail: 'BEDBANK', guest_masked: 'Halima Y••••', risk_score: 94, signals: ['stolen_card_bin', 'tor_exit_node', 'rapid_refund_pattern'], amount_kobo: 876_000_00, currency: 'NGN', status: 'blocked', detail: 'Stolen-card BIN + Tor — booking blocked, hold released.', created_at: iso(20) },
];
export async function listFraud(opts?: { status?: string }): Promise<FraudCase[]> {
  if (USE_MOCK) {
    await delay();
    let r = FRAUD.map((x) => ({ ...x, signals: [...x.signals] }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<FraudCase[]>(`/fraud${qs}`);
}

const RELIABILITY: ReliabilityScore[] = [
  { hotelier_id: 'h_1', hotelier_masked: 'Eko H••••', property_name: 'Eko Hotels & Suites', score: 96, grade: 'A', confirm_rate: 0.99, cancel_rate: 0.01, overbook_incidents: 0, avg_response_minutes: 8, reviews_avg: 4.7, bookings_90d: 412 },
  { hotelier_id: 'h_2', hotelier_masked: 'Transcorp H••••', property_name: 'Transcorp Hilton Abuja', score: 91, grade: 'A', confirm_rate: 0.97, cancel_rate: 0.02, overbook_incidents: 1, avg_response_minutes: 14, reviews_avg: 4.6, bookings_90d: 318 },
  { hotelier_id: 'h_3', hotelier_masked: 'BON Hotel••••', property_name: 'BON Hotel Abuja', score: 62, grade: 'C', confirm_rate: 0.84, cancel_rate: 0.11, overbook_incidents: 3, avg_response_minutes: 92, reviews_avg: 3.4, bookings_90d: 96 },
  { hotelier_id: 'h_4', hotelier_masked: 'Nordic H••••', property_name: 'Nordic Hotel Lekki', score: 41, grade: 'D', confirm_rate: 0.72, cancel_rate: 0.19, overbook_incidents: 5, avg_response_minutes: 180, reviews_avg: 2.9, bookings_90d: 48 },
  { hotelier_id: 'h_5', hotelier_masked: 'Wheatbaker••••', property_name: 'The Wheatbaker Ikoyi', score: 88, grade: 'B', confirm_rate: 0.95, cancel_rate: 0.03, overbook_incidents: 0, avg_response_minutes: 22, reviews_avg: 4.5, bookings_90d: 78 },
];
export async function listReliability(opts?: { grade?: string }): Promise<ReliabilityScore[]> {
  if (USE_MOCK) {
    await delay();
    let r = RELIABILITY.map((x) => ({ ...x }));
    if (opts?.grade) r = r.filter((x) => x.grade === opts.grade);
    return r;
  }
  const qs = opts?.grade ? `?grade=${encodeURIComponent(opts.grade)}` : '';
  return getJson<ReliabilityScore[]>(`/reliability${qs}`);
}

const AGENTS: Agent[] = [
  { id: 'ag_1', name_masked: 'Bisi A••••', agent_code: 'AGT-1001', status: 'active', bookings_30d: 88, gmv_30d_kobo: 12_400_000_00, commission_rate_pct: 4, commission_earned_kobo: 496_000_00, commission_unpaid_kobo: 124_000_00, tier: 'Gold' },
  { id: 'ag_2', name_masked: 'Yusuf M••••', agent_code: 'AGT-1002', status: 'active', bookings_30d: 42, gmv_30d_kobo: 6_100_000_00, commission_rate_pct: 3, commission_earned_kobo: 183_000_00, commission_unpaid_kobo: 61_000_00, tier: 'Silver' },
  { id: 'ag_3', name_masked: 'Grace O••••', agent_code: 'AGT-1003', status: 'pending', bookings_30d: 0, gmv_30d_kobo: 0, commission_rate_pct: 3, commission_earned_kobo: 0, commission_unpaid_kobo: 0, tier: 'Bronze' },
  { id: 'ag_4', name_masked: 'Tobi K••••', agent_code: 'AGT-1004', status: 'suspended', bookings_30d: 4, gmv_30d_kobo: 410_000_00, commission_rate_pct: 3, commission_earned_kobo: 12_300_00, commission_unpaid_kobo: 12_300_00, tier: 'Bronze' },
];
export async function listAgents(opts?: { status?: string }): Promise<Agent[]> {
  if (USE_MOCK) {
    await delay();
    let r = AGENTS.map((x) => ({ ...x }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<Agent[]>(`/agents${qs}`);
}

const KYC: KycCase[] = [
  { id: 'kyc_1', hotelier_masked: 'Femi O••••', business_name: 'Nordic Hospitality Ltd', city: 'Lagos', doc_types: ['CAC', 'Director ID', 'Bank statement'], cac_number_masked: 'RC ••••4421', bank_verified: false, status: 'pending', risk_flags: ['bank_name_mismatch'], submitted_at: iso(20) },
  { id: 'kyc_2', hotelier_masked: 'Aisha M••••', business_name: 'BON Hotels Nigeria', city: 'Abuja', doc_types: ['CAC', 'TIN', 'Director ID'], cac_number_masked: 'RC ••••8810', bank_verified: true, status: 'pending', risk_flags: [], submitted_at: iso(40) },
  { id: 'kyc_3', hotelier_masked: 'Bola A••••', business_name: 'Wheatbaker Ltd', city: 'Lagos', doc_types: ['CAC', 'TIN', 'Director ID', 'Proof of address'], cac_number_masked: 'RC ••••2201', bank_verified: true, status: 'approved', risk_flags: [], submitted_at: iso(120) },
  { id: 'kyc_4', hotelier_masked: 'Chika E••••', business_name: 'VI Lodge Ventures', city: 'Lagos', doc_types: ['CAC'], cac_number_masked: 'RC ••••0099', bank_verified: false, status: 'rejected', risk_flags: ['cac_unverified', 'pep_match'], submitted_at: iso(200) },
];
export async function listKyc(opts?: { status?: string }): Promise<KycCase[]> {
  if (USE_MOCK) {
    await delay();
    let r = KYC.map((x) => ({ ...x, doc_types: [...x.doc_types], risk_flags: [...x.risk_flags] }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<KycCase[]>(`/kyc${qs}`);
}
export async function decideKyc(id: string, payload: { status: KycStatus; note?: string }): Promise<KycDecision> {
  if (USE_MOCK) { await delay(); return { id, status: payload.status, decided_at: new Date().toISOString() }; }
  return sendJson<KycDecision>('POST', `/kyc/${encodeURIComponent(id)}/decide`, payload);
}

// ════════════════════════════════════════════════════════════════════════════
// F · Platform
// ════════════════════════════════════════════════════════════════════════════
const USERS_ROLES: AdminUserRole[] = [
  { id: 'u_1', user_masked: 'Ops Lead — Ada O••••', email_masked: 'a••@paymax.ng', roles: ['stays_ops_admin'], permissions: ['stays.admin.reservation', 'stays.admin.refund', 'stays.admin.recon'], last_active: iso(1), status: 'active' },
  { id: 'u_2', user_masked: 'Supply Mgr — Femi O••••', email_masked: 'f••@paymax.ng', roles: ['stays_supply_admin'], permissions: ['stays.admin.supplier', 'stays.admin.mapping', 'stays.admin.moderation'], last_active: iso(3), status: 'active' },
  { id: 'u_3', user_masked: 'Finance — Zara M••••', email_masked: 'z••@paymax.ng', roles: ['stays_finance_admin'], permissions: ['stays.admin.recon', 'stays.admin.payout', 'stays.admin.commission', 'stays.admin.fx'], last_active: iso(6), status: 'active' },
  { id: 'u_4', user_masked: 'Risk — Tunde K••••', email_masked: 't••@paymax.ng', roles: ['stays_risk_admin'], permissions: ['stays.admin.fraud', 'stays.admin.kyc'], last_active: iso(24), status: 'active' },
  { id: 'u_5', user_masked: 'Read-only — Audit Bot', email_masked: 'audit••@paymax.ng', roles: ['stays_auditor'], permissions: ['stays.admin.audit'], last_active: iso(48), status: 'disabled' },
];
export async function listUsers(opts?: { status?: string }): Promise<AdminUserRole[]> {
  if (USE_MOCK) {
    await delay();
    let r = USERS_ROLES.map((x) => ({ ...x, roles: [...x.roles], permissions: [...x.permissions] }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    return r;
  }
  const qs = opts?.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return getJson<AdminUserRole[]>(`/users${qs}`);
}

const AUDIT: AuditLog = {
  exports: [
    { id: 'exp_1', name: 'Full audit export (30d)', range: 'Last 30 days', format: 'csv', generated_at: iso(20) },
    { id: 'exp_2', name: 'Money-path audit (90d)', range: 'Last 90 days', format: 'xlsx', generated_at: iso(72) },
    { id: 'exp_3', name: 'Regulator pack', range: 'YTD', format: 'pdf', generated_at: null },
  ],
  entries: [
    { id: 'aud_1', actor_masked: 'Ada O••••', action: 'refund.decide', entity: 'refund', entity_id: 'ref_4402', rail: 'BEDBANK', ip_masked: '102.89.•.•', created_at: iso(2) },
    { id: 'aud_2', actor_masked: 'Femi O••••', action: 'mapping.resolve', entity: 'mapping', entity_id: 'map_3290', rail: 'BEDBANK', ip_masked: '105.112.•.•', created_at: iso(8) },
    { id: 'aud_3', actor_masked: 'Zara M••••', action: 'reconciliation.resolve', entity: 'recon_break', entity_id: 'rec_5524', rail: 'DIRECT', ip_masked: '197.210.•.•', created_at: iso(12) },
    { id: 'aud_4', actor_masked: 'Ada O••••', action: 'reservation.manual_action', entity: 'reservation', entity_id: 'rsv_87800', rail: 'BEDBANK', ip_masked: '102.89.•.•', created_at: iso(50) },
    { id: 'aud_5', actor_masked: 'Tunde K••••', action: 'kyc.decide', entity: 'kyc', entity_id: 'kyc_3', rail: null, ip_masked: '154.113.•.•', created_at: iso(120) },
    { id: 'aud_6', actor_masked: 'Zara M••••', action: 'payout.release', entity: 'payout', entity_id: 'pay_7720', rail: 'DIRECT', ip_masked: '197.210.•.•', created_at: iso(6) },
  ],
};
export async function getAudit(opts?: { action?: string }): Promise<AuditLog> {
  if (USE_MOCK) {
    await delay();
    let entries = AUDIT.entries.map((e) => ({ ...e }));
    if (opts?.action) entries = entries.filter((e) => e.action.includes(opts.action!));
    return { exports: AUDIT.exports.map((x) => ({ ...x })), entries };
  }
  const qs = opts?.action ? `?action=${encodeURIComponent(opts.action)}` : '';
  return getJson<AuditLog>(`/audit${qs}`);
}

const CONFIG: PlatformConfig = {
  flags: [
    { key: 'stays.rail.bedbank', label: 'Bedbank rail (Rail A)', description: 'Enable RateHawk / ZentrumHub supply.', enabled: true, scope: 'global', updated_at: iso(400) },
    { key: 'stays.rail.direct', label: 'Direct rail (Rail B)', description: 'Enable direct hotel inventory via ari-svc.', enabled: true, scope: 'global', updated_at: iso(400) },
    { key: 'stays.dedup.auto_merge', label: 'Auto-merge high-confidence dedup', description: 'Auto-merge mapping candidates above 0.95 confidence.', enabled: true, scope: 'global', updated_at: iso(200) },
    { key: 'stays.refund.fast_path', label: 'Paid-but-unconfirmed fast-path', description: 'Auto-queue fast-path refunds for paid-but-unconfirmed.', enabled: true, scope: 'global', updated_at: iso(100) },
    { key: 'stays.loyalty', label: 'Stays loyalty program', description: 'Paymax Stays Rewards earn/burn.', enabled: true, scope: 'global', updated_at: iso(90) },
    { key: 'stays.agents', label: 'Agent-assisted booking', description: 'Enable agent management & commissions.', enabled: false, scope: 'global', updated_at: iso(60) },
  ],
  settings: [
    { key: 'stays.offer.ttl_seconds', label: 'Offer / book-token TTL (s)', value: '900', type: 'number' },
    { key: 'stays.hold.auto_release_minutes', label: 'Hold auto-release after (min)', value: '30', type: 'number' },
    { key: 'stays.recon.sla_hours', label: 'Reconciliation break SLA (h)', value: '72', type: 'number' },
    { key: 'stays.payout.schedule', label: 'Hotel payout schedule', value: 'weekly', type: 'string' },
    { key: 'stays.fx.auto_update', label: 'Auto-update FX rates', value: 'true', type: 'bool' },
  ],
};
export async function getConfig(): Promise<PlatformConfig> {
  if (USE_MOCK) { await delay(); return { flags: CONFIG.flags.map((f) => ({ ...f })), settings: CONFIG.settings.map((s) => ({ ...s })) }; }
  return getJson<PlatformConfig>('/config');
}

const TEMPLATES: NotificationTemplate[] = [
  { id: 'tpl_1', key: 'booking_confirmed', name: 'Booking confirmed', channel: 'email', trigger: 'reservation.confirmed', enabled: true, locale: 'en-NG', updated_at: iso(48) },
  { id: 'tpl_2', key: 'booking_confirmed_sms', name: 'Booking confirmed (SMS)', channel: 'sms', trigger: 'reservation.confirmed', enabled: true, locale: 'en-NG', updated_at: iso(48) },
  { id: 'tpl_3', key: 'book_failed', name: 'Booking failed — refund issued', channel: 'push', trigger: 'reservation.book_failed', enabled: true, locale: 'en-NG', updated_at: iso(72) },
  { id: 'tpl_4', key: 'refund_issued', name: 'Refund issued', channel: 'email', trigger: 'refund.paid', enabled: true, locale: 'en-NG', updated_at: iso(72) },
  { id: 'tpl_5', key: 'payout_sent', name: 'Hotel payout sent', channel: 'whatsapp', trigger: 'payout.paid', enabled: true, locale: 'en-NG', updated_at: iso(120) },
  { id: 'tpl_6', key: 'checkin_reminder', name: 'Check-in reminder', channel: 'push', trigger: 'reservation.checkin_t24h', enabled: false, locale: 'en-NG', updated_at: iso(200) },
];
export async function listTemplates(opts?: { channel?: string }): Promise<NotificationTemplate[]> {
  if (USE_MOCK) {
    await delay();
    let r = TEMPLATES.map((x) => ({ ...x }));
    if (opts?.channel) r = r.filter((x) => x.channel === opts.channel);
    return r;
  }
  const qs = opts?.channel ? `?channel=${encodeURIComponent(opts.channel)}` : '';
  return getJson<NotificationTemplate[]>(`/templates${qs}`);
}
