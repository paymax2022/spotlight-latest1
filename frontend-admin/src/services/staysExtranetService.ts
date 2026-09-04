// ── Hotelier Extranet — Paymax Stays service (Booking.com Extranet/Pulse) ─────
// Mock by default (mirrors staysAdminService). Flip with
// NEXT_PUBLIC_STAYS_USE_MOCK=false to hit the live Go backend at
// /api/stays/extranet/*. RBAC: stays.hotelier.* + staff roles.
// MULTI-PROPERTY: a hotelier can own more than one property — the backend is
// built for it (repository.go MyProperties has no LIMIT 1; PRD §21 authorizes
// "Own property/properties"). Every live call below is scoped to whichever
// property is selected via the module-level picker singleton below (see
// "Property picker"), modeled on associationAdminService's org picker. This
// file used to hardcode a single PROPERTY_ID constant that no live call ever
// read, so every live request omitted :propertyId entirely and 404'd.
// Money is BIGINT kobo (minor units) and settled in Naira (NGN).

import { apiRoot } from '@/config/env';
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
  CalendarCell,
  BulkEditPayload,
  Restriction,
  Promotion,
  PromotionType,
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

// apiRoot() strips a trailing /api/v1 (if present) before appending the
// module's absolute path — same fix associationAdminService's adminBase()
// applies. The old `env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/stays/extranet')`
// only matched while apiBaseUrl ended in /api/v1; once it became the
// same-origin proxy path (<origin>/api/admin-proxy, no /api/v1 suffix) the
// regex stopped matching and extranetBase() silently returned the proxy
// origin with NO module prefix at all — every live call 404'd before it ever
// got to the missing-propertyId problem this file otherwise fixes.
function extranetBase(): string {
  return `${apiRoot()}/api/stays/extranet`;
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

// ── Property picker ──────────────────────────────────────────────────────────
// Every live route below except GET /me/properties itself requires :propertyId
// in the path (backend/internal/stays/extranet/handler.go + ari/handler.go —
// every handler resolves the property from the URL, never implicitly). This
// module-level singleton (localStorage-backed, so it survives navigation
// across the ~30 extranet pages) is the selection; useSelectedProperty() /
// <PropertyPicker/> in app/extranet/_ui.tsx are the reactive React wrapper and
// UI, mirroring getSelectedOrgId/setSelectedOrgId/onSelectedOrgChange +
// useSelectedOrg()/<OrgPicker/> in associationAdminService.ts + its _ui.tsx.
const PROPERTY_STORAGE_KEY = 'stays_extranet_selected_property';
let selectedPropertyId: string | null = null;
let propertyHydrated = false;
const propertyListeners = new Set<(id: string | null) => void>();

export function getSelectedPropertyId(): string | null {
  if (!propertyHydrated) {
    propertyHydrated = true;
    if (typeof window !== 'undefined') selectedPropertyId = localStorage.getItem(PROPERTY_STORAGE_KEY);
  }
  return selectedPropertyId;
}
export function setSelectedPropertyId(id: string | null): void {
  selectedPropertyId = id;
  propertyHydrated = true;
  if (typeof window !== 'undefined') {
    if (id) localStorage.setItem(PROPERTY_STORAGE_KEY, id);
    else localStorage.removeItem(PROPERTY_STORAGE_KEY);
  }
  propertyListeners.forEach((fn) => fn(id));
}
export function onSelectedPropertyChange(fn: (id: string | null) => void): () => void {
  propertyListeners.add(fn);
  return () => propertyListeners.delete(fn);
}
/** Every live-mode function below calls this instead of taking a propertyId param directly. */
function requirePropertyId(): string {
  const id = getSelectedPropertyId();
  if (!id) throw new Error('No property selected. Choose a property from the picker at the top of the page.');
  return id;
}

/** One row of GET /me/properties (repository.go MyProperties — a plain untyped map, not a Go struct). */
export interface MyPropertyOption {
  id: string;
  name: string;
  city: string;
  status: string;
  /** The caller's grant role on this property, e.g. 'OWNER' — UPPERCASE (stays_hotelier_profile.role), unlike StaffMember.role which is lowercase. */
  role: string;
}
/** GET /me/properties — every property the signed-in hotelier holds an ACTIVE grant on. */
export async function listMyProperties(): Promise<MyPropertyOption[]> {
  if (USE_MOCK) { await delay(); return [{ id: PROPERTY_ID, name: PROFILE.name, city: PROFILE.city, status: PROFILE.status, role: 'OWNER' }]; }
  return getJson<MyPropertyOption[]>('/me/properties');
}

/**
 * A control with no backend route anywhere in backend/internal/stays. Thrown
 * instead of faking success (the docs/audit/ADMIN_SIMULATED_WRITES.md defect)
 * or letting the call 404 with no explanation. Fixing this needs either a new
 * Go endpoint or a product decision to remove the control.
 */
function notOnBackend(what: string): never {
  throw new Error(`${what} is unavailable: no backend endpoint exists for this yet.`);
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
// DEMO PROPERTY (object-scoped to one Nigerian hotel) — MOCK MODE ONLY
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
// Live-mode response/request adapters — the Go structs below (repository.go /
// ari/model.go / reviews/model.go) are narrower than the TS types above (no
// `name` on a rate plan, no guest contact fields on a reservation, no photos/
// amenities/loyalty model at all, etc). Fields the backend does not track are
// filled with a documented neutral default rather than invented data.
// ════════════════════════════════════════════════════════════════════════════

interface GoProperty { id: string; name: string; description: string; address: string; city: string; star_rating: number; property_type: string; status: string; updated_at: string }
function propertyFromGo(g: GoProperty): PropertyProfile {
  return {
    property_id: g.id,
    name: g.name ?? '',
    type: (g.property_type as PropertyProfile['type']) || 'hotel',
    star_rating: g.star_rating ?? 0,
    description: g.description ?? '',
    short_tagline: '', // not tracked by stays_property
    address_line: g.address ?? '',
    city: g.city ?? '',
    state: '', // not tracked
    country: 'Nigeria', // Stays is Nigeria-only today
    geo: { lat: 0, lng: 0 }, // not tracked
    check_in_from: '', // not tracked
    check_out_until: '', // not tracked
    contact_phone: '', // not tracked
    contact_email: '', // not tracked
    currency: 'NGN',
    status: (g.status as PropertyProfile['status']) || 'draft',
  };
}

interface GoRoomType { id: string; name: string; occupancy: number; bedding: string; size_sqm: number }
function roomTypeFromGo(g: GoRoomType): RoomType {
  return {
    id: g.id,
    name: g.name ?? '',
    max_occupancy: g.occupancy ?? 2,
    beds: g.bedding ?? '',
    size_sqm: g.size_sqm ?? 0,
    count: 0, // physical room count isn't a stays_room_type column — tracked per-day via availability allotment instead
    smoking: false, // not tracked
    status: 'active', // not tracked (no status column on stays_room_type)
  };
}

interface GoRatePlan { id: string; room_type_id: string; rate_plan_type: string; board: string; refundable: boolean; base_sell_rate_kobo: number; currency: string }
function ratePlanFromGo(g: GoRatePlan): RatePlan {
  return {
    id: g.id,
    room_type_id: g.room_type_id,
    // stays_rate_plan has no display name — synthesize one from what it does store.
    name: `${g.rate_plan_type || 'BAR'} · ${g.board || 'room_only'}`.replace(/_/g, ' '),
    board: (g.board as RatePlan['board']) || 'room_only',
    refundable: g.refundable ?? true,
    cancellation_window_hours: 0, // not tracked
    mobile_rate: false, // not tracked
    derived_from: null, // not tracked as a plan-to-plan link (see ApplyDerivedRate, which is a one-off calendar op, not a stored link)
    derived_adjustment_pct: null,
    loyalty_opt_in: false, // not tracked — see getLoyaltyOptIn()
    base_rate_kobo: g.base_sell_rate_kobo ?? 0,
    currency: (g.currency as RatePlan['currency']) || 'NGN',
    status: 'active', // not tracked
  };
}

interface GoReservationRow { id: string; state: string; check_in: string; check_out: string; rooms: number; gross_amount_kobo: number; currency: string; supplier_ref: string | null; guest_name: string; created_at: string }
function nightsBetween(from: string, to: string): number {
  const n = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
  return n > 0 ? n : 0;
}
function reservationSummaryFromGo(g: GoReservationRow): ReservationSummary {
  return {
    id: g.id,
    ref: g.supplier_ref || g.id, // stays_reservation has no separate human-facing ref column
    guest_name: g.guest_name || '',
    room_type_name: '', // ReservationRow doesn't carry room_type_id, let alone a joined name
    rate_plan_name: '',
    check_in: g.check_in,
    check_out: g.check_out,
    nights: nightsBetween(g.check_in, g.check_out),
    guests: g.rooms ?? 0, // no separate guest-count column; `rooms` is the closest tracked quantity
    status: (g.state || '').toLowerCase() as ReservationSummary['status'],
    payment_status: 'paid', // not tracked by stays_reservation — Go has no payment-status model on this row
    total_kobo: g.gross_amount_kobo ?? 0,
    currency: (g.currency as ReservationSummary['currency']) || 'NGN',
    channel: 'paymax_app', // not tracked
    created_at: g.created_at,
  };
}
interface GoReservationDetail extends GoReservationRow { property_id: string; room_type_id: string; rate_plan_id: string; net_rate_kobo: number; commission_kobo: number; occupancy: Record<string, unknown> }
function reservationDetailFromGo(g: GoReservationDetail): ReservationDetail {
  return {
    ...reservationSummaryFromGo(g),
    guest_email: '', // not tracked on stays_reservation (guest contact lives on stays_reservation_guest, not selected by this query)
    guest_phone: '',
    guest_country: '',
    special_requests: null,
    board: 'room_only',
    deposit_kobo: 0,
    balance_due_kobo: Math.max(0, (g.gross_amount_kobo ?? 0) - (g.net_rate_kobo ?? 0)),
    commission_kobo: g.commission_kobo ?? 0,
    net_to_hotel_kobo: g.net_rate_kobo ?? 0,
    loyalty_member: false, // not tracked
    timeline: [], // no event-log model on this endpoint
  };
}

interface GoPayout { id: string; amount_kobo: number; currency: string; status: string; hold_reason: string; created_at: string }
function payoutFromGo(g: GoPayout): Payout {
  return {
    id: g.id,
    period: g.created_at.slice(0, 10), // stays_hotel_payout has no period range, only a single created_at
    gross_kobo: g.amount_kobo ?? 0,
    commission_kobo: 0, // not broken out on this row — commission lives in the separate /commission ledger
    net_kobo: g.amount_kobo ?? 0,
    currency: (g.currency as Payout['currency']) || 'NGN',
    status: (g.status || '').toLowerCase() as Payout['status'],
    paid_at: (g.status || '').toUpperCase() === 'PAID' ? g.created_at : null,
    reference: g.hold_reason || null,
  };
}

interface GoStaffRow { id: string; user_id: string; role: string; status: string }
function staffFromGo(g: GoStaffRow): StaffMember {
  return {
    id: g.id,
    name: g.user_id, // stays_hotelier_profile has no display name/email — only the platform user_id
    email: '',
    role: (g.role || '').toLowerCase() as StaffMember['role'],
    status: (g.status || '').toLowerCase() as StaffMember['status'],
    last_active: null, // not tracked
  };
}

interface GoReview { id: string; reservation_id: string; property_id: string; guest_user_id: string; overall_score: number; title: string; body: string; status: string; created_at: string }
function reviewFromGo(g: GoReview): Review {
  const statusMap: Record<string, Review['status']> = { PUBLISHED: 'published', PENDING: 'pending', FLAGGED: 'flagged', HIDDEN: 'flagged' };
  return {
    id: g.id,
    guest_name: '', // stays_review stores guest_user_id, not a display name
    reservation_ref: g.reservation_id,
    rating: g.overall_score ?? 0,
    title: g.title ?? '',
    body: g.body ?? '',
    created_at: g.created_at,
    response: null, // ListForHotelier doesn't join the separate Response row
    responded_at: null,
    status: statusMap[(g.status || '').toUpperCase()] ?? 'pending',
  };
}

interface GoPromotion { id: string; property_id: string; rate_plan_id: string | null; name: string; promo_type: string; discount_bps: number; discount_kobo: number; min_los: number; lead_days: number; date_from: string; date_to: string; active: boolean; created_at: string }
function promotionFromGo(g: GoPromotion): Promotion {
  const typeMap: Record<string, PromotionType> = { EARLY_BIRD: 'early_bird', LAST_MINUTE: 'last_minute', LOS: 'los' };
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: g.id,
    name: g.name ?? '',
    type: typeMap[g.promo_type] ?? 'early_bird', // Go also allows PERCENT/FIXED, which have no frontend PromotionType equivalent
    discount_pct: (g.discount_bps ?? 0) / 10_000,
    date_from: g.date_from,
    date_to: g.date_to,
    min_los: g.min_los || null,
    advance_days: g.lead_days || null,
    last_minute_hours: null, // not tracked separately from lead_days
    // Go's rate_plan_id is a single nullable id (null = ALL plans); the frontend
    // models a list. null becomes [] here, which reads as "no plans" rather
    // than the backend's actual "every plan" meaning — a real gap, not a typo.
    applies_to_rate_plans: g.rate_plan_id ? [g.rate_plan_id] : [],
    status: g.active ? 'active' : (g.date_from > today ? 'scheduled' : 'ended'),
    redemptions: 0, // not tracked by this endpoint
  };
}
function promotionToGoBody(p: Partial<Promotion>): { rate_plan_id?: string | null; name: string; promo_type: string; discount_bps: number; min_los: number; lead_days: number; date_from: string; date_to: string; active: boolean } {
  const typeMap: Partial<Record<PromotionType, string>> = { early_bird: 'EARLY_BIRD', last_minute: 'LAST_MINUTE', los: 'LOS' };
  const goType = p.type ? typeMap[p.type] : undefined;
  if (!goType) throw new Error(`Promotion type "${p.type}" has no backend equivalent (Go promo_type is PERCENT | FIXED | EARLY_BIRD | LAST_MINUTE | LOS — there is no MOBILE type).`);
  return {
    rate_plan_id: p.applies_to_rate_plans?.[0] ?? null,
    name: p.name ?? '',
    promo_type: goType,
    discount_bps: Math.round((p.discount_pct ?? 0) * 10_000),
    min_los: p.min_los ?? 0,
    lead_days: p.advance_days ?? 0,
    date_from: p.date_from ?? dateStr(0),
    date_to: p.date_to ?? dateAhead(30),
    active: p.status === 'active',
  };
}

interface GoRateDay { rate_plan_id: string; date: string; price_kobo: number; currency: string; min_los: number; max_los: number; cta: boolean; ctd: boolean; stop_sell: boolean }
interface GoAvailabilityDay { room_type_id: string; date: string; allotment: number; sold: number; stop_sell: boolean }

// ════════════════════════════════════════════════════════════════════════════
// Public API — mock-backed with live fallthrough
// ════════════════════════════════════════════════════════════════════════════

// A · Onboarding & verification
export async function getVerificationStatus(): Promise<VerificationStatus> {
  if (USE_MOCK) { await delay(); return VERIFICATION; }
  // No KYC/verification-checklist model exists anywhere in backend/internal/stays —
  // CreateProperty + UpdateContent exist, but there is no submitted/reviewed/
  // checklist state machine to read back.
  return notOnBackend('Verification status');
}
export async function getBusinessVerification(): Promise<BusinessVerification> {
  if (USE_MOCK) { await delay(); return BUSINESS_VERIFICATION; }
  return notOnBackend('Business verification');
}
export async function submitForReview(): Promise<VerificationStatus> {
  if (USE_MOCK) { await delay(); return { ...VERIFICATION, overall: 'submitted', submitted_for_review_at: new Date().toISOString() }; }
  return notOnBackend('Submitting a property for review');
}

// B · Content & inventory
export async function getProperty(): Promise<PropertyProfile> {
  if (USE_MOCK) { await delay(); return PROFILE; }
  return propertyFromGo(await getJson<GoProperty>(`/properties/${requirePropertyId()}`));
}
export async function updateContent(patch: Partial<PropertyProfile>): Promise<PropertyProfile> {
  if (USE_MOCK) { await delay(); return { ...PROFILE, ...patch }; }
  const pid = requirePropertyId();
  const body = {
    name: patch.name,
    description: patch.description,
    address: patch.address_line,
    city: patch.city,
    star_rating: patch.star_rating,
    property_type: patch.type,
  };
  await sendJson('PATCH', `/properties/${pid}`, body);
  return propertyFromGo(await getJson<GoProperty>(`/properties/${pid}`));
}
export async function getPhotos(): Promise<PhotoAsset[]> {
  if (USE_MOCK) { await delay(); return PHOTOS; }
  return notOnBackend('Property photos');
}
export async function getAmenities(): Promise<AmenityGroup[]> {
  if (USE_MOCK) { await delay(); return AMENITIES; }
  return notOnBackend('Amenities');
}
export async function updateAmenities(groups: AmenityGroup[]): Promise<AmenityGroup[]> {
  if (USE_MOCK) { await delay(); return groups; }
  return notOnBackend('Updating amenities');
}
export async function listRoomTypes(): Promise<RoomType[]> {
  if (USE_MOCK) { await delay(); return ROOM_TYPES; }
  const rows = await getJson<GoRoomType[]>(`/properties/${requirePropertyId()}/room-types`);
  return rows.map(roomTypeFromGo);
}
export async function upsertRoomType(rt: Partial<RoomType>): Promise<RoomType> {
  if (USE_MOCK) { await delay(); return { id: rt.id ?? `rt_${Date.now()}`, name: rt.name ?? 'New room type', max_occupancy: rt.max_occupancy ?? 2, beds: rt.beds ?? '1 Queen', size_sqm: rt.size_sqm ?? 24, count: rt.count ?? 1, smoking: rt.smoking ?? false, status: rt.status ?? 'active' }; }
  if (rt.id) return notOnBackend('Updating a room type (only creation has a backend route)');
  const pid = requirePropertyId();
  const { id } = await sendJson<{ id: string }>('POST', `/properties/${pid}/room-types`, { name: rt.name, occupancy: rt.max_occupancy, bedding: rt.beds });
  const rows = await getJson<GoRoomType[]>(`/properties/${pid}/room-types`);
  const created = rows.find((r) => r.id === id);
  return created ? roomTypeFromGo(created) : { ...rt, id } as RoomType;
}
export async function listRatePlans(): Promise<RatePlan[]> {
  if (USE_MOCK) { await delay(); return RATE_PLANS; }
  const rows = await getJson<GoRatePlan[]>(`/properties/${requirePropertyId()}/rate-plans`);
  return rows.map(ratePlanFromGo);
}
export async function upsertRatePlan(rp: Partial<RatePlan>): Promise<RatePlan> {
  if (USE_MOCK) { await delay(); return { id: rp.id ?? `rp_${Date.now()}`, room_type_id: rp.room_type_id ?? 'rt_std', name: rp.name ?? 'New rate plan', board: rp.board ?? 'room_only', refundable: rp.refundable ?? true, cancellation_window_hours: rp.cancellation_window_hours ?? 24, mobile_rate: rp.mobile_rate ?? false, derived_from: rp.derived_from ?? null, derived_adjustment_pct: rp.derived_adjustment_pct ?? null, loyalty_opt_in: rp.loyalty_opt_in ?? false, base_rate_kobo: rp.base_rate_kobo ?? 90_000_00, currency: rp.currency ?? 'NGN', status: rp.status ?? 'active' }; }
  if (rp.id) return notOnBackend('Updating a rate plan (only creation has a backend route)');
  const pid = requirePropertyId();
  const { id } = await sendJson<{ id: string }>('POST', `/properties/${pid}/rate-plans`, {
    room_type_id: rp.room_type_id,
    rate_plan_type: rp.derived_from ? 'DERIVED' : 'BAR',
    board: rp.board,
    refundable: rp.refundable,
    base_sell_rate_kobo: rp.base_rate_kobo,
    currency: rp.currency ?? 'NGN',
  });
  const rows = await getJson<GoRatePlan[]>(`/properties/${pid}/rate-plans`);
  const created = rows.find((r) => r.id === id);
  return created ? ratePlanFromGo(created) : { ...rp, id } as RatePlan;
}
export async function getCalendar(month: string): Promise<CalendarData> {
  if (USE_MOCK) { await delay(); return buildCalendar(month); }
  const pid = requirePropertyId();
  const from = `${month}-01`;
  const to = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);
  const [roomTypes, ratePlans] = await Promise.all([listRoomTypes(), listRatePlans()]);
  const rows = await Promise.all(roomTypes.map(async (rt): Promise<{ room_type_id: string; room_type_name: string; cells: CalendarCell[] }> => {
    // A room type can have several rate plans; the calendar grid shows one price
    // per cell, so (as in mock mode's buildCalendar) this uses the first plan.
    const plan = ratePlans.find((p) => p.room_type_id === rt.id);
    const [rateDays, availDays] = await Promise.all([
      plan ? getJson<GoRateDay[]>(`/rate-plans/${plan.id}/calendar?from=${from}&to=${to}`) : Promise.resolve<GoRateDay[]>([]),
      getJson<GoAvailabilityDay[]>(`/room-types/${rt.id}/availability?from=${from}&to=${to}`),
    ]);
    const rateByDate = new Map(rateDays.map((d) => [d.date, d]));
    const cells: CalendarCell[] = availDays.map((a) => {
      const r = rateByDate.get(a.date);
      return {
        date: a.date,
        available: Math.max(0, (a.allotment ?? 0) - (a.sold ?? 0)),
        rate_kobo: r?.price_kobo ?? 0,
        min_los: r?.min_los ?? 1,
        cta: r?.cta ?? false,
        ctd: r?.ctd ?? false,
        stop_sell: a.stop_sell || (r?.stop_sell ?? false),
      };
    });
    return { room_type_id: rt.id, room_type_name: rt.name, cells };
  }));
  return { property_id: pid, month, currency: 'NGN', rows };
}
export async function bulkEditCalendar(payload: BulkEditPayload): Promise<{ updated_cells: number }> {
  if (USE_MOCK) {
    await delay();
    const [yf, mf, df] = payload.date_from.split('-').map(Number);
    const [yt, mt, dt] = payload.date_to.split('-').map(Number);
    const days = Math.max(1, Math.round((Date.UTC(yt, mt - 1, dt) - Date.UTC(yf, mf - 1, df)) / 86_400_000) + 1);
    return { updated_cells: days * payload.room_type_ids.length };
  }
  const ratePlans = await listRatePlans();
  const hasRateFields = payload.rate_kobo !== undefined || payload.min_los !== undefined || payload.cta !== undefined || payload.ctd !== undefined;
  const hasAvailFields = payload.available !== undefined || payload.stop_sell !== undefined;
  let updated = 0;
  await Promise.all(payload.room_type_ids.map(async (roomTypeId) => {
    if (hasAvailFields) {
      const r = await sendJson<{ updated: number }>('POST', `/room-types/${roomTypeId}/availability/bulk`, {
        date_from: payload.date_from,
        date_to: payload.date_to,
        allotment: payload.available,
        stop_sell: payload.stop_sell,
      });
      updated += r.updated ?? 0;
    }
    if (hasRateFields) {
      const plan = ratePlans.find((p) => p.room_type_id === roomTypeId);
      if (!plan) return; // no rate plan on this room type — nothing to price
      const r = await sendJson<{ updated: number }>('POST', `/rate-plans/${plan.id}/calendar/bulk`, {
        date_from: payload.date_from,
        date_to: payload.date_to,
        price_kobo: payload.rate_kobo,
        min_los: payload.min_los,
        cta: payload.cta,
        ctd: payload.ctd,
        stop_sell: payload.stop_sell,
      });
      updated += r.updated ?? 0;
    }
  }));
  return { updated_cells: updated };
}
export async function getRestrictions(): Promise<Restriction[]> {
  if (USE_MOCK) { await delay(); return RESTRICTIONS; }
  // There is no "current default restriction" endpoint — SetRestrictions only
  // writes a date-range edit. This reads TODAY's rate-calendar cell per room
  // type's first rate plan as a stand-in snapshot.
  const [roomTypes, ratePlans] = await Promise.all([listRoomTypes(), listRatePlans()]);
  const today = new Date().toISOString().slice(0, 10);
  return Promise.all(roomTypes.map(async (rt): Promise<Restriction> => {
    const plan = ratePlans.find((p) => p.room_type_id === rt.id);
    if (!plan) return { room_type_id: rt.id, room_type_name: rt.name, min_los: 1, max_los: 0, cta: false, ctd: false, stop_sell: false };
    const days = await getJson<GoRateDay[]>(`/rate-plans/${plan.id}/calendar?from=${today}&to=${today}`);
    const d = days[0];
    return { room_type_id: rt.id, room_type_name: rt.name, min_los: d?.min_los ?? 1, max_los: d?.max_los ?? 0, cta: d?.cta ?? false, ctd: d?.ctd ?? false, stop_sell: d?.stop_sell ?? false };
  }));
}
export async function updateRestrictions(rows: Restriction[]): Promise<Restriction[]> {
  if (USE_MOCK) { await delay(); return rows; }
  const ratePlans = await listRatePlans();
  const dateFrom = new Date().toISOString().slice(0, 10);
  const dateTo = dateAhead(365);
  await Promise.all(rows.map(async (row) => {
    const plan = ratePlans.find((p) => p.room_type_id === row.room_type_id);
    if (!plan) return; // no rate plan on this room type — nothing to restrict
    // SetRestrictions is a date-range write, not a persistent per-room-type
    // default; applying it forward from today for a year is this console's
    // best approximation of "set the standing restriction".
    await sendJson('POST', `/rate-plans/${plan.id}/restrictions`, {
      date_from: dateFrom,
      date_to: dateTo,
      min_los: row.min_los,
      max_los: row.max_los || undefined,
      cta: row.cta,
      ctd: row.ctd,
      stop_sell: row.stop_sell,
    });
  }));
  return rows;
}

