// ── Hotelier Extranet — Paymax Stays service (Booking.com Extranet/Pulse) ─────
// Mock by default (mirrors staysAdminService). Flip with
// NEXT_PUBLIC_STAYS_USE_MOCK=false to hit the live Go backend at
// /api/stays/extranet/*. RBAC: stays.hotelier.* + staff roles.
// OBJECT-SCOPED: every call resolves to the signed-in hotelier's OWN property.
// Money is BIGINT kobo (minor units) and settled in Naira (NGN).

import { env } from '@/config/env';
import type {
  VerificationStatus,
  BusinessVerification,
  BankSettings,
  PropertyProfile,
  PhotoAsset,
  AmenityGroup,
  RoomType,
  RatePlan,
  CalendarData,
  BulkEditPayload,
  Restriction,
  Promotion,
  LoyaltyOptIn,
  VisibilityBooster,
  Opportunity,
  ReservationSummary,
  ReservationDetail,
  ModifyReservationPayload,
  ManualActionResult,
  GuestMessage,
  Review,
  Payout,
  Invoice,
  CommissionOverview,
  DepositReconRow,
  PerformanceAnalytics,
  ConversionFunnel,
  BookerInsights,
  MarketContext,
  StaffMember,
  ExtranetSettings,
} from '@/types/staysExtranet';