// C · Promotions & visibility
export async function listPromotions(): Promise<Promotion[]> {
  if (USE_MOCK) { await delay(); return PROMOTIONS; }
  const rows = await getJson<GoPromotion[]>(`/properties/${requirePropertyId()}/promotions`);
  return rows.map(promotionFromGo);
}
export async function upsertPromotion(p: Partial<Promotion>): Promise<Promotion> {
  if (USE_MOCK) { await delay(); return { id: p.id ?? `promo_${Date.now()}`, name: p.name ?? 'New promotion', type: p.type ?? 'early_bird', discount_pct: p.discount_pct ?? 0.1, date_from: p.date_from ?? dateStr(0), date_to: p.date_to ?? dateAhead(30), min_los: p.min_los ?? null, advance_days: p.advance_days ?? null, last_minute_hours: p.last_minute_hours ?? null, applies_to_rate_plans: p.applies_to_rate_plans ?? [], status: p.status ?? 'scheduled', redemptions: p.redemptions ?? 0 }; }
  if (p.id) return notOnBackend('Updating a promotion (only creation and the active/inactive toggle have backend routes)');
  const pid = requirePropertyId();
  const { id } = await sendJson<{ id: string }>('POST', `/properties/${pid}/promotions`, promotionToGoBody(p));
  const rows = await getJson<GoPromotion[]>(`/properties/${pid}/promotions`);
  const created = rows.find((r) => r.id === id);
  return created ? promotionFromGo(created) : { ...p, id } as Promotion;
}
export async function getLoyaltyOptIn(): Promise<LoyaltyOptIn> {
  if (USE_MOCK) { await delay(); return LOYALTY; }
  return notOnBackend('Loyalty opt-in');
}
export async function updateLoyaltyOptIn(ratePlanId: string, optedIn: boolean): Promise<LoyaltyOptIn> {
  if (USE_MOCK) { await delay(); return { ...LOYALTY, enrolled_rate_plans: LOYALTY.enrolled_rate_plans.map((r) => r.rate_plan_id === ratePlanId ? { ...r, opted_in: optedIn, earn_rate_pct: optedIn ? 0.05 : 0 } : r) }; }
  return notOnBackend('Updating loyalty opt-in');
}
export async function getVisibilityBooster(): Promise<VisibilityBooster> {
  if (USE_MOCK) { await delay(); return VISIBILITY; }
  return notOnBackend('Visibility Booster (Phase 3 feature)');
}
export async function listOpportunities(): Promise<Opportunity[]> {
  if (USE_MOCK) { await delay(); return OPPORTUNITIES; }
  return notOnBackend('Opportunities / insights feed');
}

// D · Reservations & guests
export async function listReservations(): Promise<ReservationSummary[]> {
  if (USE_MOCK) { await delay(); return RESERVATIONS.map(({ guest_email, guest_phone, guest_country, special_requests, board, deposit_kobo, balance_due_kobo, commission_kobo, net_to_hotel_kobo, loyalty_member, timeline, ...s }) => s); }
  const rows = await getJson<GoReservationRow[]>(`/properties/${requirePropertyId()}/reservations`);
  return rows.map(reservationSummaryFromGo);
}
export async function getReservation(id: string): Promise<ReservationDetail | null> {
  if (USE_MOCK) { await delay(); return RESERVATIONS.find((r) => r.id === id) ?? null; }
  const row = await getJson<GoReservationDetail>(`/properties/${requirePropertyId()}/reservations/${id}`);
  return reservationDetailFromGo(row);
}
export async function modifyReservation(payload: ModifyReservationPayload): Promise<ManualActionResult> {
  if (USE_MOCK) {
    await delay();
    const map: Record<string, ManualActionResult['status']> = { cancel: 'cancelled_by_hotel', mark_no_show: 'no_show', modify_dates: 'confirmed', modify_room: 'confirmed' };
    return { reservation_id: payload.reservation_id, status: map[payload.action] ?? 'confirmed', message: `Reservation ${payload.action.replace(/_/g, ' ')} applied.` };
  }
  const pid = requirePropertyId();
  switch (payload.action) {
    case 'mark_no_show':
      await sendJson('POST', `/properties/${pid}/reservations/${payload.reservation_id}/no-show`, {});
      return { reservation_id: payload.reservation_id, status: 'no_show', message: 'Reservation marked no-show.' };
    case 'cancel':
      await sendJson('POST', `/properties/${pid}/reservations/${payload.reservation_id}/cancel`, { reason: payload.reason });
      return { reservation_id: payload.reservation_id, status: 'cancelled_by_hotel', message: 'Reservation cancelled.' };
    case 'modify_dates':
    case 'modify_room':
      // No backend route exists for changing dates/room on an existing
      // reservation — only no-show and cancel are implemented.
      return notOnBackend(`Reservation "${payload.action}"`);
    default:
      return notOnBackend(`Reservation action "${payload.action}"`);
  }
}
export async function markNoShow(reservationId: string, reason?: string): Promise<ManualActionResult> {
  return modifyReservation({ reservation_id: reservationId, action: 'mark_no_show', reason });
}
export async function listMessages(): Promise<GuestMessage[]> {
  if (USE_MOCK) { await delay(); return MESSAGES; }
  // The backend only exposes a per-reservation thread (GET
  // .../reservations/:id/messages) — there is no cross-reservation inbox
  // endpoint to list against, and fanning this out over every reservation
  // client-side would be an unbounded N+1 rather than a real inbox feature.
  return notOnBackend('A cross-reservation message inbox');
}
export async function listReviews(): Promise<Review[]> {
  if (USE_MOCK) { await delay(); return REVIEWS; }
  const rows = await getJson<GoReview[]>(`/properties/${requirePropertyId()}/reviews`);
  return rows.map(reviewFromGo);
}
export async function respondReview(reviewId: string, response: string): Promise<Review> {
  if (USE_MOCK) { await delay(); const r = REVIEWS.find((x) => x.id === reviewId)!; return { ...r, response, responded_at: new Date().toISOString() }; }
  // POST /reviews/:reviewId/response only returns {id}, not the updated review
  // (there is no single-review GET to refetch from either) — the caller's own
  // input is all we can honestly report back.
  await sendJson('POST', `/reviews/${reviewId}/response`, { body: response });
  return { id: reviewId, guest_name: '', reservation_ref: '', rating: 0, title: '', body: '', created_at: new Date().toISOString(), response, responded_at: new Date().toISOString(), status: 'published' };
}