const USE_MOCK = (process.env.NEXT_PUBLIC_STAYS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function extranetBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/stays/extranet');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// IMPORTANT — this file's live paths are not just "simulated writes", they are
// mostly unreachable as currently coded. Every backend extranet route requires
// a property id in the URL path (POST /properties/:propertyId/room-types,
// PATCH /properties/:propertyId, etc. — see backend/internal/stays/extranet/
// handler.go Register() and backend/internal/stays/ari/handler.go
// RegisterExtranet()), because a hotelier can own MORE THAN ONE property. This
// file has no concept of "the current property" at all — PROPERTY_ID below is
// a MOCK-ONLY fixture constant, never read by any live-mode call — so every
// getJson/sendJson call here hits a flat path like `/room-types` that matches
// no route on the backend and would 404. `respondReview` also had an
// independent one-word path mismatch (/respond vs the real /response),
// unrelated to the property-scoping gap; that one is fixed to the real path.
// The rest need a "which property is this?" resolution mechanism — the same
// kind of thing associationAdminService.ts's org picker solved — before their
// live calls can work at all. That is a design decision, not a mechanical
// fix, so fixture mode refuses honestly rather than papering over it, and
// the live calls are left exactly as they were (still wrong, but not this
// task's to silently "fix" into a different wrong shape). See
// docs/audit/ADMIN_SIMULATED_WRITES.md and CLAUDE.md's "do not invent a
// fallback that silently succeeds" instruction.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_STAYS_USE_MOCK=false to make this change against the live backend.';
const NOT_PROPERTY_SCOPED =
  'is unavailable in fixture mode. Even with NEXT_PUBLIC_STAYS_USE_MOCK=false this call would ' +
  'still fail today: the live endpoint needs a property id in the URL that this service never ' +
  'resolves (see the file-level comment above). Fixture mode will not report a write it did not perform.';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${extranetBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${extranetBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// The Go backend nests staff/property routes under /properties/:propertyId/*
// (backend/internal/stays/extranet/handler.go). This resolves the signed-in
// hotelier's own property id via /me/properties — the one live-correct route
// that needs no propertyId itself — and caches it for the session.
let cachedPropertyId: string | null = null;
async function activePropertyId(): Promise<string> {
  if (cachedPropertyId) return cachedPropertyId;
  const rows = await getJson<Array<{ id: string }>>('/me/properties');
  if (!rows?.length) throw new Error('No property found for this hotelier account.');
  cachedPropertyId = rows[0].id;
  return cachedPropertyId;
}

// ── Display helpers: kobo → ₦ ────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
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
// DEMO PROPERTY (object-scoped to one Nigerian hotel)
// ════════════════════════════════════════════════════════════════════════════
const PROPERTY_ID = 'prop_lekki_grand_001';

const PROFILE: PropertyProfile = {
  property_id: PROPERTY_ID,
  name: 'Lekki Grand Hotel & Suites',
  type: 'hotel',
  star_rating: 4,
  description:
    'A modern 4-star hotel in the heart of Lekki Phase 1, offering contemporary rooms, a rooftop pool, ' +
    'and easy access to Victoria Island business district. Walking distance to Lekki Conservation Centre.',
  short_tagline: 'Contemporary comfort in Lekki Phase 1',
  address_line: '14 Admiralty Way, Lekki Phase 1',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  geo: { lat: 6.4391, lng: 3.4731 },
  check_in_from: '14:00',
  check_out_until: '12:00',
  contact_phone: '+234 801 234 5678',
  contact_email: 'reservations@lekkigrand.ng',
  currency: 'NGN',
  status: 'live',
};

const ROOM_TYPES: RoomType[] = [
  { id: 'rt_std', name: 'Standard Queen', max_occupancy: 2, beds: '1 Queen', size_sqm: 24, count: 30, smoking: false, status: 'active' },
  { id: 'rt_dlx', name: 'Deluxe King', max_occupancy: 2, beds: '1 King', size_sqm: 32, count: 18, smoking: false, status: 'active' },
  { id: 'rt_twin', name: 'Twin Room', max_occupancy: 2, beds: '2 Twin', size_sqm: 28, count: 12, smoking: false, status: 'active' },
  { id: 'rt_suite', name: 'Executive Suite', max_occupancy: 4, beds: '1 King + Sofa', size_sqm: 55, count: 6, smoking: false, status: 'active' },
];

const RATE_PLANS: RatePlan[] = [
  { id: 'rp_std_flex', room_type_id: 'rt_std', name: 'Standard — Flexible', board: 'breakfast', refundable: true, cancellation_window_hours: 24, mobile_rate: false, derived_from: null, derived_adjustment_pct: null, loyalty_opt_in: true, base_rate_kobo: 85_000_00, currency: 'NGN', status: 'active' },
  { id: 'rp_std_nr', room_type_id: 'rt_std', name: 'Standard — Non-refundable', board: 'breakfast', refundable: false, cancellation_window_hours: 0, mobile_rate: true, derived_from: 'rp_std_flex', derived_adjustment_pct: -0.12, loyalty_opt_in: true, base_rate_kobo: 74_800_00, currency: 'NGN', status: 'active' },
  { id: 'rp_dlx_flex', room_type_id: 'rt_dlx', name: 'Deluxe — Flexible', board: 'breakfast', refundable: true, cancellation_window_hours: 48, mobile_rate: false, derived_from: null, derived_adjustment_pct: null, loyalty_opt_in: true, base_rate_kobo: 120_000_00, currency: 'NGN', status: 'active' },
  { id: 'rp_suite_hb', room_type_id: 'rt_suite', name: 'Suite — Half Board', board: 'half_board', refundable: true, cancellation_window_hours: 72, mobile_rate: false, derived_from: null, derived_adjustment_pct: null, loyalty_opt_in: false, base_rate_kobo: 240_000_00, currency: 'NGN', status: 'active' },
];

// ── A · Onboarding & verification ────────────────────────────────────────────
const VERIFICATION: VerificationStatus = {
  property_id: PROPERTY_ID,
  property_name: PROFILE.name,
  overall: 'approved',
  go_live_eligible: true,
  submitted_for_review_at: iso(240),
  reviewed_at: iso(120),
  reviewer_note: 'All documents verified. Bank account confirmed via NIBSS name enquiry.',
  checklist: [
    { key: 'signup', label: 'Hotelier account created (SSO → Hotelier capability)', stage: 'signup', status: 'approved', required: true },
    { key: 'property', label: 'Property registered (name, type, address, geo)', stage: 'property', status: 'approved', required: true },
    { key: 'kyc', label: 'Director identity verified (KYC)', stage: 'verification', status: 'approved', required: true },
    { key: 'business_docs', label: 'CAC certificate & business docs uploaded', stage: 'verification', status: 'approved', required: true },
    { key: 'bank', label: 'Bank / payout account verified (Naira)', stage: 'verification', status: 'approved', required: true },
    { key: 'photos', label: 'At least 8 photos uploaded (cover set)', stage: 'content', status: 'approved', required: true },
    { key: 'room_types', label: 'At least 1 room type with rate plan', stage: 'content', status: 'approved', required: true },
    { key: 'policies', label: 'Policies configured (check-in/out, cancellation)', stage: 'policies', status: 'approved', required: true },
    { key: 'rates', label: '90 days of availability & rates loaded', stage: 'go_live', status: 'approved', required: true },
  ],
};

const BUSINESS_VERIFICATION: BusinessVerification = {
  legal_name: 'Lekki Grand Hospitality Ltd',
  rc_number: 'RC-1448920',
  tin: '21884470-0001',
  kyc_status: 'approved',
  business_doc_status: 'approved',
  director_name: 'Adebayo Okonkwo',
  director_bvn_last4: '4471',
};

const BANK_SETTINGS: BankSettings = {
  bank_name: 'Guaranty Trust Bank',
  account_name: 'Lekki Grand Hospitality Ltd',
  account_number: '0123456789',
  currency: 'NGN',
  verified: true,
  payout_schedule: 'weekly',
  next_payout_date: dateAhead(3),
};

// ── B · Content & inventory ──────────────────────────────────────────────────
const PHOTOS: PhotoAsset[] = [
  { id: 'ph1', url: 'https://images.unsplash.com/photo-hotel-exterior', caption: 'Hotel exterior at dusk', tag: 'exterior', is_cover: true, order: 1 },
  { id: 'ph2', url: 'https://images.unsplash.com/photo-deluxe-king', caption: 'Deluxe King room', tag: 'room', is_cover: false, order: 2 },
  { id: 'ph3', url: 'https://images.unsplash.com/photo-lobby', caption: 'Reception lobby', tag: 'lobby', is_cover: false, order: 3 },
  { id: 'ph4', url: 'https://images.unsplash.com/photo-rooftop-pool', caption: 'Rooftop infinity pool', tag: 'amenity', is_cover: false, order: 4 },
  { id: 'ph5', url: 'https://images.unsplash.com/photo-restaurant', caption: 'All-day dining restaurant', tag: 'dining', is_cover: false, order: 5 },
  { id: 'ph6', url: 'https://images.unsplash.com/photo-suite', caption: 'Executive suite living area', tag: 'room', is_cover: false, order: 6 },
  { id: 'ph7', url: 'https://images.unsplash.com/photo-view', caption: 'Lagoon view from suite', tag: 'view', is_cover: false, order: 7 },
  { id: 'ph8', url: 'https://images.unsplash.com/photo-bar', caption: 'Rooftop bar', tag: 'amenity', is_cover: false, order: 8 },
];

const AMENITIES: AmenityGroup[] = [
  { group: 'General', items: [
    { key: 'wifi', label: 'Free Wi-Fi', enabled: true },
    { key: 'parking', label: 'Free parking', enabled: true },
    { key: 'ac', label: 'Air conditioning', enabled: true },
    { key: 'gen', label: '24/7 backup generator', enabled: true },
    { key: 'elevator', label: 'Elevator', enabled: true },
  ]},
  { group: 'Wellness & Leisure', items: [
    { key: 'pool', label: 'Outdoor pool', enabled: true },
    { key: 'gym', label: 'Fitness centre', enabled: true },
    { key: 'spa', label: 'Spa', enabled: false },
  ]},
  { group: 'Food & Drink', items: [
    { key: 'restaurant', label: 'Restaurant', enabled: true },
    { key: 'bar', label: 'Bar', enabled: true },
    { key: 'room_service', label: '24h room service', enabled: true },
  ]},
  { group: 'Services', items: [
    { key: 'airport_shuttle', label: 'Airport shuttle', enabled: true },
    { key: 'laundry', label: 'Laundry', enabled: true },
    { key: 'concierge', label: 'Concierge', enabled: true },
    { key: 'business_centre', label: 'Business centre', enabled: false },
  ]},
];

function buildCalendar(month: string): CalendarData {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows = ROOM_TYPES.filter((r) => r.status === 'active').map((rt) => {
    const rp = RATE_PLANS.find((p) => p.room_type_id === rt.id);
    const base = rp?.base_rate_kobo ?? 90_000_00;
    const cells = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const weekend = [0, 6].includes(new Date(y, m - 1, day).getDay());
      const avail = Math.max(0, rt.count - ((day * 3 + (rt.id.length)) % (rt.count + 1)));
      return {
        date,
        available: avail,
        rate_kobo: weekend ? Math.round(base * 1.15) : base,
        min_los: weekend ? 2 : 1,
        cta: false,
        ctd: false,
        stop_sell: avail === 0,
      };
    });
    return { room_type_id: rt.id, room_type_name: rt.name, cells };
  });
  return { property_id: PROPERTY_ID, month, currency: 'NGN', rows };
}

const RESTRICTIONS: Restriction[] = ROOM_TYPES.map((rt) => ({
  room_type_id: rt.id,
  room_type_name: rt.name,
  min_los: rt.id === 'rt_suite' ? 2 : 1,
  max_los: 30,
  cta: false,
  ctd: false,
  stop_sell: false,
}));

// ── C · Promotions & visibility ──────────────────────────────────────────────
const PROMOTIONS: Promotion[] = [
  { id: 'promo_eb', name: 'Book 30 Days Ahead', type: 'early_bird', discount_pct: 0.15, date_from: dateStr(5), date_to: dateAhead(120), advance_days: 30, min_los: null, last_minute_hours: null, applies_to_rate_plans: ['rp_std_flex', 'rp_dlx_flex'], status: 'active', redemptions: 42 },
  { id: 'promo_los', name: 'Stay 3 Pay 2', type: 'los', discount_pct: 0.20, date_from: dateStr(10), date_to: dateAhead(90), min_los: 3, advance_days: null, last_minute_hours: null, applies_to_rate_plans: ['rp_dlx_flex', 'rp_suite_hb'], status: 'active', redemptions: 18 },
  { id: 'promo_lm', name: 'Last-Minute Lekki', type: 'last_minute', discount_pct: 0.12, date_from: dateStr(2), date_to: dateAhead(30), last_minute_hours: 48, min_los: null, advance_days: null, applies_to_rate_plans: ['rp_std_nr'], status: 'scheduled', redemptions: 0 },
  { id: 'promo_mob', name: 'Mobile-Only Saver', type: 'mobile', discount_pct: 0.08, date_from: dateStr(30), date_to: dateAhead(60), min_los: null, advance_days: null, last_minute_hours: null, applies_to_rate_plans: ['rp_std_nr'], status: 'active', redemptions: 67 },
];

const LOYALTY: LoyaltyOptIn = {
  program_name: 'Paymax Stays Rewards',
  enrolled_rate_plans: RATE_PLANS.map((rp) => ({ rate_plan_id: rp.id, name: rp.name, opted_in: rp.loyalty_opt_in, earn_rate_pct: rp.loyalty_opt_in ? 0.05 : 0 })),
  member_bookings_30d: 88,
  member_gmv_30d_kobo: 11_240_000_00,
};

const VISIBILITY: VisibilityBooster = {
  phase: 'phase_3_placeholder',
  enabled: false,
  current_rank: 7,
  suggested_commission_uplift_pct: 0.02,
  note: 'Visibility Booster (commission-for-ranking) launches in Phase 3. Opt-in will let you trade a small commission uplift for higher placement in Paymax Stays search.',
};

const OPPORTUNITIES: Opportunity[] = [
  { id: 'op1', title: 'Add 6 more photos to reach the 14-photo sweet spot', category: 'content', impact: 'high', description: 'Properties with 14+ photos convert 23% better. You currently have 8.', cta_label: 'Open photo manager', cta_href: '/extranet/photos' },
  { id: 'op2', title: 'Your weekend rates are 18% above market', category: 'pricing', impact: 'medium', description: 'Consider a small reduction on Fri–Sat for the Standard Queen to capture more demand.', cta_label: 'Open calendar', cta_href: '/extranet/calendar' },
  { id: 'op3', title: 'Launch a last-minute promotion', category: 'promotions', impact: 'medium', description: 'You have low occupancy in the next 7 days. A last-minute deal could fill 12 rooms.', cta_label: 'Create promotion', cta_href: '/extranet/promotions' },
  { id: 'op4', title: 'Respond to 2 pending reviews', category: 'reviews', impact: 'low', description: 'Responding to reviews improves guest trust and ranking.', cta_label: 'Open reviews', cta_href: '/extranet/reviews' },
];

// ── D · Reservations & guests ────────────────────────────────────────────────
const RESERVATIONS: ReservationDetail[] = [
  { id: 'res_1', ref: 'PMX-STY-7741', guest_name: 'Chioma Eze', room_type_name: 'Deluxe King', rate_plan_name: 'Deluxe — Flexible', check_in: dateStr(0), check_out: dateAhead(2), nights: 2, guests: 2, status: 'confirmed', payment_status: 'paid', total_kobo: 240_000_00, currency: 'NGN', channel: 'paymax_app', created_at: iso(50), guest_email: 'chioma.eze@example.ng', guest_phone: '+234 802 111 2222', guest_country: 'Nigeria', special_requests: 'High floor, late check-in ~22:00', board: 'breakfast', deposit_kobo: 0, balance_due_kobo: 0, commission_kobo: 28_800_00, net_to_hotel_kobo: 211_200_00, loyalty_member: true, timeline: [ { at: iso(50), label: 'Reservation confirmed', kind: 'confirmed' }, { at: iso(50), label: 'Payment captured (₦240,000.00)', kind: 'paid' } ] },
  { id: 'res_2', ref: 'PMX-STY-7738', guest_name: 'Tunde Bakare', room_type_name: 'Standard Queen', rate_plan_name: 'Standard — Non-refundable', check_in: dateStr(0), check_out: dateAhead(1), nights: 1, guests: 1, status: 'in_house', payment_status: 'paid', total_kobo: 74_800_00, currency: 'NGN', channel: 'agent', created_at: iso(72), guest_email: 'tunde.b@example.ng', guest_phone: '+234 803 222 3333', guest_country: 'Nigeria', special_requests: null, board: 'breakfast', deposit_kobo: 0, balance_due_kobo: 0, commission_kobo: 8_976_00, net_to_hotel_kobo: 65_824_00, loyalty_member: false, timeline: [ { at: iso(72), label: 'Reservation confirmed (agent-assisted)', kind: 'confirmed' }, { at: iso(2), label: 'Guest checked in', kind: 'in_house' } ] },
  { id: 'res_3', ref: 'PMX-STY-7720', guest_name: 'Amara Nwosu', room_type_name: 'Executive Suite', rate_plan_name: 'Suite — Half Board', check_in: dateAhead(0), check_out: dateAhead(3), nights: 3, guests: 3, status: 'confirmed', payment_status: 'deposit_held', total_kobo: 720_000_00, currency: 'NGN', channel: 'paymax_app', created_at: iso(30), guest_email: 'amara.n@example.ng', guest_phone: '+234 804 333 4444', guest_country: 'Nigeria', special_requests: 'Anniversary — flowers if possible', board: 'half_board', deposit_kobo: 144_000_00, balance_due_kobo: 576_000_00, commission_kobo: 86_400_00, net_to_hotel_kobo: 633_600_00, loyalty_member: true, timeline: [ { at: iso(30), label: 'Reservation confirmed', kind: 'confirmed' }, { at: iso(30), label: 'Deposit held (₦144,000.00)', kind: 'deposit_held' } ] },
  { id: 'res_4', ref: 'PMX-STY-7702', guest_name: 'David Okoro', room_type_name: 'Twin Room', rate_plan_name: 'Standard — Flexible', check_in: dateStr(1), check_out: dateStr(0), nights: 1, guests: 2, status: 'completed', payment_status: 'paid', total_kobo: 85_000_00, currency: 'NGN', channel: 'paymax_app', created_at: iso(96), guest_email: 'david.o@example.ng', guest_phone: '+234 805 444 5555', guest_country: 'Nigeria', special_requests: null, board: 'breakfast', deposit_kobo: 0, balance_due_kobo: 0, commission_kobo: 10_200_00, net_to_hotel_kobo: 74_800_00, loyalty_member: false, timeline: [ { at: iso(96), label: 'Reservation confirmed', kind: 'confirmed' }, { at: iso(26), label: 'Guest checked out', kind: 'completed' } ] },
  { id: 'res_5', ref: 'PMX-STY-7690', guest_name: 'Funmi Adeyemi', room_type_name: 'Standard Queen', rate_plan_name: 'Standard — Flexible', check_in: dateStr(0), check_out: dateAhead(1), nights: 1, guests: 1, status: 'no_show', payment_status: 'paid', total_kobo: 85_000_00, currency: 'NGN', channel: 'paymax_app', created_at: iso(120), guest_email: 'funmi.a@example.ng', guest_phone: '+234 806 555 6666', guest_country: 'Nigeria', special_requests: null, board: 'breakfast', deposit_kobo: 0, balance_due_kobo: 0, commission_kobo: 10_200_00, net_to_hotel_kobo: 74_800_00, loyalty_member: false, timeline: [ { at: iso(120), label: 'Reservation confirmed', kind: 'confirmed' }, { at: iso(1), label: 'Marked no-show by front desk', kind: 'no_show' } ] },
  { id: 'res_6', ref: 'PMX-STY-7655', guest_name: 'Ibrahim Sani', room_type_name: 'Deluxe King', rate_plan_name: 'Deluxe — Flexible', check_in: dateAhead(5), check_out: dateAhead(8), nights: 3, guests: 2, status: 'confirmed', payment_status: 'pay_at_property', total_kobo: 360_000_00, currency: 'NGN', channel: 'paymax_app', created_at: iso(20), guest_email: 'ibrahim.s@example.ng', guest_phone: '+234 807 666 7777', guest_country: 'Nigeria', special_requests: 'Quiet room', board: 'breakfast', deposit_kobo: 0, balance_due_kobo: 360_000_00, commission_kobo: 43_200_00, net_to_hotel_kobo: 316_800_00, loyalty_member: true, timeline: [ { at: iso(20), label: 'Reservation confirmed (pay at property)', kind: 'confirmed' } ] },
];

const MESSAGES: GuestMessage[] = [
  { id: 'msg_1', reservation_ref: 'PMX-STY-7741', guest_name: 'Chioma Eze', last_message: 'Hi, can I get an early check-in around noon?', unread: 1, from: 'guest', updated_at: iso(3) },
  { id: 'msg_2', reservation_ref: 'PMX-STY-7655', guest_name: 'Ibrahim Sani', last_message: 'Thanks, see you on the 5th!', unread: 0, from: 'guest', updated_at: iso(18) },
  { id: 'msg_3', reservation_ref: 'PMX-STY-7720', guest_name: 'Amara Nwosu', last_message: 'We have noted the anniversary request.', unread: 0, from: 'hotel', updated_at: iso(28) },
];

const REVIEWS: Review[] = [
  { id: 'rev_1', guest_name: 'David Okoro', reservation_ref: 'PMX-STY-7702', rating: 9, title: 'Great location, friendly staff', body: 'Rooms were clean and the rooftop pool was a highlight. Breakfast could have more local options.', created_at: iso(20), response: null, responded_at: null, status: 'published' },
  { id: 'rev_2', guest_name: 'Blessing Udo', reservation_ref: 'PMX-STY-7610', rating: 7, title: 'Good but generator noise at night', body: 'Comfortable stay overall, but the backup generator was a bit loud on the lower floors.', created_at: iso(80), response: null, responded_at: null, status: 'published' },
  { id: 'rev_3', guest_name: 'Kemi Lawal', reservation_ref: 'PMX-STY-7580', rating: 10, title: 'Perfect anniversary stay', body: 'The suite was beautiful and the staff went above and beyond. Highly recommend.', created_at: iso(150), response: 'Thank you so much, Kemi! We were delighted to host your anniversary and hope to welcome you back soon.', responded_at: iso(140), status: 'published' },
];

// ── E · Finance ──────────────────────────────────────────────────────────────
const PAYOUTS: Payout[] = [
  { id: 'po_1', period: `${dateStr(13)} → ${dateStr(7)}`, gross_kobo: 4_820_000_00, commission_kobo: 578_400_00, net_kobo: 4_241_600_00, currency: 'NGN', status: 'paid', paid_at: iso(120), reference: 'PMX-PAYOUT-00231' },
  { id: 'po_2', period: `${dateStr(6)} → ${dateStr(0)}`, gross_kobo: 5_310_000_00, commission_kobo: 637_200_00, net_kobo: 4_672_800_00, currency: 'NGN', status: 'scheduled', paid_at: null, reference: null },
  { id: 'po_3', period: `${dateStr(20)} → ${dateStr(14)}`, gross_kobo: 3_990_000_00, commission_kobo: 478_800_00, net_kobo: 3_511_200_00, currency: 'NGN', status: 'paid', paid_at: iso(290), reference: 'PMX-PAYOUT-00198' },
];

const INVOICES: Invoice[] = [
  { id: 'inv_1', number: 'INV-2026-0612', issued_at: iso(120), amount_kobo: 578_400_00, currency: 'NGN', type: 'commission', status: 'paid' },
  { id: 'inv_2', number: 'INV-2026-0606', issued_at: iso(290), amount_kobo: 478_800_00, currency: 'NGN', type: 'commission', status: 'paid' },
  { id: 'inv_3', number: 'INV-2026-0501', issued_at: iso(620), amount_kobo: 25_000_00, currency: 'NGN', type: 'service_fee', status: 'overdue' },
];

const COMMISSION: CommissionOverview = {
  rate_pct: 0.12,
  gmv_30d_kobo: 18_640_000_00,
  commission_30d_kobo: 2_236_800_00,
  net_30d_kobo: 16_403_200_00,
  currency: 'NGN',
  by_rate_plan: [
    { rate_plan_name: 'Deluxe — Flexible', gmv_kobo: 7_200_000_00, commission_kobo: 864_000_00 },
    { rate_plan_name: 'Standard — Flexible', gmv_kobo: 5_100_000_00, commission_kobo: 612_000_00 },
    { rate_plan_name: 'Suite — Half Board', gmv_kobo: 4_320_000_00, commission_kobo: 518_400_00 },
    { rate_plan_name: 'Standard — Non-refundable', gmv_kobo: 2_020_000_00, commission_kobo: 242_400_00 },
  ],
};

const DEPOSIT_RECON: DepositReconRow[] = [
  { reservation_ref: 'PMX-STY-7720', guest_name: 'Amara Nwosu', check_in: dateAhead(0), deposit_kobo: 144_000_00, collected_at_property_kobo: 0, status: 'pending', currency: 'NGN' },
  { reservation_ref: 'PMX-STY-7655', guest_name: 'Ibrahim Sani', check_in: dateAhead(5), deposit_kobo: 0, collected_at_property_kobo: 0, status: 'pending', currency: 'NGN' },
  { reservation_ref: 'PMX-STY-7702', guest_name: 'David Okoro', check_in: dateStr(1), deposit_kobo: 0, collected_at_property_kobo: 85_000_00, status: 'reconciled', currency: 'NGN' },
  { reservation_ref: 'PMX-STY-7588', guest_name: 'Ngozi Obi', check_in: dateStr(8), deposit_kobo: 60_000_00, collected_at_property_kobo: 40_000_00, status: 'flagged', currency: 'NGN' },
];

// ── F · Analytics ────────────────────────────────────────────────────────────
const PERFORMANCE: PerformanceAnalytics = {
  currency: 'NGN',
  occupancy_pct: 0.74,
  adr_kobo: 112_400_00,
  revpar_kobo: 83_176_00,
  total_revenue_30d_kobo: 18_640_000_00,
  trend: Array.from({ length: 14 }, (_, i) => {
    const occ = 0.6 + 0.25 * Math.sin(i / 2);
    const adr = 100_000_00 + Math.round(20_000_00 * Math.cos(i / 3));
    return { date: dateStr(13 - i), occupancy_pct: Math.round(occ * 100) / 100, adr_kobo: adr, revpar_kobo: Math.round(adr * occ) };
  }),
};

const CONVERSION: ConversionFunnel = {
  searches: 12_400,
  property_views: 3_720,
  rate_views: 1_488,
  add_to_cart: 446,
  bookings: 156,
  view_to_book_pct: 0.042,
};

const BOOKERS: BookerInsights = {
  by_geo: [
    { region: 'Lagos', bookings: 78, share_pct: 0.50 },
    { region: 'Abuja (FCT)', bookings: 31, share_pct: 0.20 },
    { region: 'Rivers', bookings: 16, share_pct: 0.10 },
    { region: 'International', bookings: 16, share_pct: 0.10 },
    { region: 'Other states', bookings: 15, share_pct: 0.10 },
  ],
  by_device: [
    { device: 'Mobile app', bookings: 109, share_pct: 0.70 },
    { device: 'Mobile web', bookings: 31, share_pct: 0.20 },
    { device: 'Desktop', bookings: 16, share_pct: 0.10 },
  ],
  lead_time_buckets: [
    { bucket: '0–1 days', bookings: 38 },
    { bucket: '2–7 days', bookings: 54 },
    { bucket: '8–30 days', bookings: 47 },
    { bucket: '31+ days', bookings: 17 },
  ],
};

const MARKET: MarketContext = {
  currency: 'NGN',
  your_adr_kobo: 112_400_00,
  market_median_adr_kobo: 98_500_00,
  comp_set: [
    { name: 'Lekki Phase 1 — 4★ avg', adr_kobo: 98_500_00, occupancy_pct: 0.68 },
    { name: 'Victoria Island — 4★ avg', adr_kobo: 134_000_00, occupancy_pct: 0.71 },
    { name: 'Ikoyi — 4★ avg', adr_kobo: 145_000_00, occupancy_pct: 0.66 },
  ],
  note: 'Market context is anonymised and aggregated from comparable Paymax Stays properties in your area.',
};

// ── G · Account & staff ──────────────────────────────────────────────────────
const STAFF: StaffMember[] = [
  { id: 'st_1', name: 'Adebayo Okonkwo', email: 'adebayo@lekkigrand.ng', role: 'owner', status: 'active', last_active: iso(2) },
  { id: 'st_2', name: 'Grace Eberechi', email: 'grace@lekkigrand.ng', role: 'revenue_manager', status: 'active', last_active: iso(8) },
  { id: 'st_3', name: 'Samuel Adeniyi', email: 'samuel@lekkigrand.ng', role: 'front_desk', status: 'active', last_active: iso(1) },
  { id: 'st_4', name: 'Patience Eze', email: 'patience@lekkigrand.ng', role: 'front_desk', status: 'invited', last_active: null },
];

const SETTINGS: ExtranetSettings = {
  property_id: PROPERTY_ID,
  notifications: { new_reservation: true, cancellation: true, new_review: true, new_message: true, payout: true },
  channel: { email: true, sms: true, push: true },
  timezone: 'Africa/Lagos',
  default_currency: 'NGN',
};

// ════════════════════════════════════════════════════════════════════════════
// Public API — mock-backed with live fallthrough
// ════════════════════════════════════════════════════════════════════════════

// A · Onboarding & verification
export async function getVerificationStatus(): Promise<VerificationStatus> {
  if (USE_MOCK) { await delay(); return VERIFICATION; }
  return getJson<VerificationStatus>('/verification');
}
export async function getBusinessVerification(): Promise<BusinessVerification> {
  if (USE_MOCK) { await delay(); return BUSINESS_VERIFICATION; }
  return getJson<BusinessVerification>('/verification/business');
}
export async function submitForReview(): Promise<VerificationStatus> {
  // No backend at all: there is no verification/submit route anywhere in
  // backend/internal/stays/extranet (confirmed by grep) — not just missing
  // property scoping like most of this file's other writes.
  if (USE_MOCK) throw new Error(`Submitting for review ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<VerificationStatus>('POST', '/verification/submit', {});
}

// B · Content & inventory
export async function getProperty(): Promise<PropertyProfile> {
  if (USE_MOCK) { await delay(); return PROFILE; }
  return getJson<PropertyProfile>('/property');
}
export async function updateContent(patch: Partial<PropertyProfile>): Promise<PropertyProfile> {
  if (USE_MOCK) throw new Error(`Updating property content ${NOT_PROPERTY_SCOPED}`);
  return sendJson<PropertyProfile>('PATCH', '/property', patch);
}
export async function getPhotos(): Promise<PhotoAsset[]> {
  if (USE_MOCK) { await delay(); return PHOTOS; }
  return getJson<PhotoAsset[]>('/photos');
}
export async function getAmenities(): Promise<AmenityGroup[]> {
  if (USE_MOCK) { await delay(); return AMENITIES; }
  return getJson<AmenityGroup[]>('/amenities');
}
export async function updateAmenities(groups: AmenityGroup[]): Promise<AmenityGroup[]> {
  // No backend at all: no amenities route anywhere in backend/internal/stays
  // (confirmed by grep) — not just missing property scoping.
  if (USE_MOCK) throw new Error(`Updating amenities ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<AmenityGroup[]>('PUT', '/amenities', groups);
}
export async function listRoomTypes(): Promise<RoomType[]> {
  if (USE_MOCK) { await delay(); return ROOM_TYPES; }
  return getJson<RoomType[]>('/room-types');
}
export async function upsertRoomType(rt: Partial<RoomType>): Promise<RoomType> {
  // Also no UPDATE path on the backend even once property-scoped — only
  // POST /properties/:propertyId/room-types (create) exists.
  if (USE_MOCK) throw new Error(`Saving a room type ${NOT_PROPERTY_SCOPED}`);
  return sendJson<RoomType>('POST', '/room-types', rt);
}
export async function listRatePlans(): Promise<RatePlan[]> {
  if (USE_MOCK) { await delay(); return RATE_PLANS; }
  return getJson<RatePlan[]>('/rate-plans');
}
export async function upsertRatePlan(rp: Partial<RatePlan>): Promise<RatePlan> {
  // Also no UPDATE path on the backend even once property-scoped — only
  // POST /properties/:propertyId/rate-plans (create) exists.
  if (USE_MOCK) throw new Error(`Saving a rate plan ${NOT_PROPERTY_SCOPED}`);
  return sendJson<RatePlan>('POST', '/rate-plans', rp);
}
export async function getCalendar(month: string): Promise<CalendarData> {
  if (USE_MOCK) { await delay(); return buildCalendar(month); }
  return getJson<CalendarData>(`/calendar?month=${encodeURIComponent(month)}`);
}
export async function bulkEditCalendar(payload: BulkEditPayload): Promise<{ updated_cells: number }> {
  // The backend splits this into TWO endpoints scoped by id, not one flat
  // combined route: POST /rate-plans/:ratePlanId/calendar/bulk (rates) and
  // POST /room-types/:roomTypeId/availability/bulk (availability).
  if (USE_MOCK) throw new Error(`Bulk-editing the calendar ${NOT_PROPERTY_SCOPED}`);
  return sendJson<{ updated_cells: number }>('POST', '/calendar/bulk-edit', payload);
}
export async function getRestrictions(): Promise<Restriction[]> {
  if (USE_MOCK) { await delay(); return RESTRICTIONS; }
  return getJson<Restriction[]>('/restrictions');
}
export async function updateRestrictions(rows: Restriction[]): Promise<Restriction[]> {
  if (USE_MOCK) throw new Error(`Updating restrictions ${NOT_PROPERTY_SCOPED}`);
  return sendJson<Restriction[]>('PUT', '/restrictions', rows);
}

// C · Promotions & visibility
export async function listPromotions(): Promise<Promotion[]> {
  if (USE_MOCK) { await delay(); return PROMOTIONS; }
  return getJson<Promotion[]>('/promotions');
}
export async function upsertPromotion(p: Partial<Promotion>): Promise<Promotion> {
  // Also no field-update path on the backend even once property-scoped — only
  // POST /properties/:propertyId/promotions (create) and
  // POST .../promotions/:promoId/active (status toggle) exist.
  if (USE_MOCK) throw new Error(`Saving a promotion ${NOT_PROPERTY_SCOPED}`);
  return sendJson<Promotion>('POST', '/promotions', p);
}
export async function getLoyaltyOptIn(): Promise<LoyaltyOptIn> {
  if (USE_MOCK) { await delay(); return LOYALTY; }
  return getJson<LoyaltyOptIn>('/loyalty');
}
export async function updateLoyaltyOptIn(ratePlanId: string, optedIn: boolean): Promise<LoyaltyOptIn> {
  // No backend at all: no loyalty route anywhere in backend/internal/stays
  // (confirmed by grep) — not just missing property scoping.
  if (USE_MOCK) throw new Error(`Updating loyalty opt-in ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<LoyaltyOptIn>('PATCH', '/loyalty', { rate_plan_id: ratePlanId, opted_in: optedIn });
}
export async function getVisibilityBooster(): Promise<VisibilityBooster> {
  if (USE_MOCK) { await delay(); return VISIBILITY; }
  return getJson<VisibilityBooster>('/visibility');
}
export async function listOpportunities(): Promise<Opportunity[]> {
  if (USE_MOCK) { await delay(); return OPPORTUNITIES; }
  return getJson<Opportunity[]>('/opportunities');
}

// D · Reservations & guests
export async function listReservations(): Promise<ReservationSummary[]> {
  if (USE_MOCK) { await delay(); return RESERVATIONS.map(({ guest_email, guest_phone, guest_country, special_requests, board, deposit_kobo, balance_due_kobo, commission_kobo, net_to_hotel_kobo, loyalty_member, timeline, ...s }) => s); }
  return getJson<ReservationSummary[]>('/reservations');
}
export async function getReservation(id: string): Promise<ReservationDetail | null> {
  if (USE_MOCK) { await delay(); return RESERVATIONS.find((r) => r.id === id) ?? null; }
  return getJson<ReservationDetail>(`/reservations/${id}`);
}
export async function modifyReservation(payload: ModifyReservationPayload): Promise<ManualActionResult> {
  // The backend has no generic /modify action either: only
  // POST .../reservations/:reservationId/no-show and .../cancel exist
  // (MarkNoShow, CancelByHotel) — modify_dates/modify_room have no endpoint
  // at all, on top of the missing property scoping every other write here has.
  if (USE_MOCK) throw new Error(`Modifying a reservation ${NOT_PROPERTY_SCOPED}`);
  return sendJson<ManualActionResult>('POST', `/reservations/${payload.reservation_id}/modify`, payload);
}
export async function markNoShow(reservationId: string, reason?: string): Promise<ManualActionResult> {
  return modifyReservation({ reservation_id: reservationId, action: 'mark_no_show', reason });
}
export async function listMessages(): Promise<GuestMessage[]> {
  if (USE_MOCK) { await delay(); return MESSAGES; }
  return getJson<GuestMessage[]>('/messages');
}
export async function listReviews(): Promise<Review[]> {
  if (USE_MOCK) { await delay(); return REVIEWS; }
  return getJson<Review[]>('/reviews');
}
export async function respondReview(reviewId: string, response: string): Promise<Review> {
  if (USE_MOCK) throw new Error(`Responding to a review ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /reviews/:reviewId/response (reviews.Handler.Respond) — no
  // property id needed (reviewId alone is enough to resolve authorization).
  // The old "/respond" here was a one-word path typo; this is the ONE write
  // in this file whose fix is a mechanical path correction rather than a
  // property-scoping redesign — see the file-level comment above.
  return sendJson<Review>('POST', `/reviews/${reviewId}/response`, { response });
}

// E · Finance
export async function getPayouts(): Promise<Payout[]> {
  if (USE_MOCK) { await delay(); return PAYOUTS; }
  return getJson<Payout[]>('/payouts');
}
export async function getInvoices(): Promise<Invoice[]> {
  if (USE_MOCK) { await delay(); return INVOICES; }
  return getJson<Invoice[]>('/invoices');
}
export async function getCommission(): Promise<CommissionOverview> {
  if (USE_MOCK) { await delay(); return COMMISSION; }
  return getJson<CommissionOverview>('/commission');
}
export async function getDepositRecon(): Promise<DepositReconRow[]> {
  if (USE_MOCK) { await delay(); return DEPOSIT_RECON; }
  return getJson<DepositReconRow[]>('/deposit-recon');
}
export async function getBankSettings(): Promise<BankSettings> {
  if (USE_MOCK) { await delay(); return BANK_SETTINGS; }
  return getJson<BankSettings>('/bank');
}
export async function updateBankSettings(patch: Partial<BankSettings>): Promise<BankSettings> {
  // No backend at all: no bank-settings route anywhere in backend/internal/
  // stays (confirmed by grep) — not just missing property scoping.
  if (USE_MOCK) throw new Error(`Updating bank settings ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<BankSettings>('PATCH', '/bank', patch);
}

// F · Analytics
export async function getPerformance(): Promise<PerformanceAnalytics> {
  if (USE_MOCK) { await delay(); return PERFORMANCE; }
  return getJson<PerformanceAnalytics>('/analytics/performance');
}
export async function getConversion(): Promise<ConversionFunnel> {
  if (USE_MOCK) { await delay(); return CONVERSION; }
  return getJson<ConversionFunnel>('/analytics/conversion');
}
export async function getBookerInsights(): Promise<BookerInsights> {
  if (USE_MOCK) { await delay(); return BOOKERS; }
  return getJson<BookerInsights>('/analytics/bookers');
}
export async function getMarketContext(): Promise<MarketContext> {
  if (USE_MOCK) { await delay(); return MARKET; }
  return getJson<MarketContext>('/analytics/market');
}
// Convenience aggregate (mirrors staysAdminService getAnalytics naming).
export async function getAnalytics(): Promise<{ performance: PerformanceAnalytics; conversion: ConversionFunnel; bookers: BookerInsights; market: MarketContext }> {
  const [performance, conversion, bookers, market] = await Promise.all([getPerformance(), getConversion(), getBookerInsights(), getMarketContext()]);
  return { performance, conversion, bookers, market };
}

// G · Account & staff
export async function listStaff(): Promise<StaffMember[]> {
  if (USE_MOCK) { await delay(); return STAFF; }
  return getJson<StaffMember[]>('/staff');
}
// Backend roles (stays_hotelier_profile CHECK constraint) vs this UI's StaffRole
// naming. OWNER is deliberately absent: it mirrors the property creator and is
// never grantable through an invite (backend rejects it — see staff_invite.go).
const STAFF_ROLE_TO_BACKEND: Record<Exclude<StaffMember['role'], 'owner'>, string> = {
  revenue_manager: 'MANAGER',
  front_desk: 'FRONT_DESK',
};

// Invites via POST /properties/:propertyId/staff/invite {name, email, role}. If
// a Paymax platform user already owns that email the grant lands immediately
// (status 'active'); otherwise the backend emails a signup/accept link and the
// grant lands once they accept (status 'invited' here in the meantime).
export async function inviteStaff(name: string, email: string, role: Exclude<StaffMember['role'], 'owner'>): Promise<StaffMember> {
  if (USE_MOCK) throw new Error(`Inviting a staff member ${NOT_IN_FIXTURE_MODE}`);
  const propertyId = await activePropertyId();
  const res = await sendJson<{ email: string; role: string; status: 'active' | 'invited' }>(
    'POST',
    `/properties/${propertyId}/staff/invite`,
    { name, email, role: STAFF_ROLE_TO_BACKEND[role] },
  );
  return { id: `st_${Date.now()}`, name, email, role, status: res.status, last_active: null };
}
export async function getSettings(): Promise<ExtranetSettings> {
  if (USE_MOCK) { await delay(); return SETTINGS; }
  return getJson<ExtranetSettings>('/settings');
}
export async function updateSettings(patch: Partial<ExtranetSettings>): Promise<ExtranetSettings> {
  // No backend at all: no generic settings route anywhere in
  // backend/internal/stays (confirmed by grep) — not just missing property
  // scoping.
  if (USE_MOCK) throw new Error(`Updating extranet settings ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<ExtranetSettings>('PATCH', '/settings', patch);
}