// E · Finance
export async function getPayouts(): Promise<Payout[]> {
  if (USE_MOCK) { await delay(); return PAYOUTS; }
  const rows = await getJson<GoPayout[]>(`/properties/${requirePropertyId()}/payouts`);
  return rows.map(payoutFromGo);
}
export async function getInvoices(): Promise<Invoice[]> {
  if (USE_MOCK) { await delay(); return INVOICES; }
  return notOnBackend('Invoices');
}
export async function getCommission(): Promise<CommissionOverview> {
  if (USE_MOCK) { await delay(); return COMMISSION; }
  // /commission returns a raw, unwindowed ledger list, not a computed 30-day
  // summary — this sums what the endpoint returns rather than a true 30d window.
  const rows = await getJson<{ amount_kobo: number }[]>(`/properties/${requirePropertyId()}/commission`);
  const commission = rows.reduce((s, r) => s + (r.amount_kobo ?? 0), 0);
  return { rate_pct: 0, gmv_30d_kobo: 0, commission_30d_kobo: commission, net_30d_kobo: 0, currency: 'NGN', by_rate_plan: [] };
}
export async function getDepositRecon(): Promise<DepositReconRow[]> {
  if (USE_MOCK) { await delay(); return DEPOSIT_RECON; }
  return notOnBackend('Deposit reconciliation');
}
export async function getBankSettings(): Promise<BankSettings> {
  if (USE_MOCK) { await delay(); return BANK_SETTINGS; }
  return notOnBackend('Bank settings');
}
export async function updateBankSettings(patch: Partial<BankSettings>): Promise<BankSettings> {
  if (USE_MOCK) { await delay(); return { ...BANK_SETTINGS, ...patch }; }
  return notOnBackend('Updating bank settings');
}

// F · Analytics
export async function getPerformance(): Promise<PerformanceAnalytics> {
  if (USE_MOCK) { await delay(); return PERFORMANCE; }
  const to = new Date().toISOString().slice(0, 10);
  const from = dateStr(30); // last 30 days
  const a = await getJson<{ occupancy_pct: number; revenue_kobo: number; adr_kobo: number; revpar_kobo: number }>(
    `/properties/${requirePropertyId()}/analytics?from=${from}&to=${to}`,
  );
  return {
    currency: 'NGN',
    occupancy_pct: (a.occupancy_pct ?? 0) / 100, // Go returns 0..100, this type is 0..1
    adr_kobo: a.adr_kobo ?? 0,
    revpar_kobo: a.revpar_kobo ?? 0,
    total_revenue_30d_kobo: a.revenue_kobo ?? 0,
    trend: [], // the endpoint returns one aggregate over the window, no daily series
  };
}
export async function getConversion(): Promise<ConversionFunnel> {
  if (USE_MOCK) { await delay(); return CONVERSION; }
  return notOnBackend('Conversion funnel analytics');
}
export async function getBookerInsights(): Promise<BookerInsights> {
  if (USE_MOCK) { await delay(); return BOOKERS; }
  return notOnBackend('Booker insights analytics');
}
export async function getMarketContext(): Promise<MarketContext> {
  if (USE_MOCK) { await delay(); return MARKET; }
  return notOnBackend('Market / competitive-set analytics');
}
// Convenience aggregate (mirrors staysAdminService getAnalytics naming).
export async function getAnalytics(): Promise<{ performance: PerformanceAnalytics; conversion: ConversionFunnel; bookers: BookerInsights; market: MarketContext }> {
  const [performance, conversion, bookers, market] = await Promise.all([getPerformance(), getConversion(), getBookerInsights(), getMarketContext()]);
  return { performance, conversion, bookers, market };
}

// G · Account & staff
export async function listStaff(): Promise<StaffMember[]> {
  if (USE_MOCK) { await delay(); return STAFF; }
  const rows = await getJson<GoStaffRow[]>(`/properties/${requirePropertyId()}/staff`);
  return rows.map(staffFromGo);
}
export async function inviteStaff(name: string, email: string, role: StaffMember['role']): Promise<StaffMember> {
  if (USE_MOCK) { await delay(); return { id: `st_${Date.now()}`, name, email, role, status: 'invited', last_active: null }; }
  // UpsertStaff (POST .../staff) grants a role to an EXISTING platform user_id —
  // it has no email-invite path (no lookup-by-email, no invite-token flow). Name
  // and email are the console's only inputs here, so this would either need a
  // new invite-by-email endpoint or a UI change to collect a user_id instead.
  return notOnBackend('Inviting staff by name/email (the backend grants roles by user_id, not by email invite)');
}
export async function getSettings(): Promise<ExtranetSettings> {
  if (USE_MOCK) { await delay(); return SETTINGS; }
  return notOnBackend('Extranet notification/channel settings');
}
export async function updateSettings(patch: Partial<ExtranetSettings>): Promise<ExtranetSettings> {
  if (USE_MOCK) { await delay(); return { ...SETTINGS, ...patch }; }
  return notOnBackend('Updating extranet settings');
}
