import { api } from '@/api/client';
import { getErrorMessage } from '@/utils/errorMapper';
import { USE_MOCK, API_BASE, EVENTS_COMMERCE_ENABLED } from './constants/events.constants';
import { checkFollowingPage } from './social';
import { createEventBody } from './createBody';
import type {
  Event,
  EventQuery,
  EventSummary,
  EventDetail,
  TicketTier,
  AddTierInput,
  Ticket,
  EventWallet,
  EventWalletEntry,
  EventVendorDisplay,
  VenueZone,
  CreateEventInput,
  PurchaseTicketInput,
  PurchaseResult,
  GiftTicketInput,
  OrganiserEventStats,
  Attendee,
  ScanResult,
  TopUpSource,
  GateToken,
  Gate,
  EventPatch,
  TierPatch,
  PromoPatch,
  CreatePromoInput,
  PromoCode,
  TeamMember,
  AddTeamMemberInput,
  IssueCompInput,
  AnnounceInput,
  AnnounceResult,
  LikeState,
  FollowState,
  OrganiserProfile,
  OrganiserPatch,
  BannerPresign,
  QuoteArgs,
  Quote,
  Order,
  Booking,
  Refund,
  EventNotification,
  NotificationPage,
  SupportCase,
  SupportMessage,
  OpenCaseInput,
  ModerationDecision,
  RosterRow,
  RosterFilter,
  CheckinStats,
  CheckinEntry,
} from './types';

// Organiser lifecycle writes have a live endpoint and nothing a fixture could
// honestly add, so fixture mode refuses loudly instead of reporting a write it
// did not perform (same pattern as the association module, election #698).
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_EVENT_USE_MOCK=false to send this against the live backend.`);

// User-facing text for a failed lifecycle write. The fixture-mode refusal above
// is a developer string; users get a plain message instead of the env-var hint.
export function lifecycleErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.includes('unavailable in fixture mode')) {
    return 'This action isn\'t available right now. Please try again later.';
  }
  return getErrorMessage(err);
}

// Commerce failures carry a full sentence in the response body (the Go sentinels
// read "events: the refund window for this event has closed"). The package prefix
// is an internal detail, so it is dropped before the text reaches a customer.
export function commerceErrorMessage(err: unknown): string {
  return lifecycleErrorMessage(err).replace(/^events:\s*/, '');
}

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Unwrap the Go-backend envelope ({ data: ... }).
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Backend list endpoints return the array under a named key, e.g.
// { success: true, events: [...] } or { success: true, tickets: [...] }.
// pickList digs the array out whatever the envelope shape, and ALWAYS returns an
// array so callers can safely .map/.filter (never crashes on an object body).
function pickList<T>(res: { data?: unknown }, key: string): T[] {
  const body = res?.data as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(body)) return body as T[];
  const b = (body ?? {}) as Record<string, unknown>;
  const inner = (b.data ?? {}) as Record<string, unknown>;
  const list = b[key] ?? inner[key] ?? b.data ?? body;
  return Array.isArray(list) ? (list as T[]) : [];
}

// Every money mutation carries an Idempotency-Key (NL-9).
export function idempotencyKey(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const daysAgo     = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const TIERS_FELABRATION: TicketTier[] = [
  { id: 't_reg', event_id: 'e_live', name: 'Regular', price_kobo: 1_500_000, capacity: 1000, sold: 760, active: true },
  { id: 't_vip', event_id: 'e_live', name: 'VIP', price_kobo: 5_000_000, capacity: 200, sold: 168, active: true },
  { id: 't_table', event_id: 'e_live', name: 'Table for 5', price_kobo: 25_000_000, capacity: 20, sold: 16, active: true },
];

const MOCK_EVENTS: EventDetail[] = [
  {
    id: 'e_live', organiser_id: 'u_org1', title: 'Felabration 2026', category: 'music', state: 'LIVE',
    starts_at: hoursFromNow(3), ends_at: hoursFromNow(9), venue: 'New Afrika Shrine, Ikeja, Lagos',
    fee_bps: 500, created_at: daysAgo(60),
    description: 'A week-long celebration of Afrobeat. Live bands, food, and dancing all night.',
    tiers: TIERS_FELABRATION,
    banner_url: null, venue_lat: 6.6018, venue_lng: 3.3515, venue_place_id: null, like_count: 128, liked: false,
    city: 'Lagos', venue_address: 'Wiren Rd, Taewo, GRA, Ikeja', refund_policy: 'Refundable until 24 hours before the start time.',
    refund_cutoff_hours: 24, checkin_opens_minutes: 120, checkin_closes_minutes: 60,
    submitted_at: daysAgo(55), moderation_status: 'APPROVED', moderation_decided_at: daysAgo(50),
  },
  {
    id: 'e_approved', organiser_id: 'u_org2', title: 'Lagos Tech Summit', category: 'tech', state: 'APPROVED',
    starts_at: daysFromNow(14), ends_at: daysFromNow(15), venue: 'Landmark Centre, Victoria Island, Lagos',
    fee_bps: 500, created_at: daysAgo(20),
    description: "Two days of talks, workshops and demos from Africa's leading builders.",
    tiers: [
      { id: 't_free', event_id: 'e_approved', name: 'Free Pass', price_kobo: 0, capacity: 500, sold: 320, active: true },
      { id: 't_pro', event_id: 'e_approved', name: 'Pro Pass', price_kobo: 3_500_000, capacity: 150, sold: 90, active: true },
    ],
    banner_url: null, venue_lat: 6.4281, venue_lng: 3.4219, venue_place_id: null, like_count: 42, liked: false,
    city: 'Lagos', venue_address: '1c Onola Ade Ologun Erd, Victoria Island', refund_policy: 'Refundable until 48 hours before the start time.',
    refund_cutoff_hours: 48, checkin_opens_minutes: 90, checkin_closes_minutes: 30,
    submitted_at: daysAgo(18), moderation_status: 'APPROVED', moderation_decided_at: daysAgo(12),
  },
  {
    id: 'e_closed', organiser_id: 'u_org3', title: 'Detty December Beach Rave', category: 'music', state: 'CLOSED',
    starts_at: daysAgo(20), ends_at: daysAgo(20), venue: 'Landmark Beach, Oniru, Lagos',
    fee_bps: 500, created_at: daysAgo(80),
    description: 'Sun, sand and sound — the closer to the year.',
    tiers: [{ id: 't_ga', event_id: 'e_closed', name: 'General', price_kobo: 2_000_000, capacity: 4000, sold: 4000, active: false }],
    banner_url: null, venue_lat: null, venue_lng: null, venue_place_id: null, like_count: 310, liked: false,
    city: 'Lagos', venue_address: 'Landmark Beach, Oniru', refund_policy: 'Non-refundable once the event has started.',
    refund_cutoff_hours: 0, checkin_opens_minutes: 180, checkin_closes_minutes: 15,
    submitted_at: daysAgo(78), moderation_status: 'APPROVED', moderation_decided_at: daysAgo(70),
  },
  {
    id: 'e_draft', organiser_id: 'u_me', title: 'Abuja Comedy Night', category: 'comedy', state: 'DRAFT',
    starts_at: daysFromNow(30), ends_at: daysFromNow(30), venue: 'Transcorp Hilton, Maitama, Abuja',
    fee_bps: 500, created_at: daysAgo(2),
    description: "A night of stand-up from Nigeria's funniest. (Pending approval.)",
    tiers: [{ id: 't_std', event_id: 'e_draft', name: 'Standard', price_kobo: 1_000_000, capacity: 300, sold: 0, active: true }],
    banner_url: null, venue_lat: null, venue_lng: null, venue_place_id: null, like_count: 0, liked: false,
    city: 'Abuja', venue_address: '1 Transcorp Boulevard, Maitama', refund_policy: 'Refundable until 24 hours before the start time.',
    refund_cutoff_hours: 24, checkin_opens_minutes: 60, checkin_closes_minutes: 30,
    moderation_status: 'NONE',
  },
];

const MOCK_TICKETS: Ticket[] = [
  { id: 'tk_1', event_id: 'e_live', tier_id: 't_vip', order_id: 'ord_1', owner_id: 'u_me', state: 'ISSUED', credential_id: 'cred_9x2k', price_paid_kobo: 5_000_000, created_at: hoursFromNow(-2) },
  { id: 'tk_2', event_id: 'e_closed', tier_id: 't_ga', order_id: 'ord_2', owner_id: 'u_me', state: 'USED', credential_id: 'cred_44ab', price_paid_kobo: 2_000_000, created_at: daysAgo(20) },
  { id: 'tk_3', event_id: 'e_approved', tier_id: 't_pro', order_id: 'ord_3', owner_id: 'u_me', state: 'TRANSFERRED', credential_id: 'cred_77zz', price_paid_kobo: 3_500_000, created_at: daysAgo(10) },
];

const MOCK_VENDORS: EventVendorDisplay[] = [
  { id: 'vn_food', name: 'Iya Basira Jollof', category: 'Food', emoji: '🍛', items: [
    { id: 'i1', name: 'Jollof + Chicken', priceKobo: 350_000 },
    { id: 'i2', name: 'Asun Plate', priceKobo: 450_000 },
    { id: 'i3', name: 'Puff Puff (6)', priceKobo: 100_000 },
  ] },
  { id: 'vn_bar', name: 'The Shrine Bar', category: 'Drinks', emoji: '🍹', items: [
    { id: 'i4', name: 'Chapman', priceKobo: 200_000 },
    { id: 'i5', name: 'Beer', priceKobo: 150_000 },
    { id: 'i6', name: 'Water', priceKobo: 50_000 },
  ] },
  { id: 'vn_merch', name: 'Fela Merch Stand', category: 'Merch', emoji: '👕', items: [
    { id: 'i7', name: 'T-Shirt', priceKobo: 800_000 },
    { id: 'i8', name: 'Cap', priceKobo: 500_000 },
  ] },
];

let MOCK_WALLET: EventWallet = {
  id: 'ew_1', event_id: 'e_live', owner_id: 'u_me', state: 'OPEN', balance_kobo: 1_650_000, created_at: hoursFromNow(-2),
};

let MOCK_WALLET_ENTRIES: EventWalletEntry[] = [
  { id: 'w1', wallet_id: 'ew_1', type: 'TOPUP', amount_kobo: 2_000_000, reference: 'Top-up', idempotency_key: 'seed1', created_at: hoursFromNow(-2) },
  { id: 'w2', wallet_id: 'ew_1', type: 'CHARGE', amount_kobo: 350_000, reference: 'Iya Basira Jollof', idempotency_key: 'seed2', created_at: hoursFromNow(-1.5) },
  { id: 'w3', wallet_id: 'ew_1', type: 'TOPUP', amount_kobo: 1_000_000, reference: 'Top-up', idempotency_key: 'seed3', created_at: hoursFromNow(-1) },
  { id: 'w4', wallet_id: 'ew_1', type: 'CHARGE', amount_kobo: 200_000, reference: 'The Shrine Bar', idempotency_key: 'seed4', created_at: hoursFromNow(-0.8) },
  { id: 'w5', wallet_id: 'ew_1', type: 'CHARGE', amount_kobo: 800_000, reference: 'Fela Merch Stand', idempotency_key: 'seed5', created_at: hoursFromNow(-0.5) },
];

const MOCK_VENUE: VenueZone[] = [
  { id: 'z1', name: 'Main Stage',   type: 'stage',    x: 0.5,  y: 0.18 },
  { id: 'z2', name: 'Entry Gate',   type: 'entry',    x: 0.5,  y: 0.9  },
  { id: 'z3', name: 'Food Court',   type: 'food',     x: 0.22, y: 0.55 },
  { id: 'z4', name: 'Bar',          type: 'vendor',   x: 0.78, y: 0.5  },
  { id: 'z5', name: 'Restrooms',    type: 'restroom', x: 0.15, y: 0.78 },
  { id: 'z6', name: 'Medical Tent', type: 'medical',  x: 0.85, y: 0.78 },
];

const MOCK_ATTENDEES: Attendee[] = [
  { id: 'a1', name: 'Bisi Adeyemi', cashtag: '@bisi',  tier_name: 'VIP',     ticket_id: 'tk_a1', state: 'ISSUED', checked_in: true,  checked_in_at: hoursFromNow(-1) },
  { id: 'a2', name: 'Tunde Okafor', cashtag: '@tunde', tier_name: 'Regular', ticket_id: 'tk_a2', state: 'ISSUED', checked_in: false, checked_in_at: null },
  { id: 'a3', name: 'Chidi Nwosu',  cashtag: '@chidi', tier_name: 'Regular', ticket_id: 'tk_a3', state: 'USED',   checked_in: true,  checked_in_at: hoursFromNow(-2) },
  { id: 'a4', name: 'Ada Eze',      cashtag: '@ada',   tier_name: 'Table for 5', ticket_id: 'tk_a4', state: 'ISSUED', checked_in: false, checked_in_at: null },
];

// ── Commerce fixtures (FEATURE_EVENTS_COMMERCIAL) ────────────────────────────
// Amounts are integer kobo and follow the server's own arithmetic: the platform
// fee is fee_bps of the subtotal truncated toward the buyer (the buyer keeps the
// remainder of the division), and a refund returns the seat minus its share of
// that fee. Orders are DERIVED from the bookings so the two can never disagree
// about what one checkout cost.

const MOCK_BOOKINGS: Booking[] = [
  {
    booking_ref: 'evt-1760000000001-fela', event_id: 'e_live', event_title: 'Felabration 2026',
    venue: 'New Afrika Shrine, Ikeja, Lagos', city: 'Lagos', starts_at: hoursFromNow(3),
    event_state: 'LIVE', status: 'PAID', seats: 2, subtotal_kobo: 10_000_000, discount_kobo: 0,
    total_kobo: 10_000_000, refunded_kobo: 0, platform_fee_kobo: 500_000, organiser_net_kobo: 9_500_000,
    fee_bps: 500, refund_policy: 'Refundable until 24 hours before the start time.',
    created_at: hoursFromNow(-30),
    orders: [
      { id: 'ord_1', event_id: 'e_live', buyer_id: 'u_me', attendee_name: 'Ada Okafor', tier_name: 'VIP', unit_price_kobo: 5_000_000, discount_kobo: 0, total_kobo: 5_000_000, refunded_kobo: 0, status: 'PAID', payment_rail: 'wallet', created_at: hoursFromNow(-30) },
      { id: 'ord_1b', event_id: 'e_live', buyer_id: 'u_me', attendee_name: 'Ada Okafor', tier_name: 'VIP', unit_price_kobo: 5_000_000, discount_kobo: 0, total_kobo: 5_000_000, refunded_kobo: 0, status: 'PAID', payment_rail: 'wallet', created_at: hoursFromNow(-30) },
    ],
  },
  {
    booking_ref: 'evt-1760000000002-rave', event_id: 'e_closed', event_title: 'Detty December Beach Rave',
    venue: 'Landmark Beach, Oniru, Lagos', city: 'Lagos', starts_at: daysAgo(20),
    event_state: 'CLOSED', status: 'PAID', seats: 1, subtotal_kobo: 2_000_000, discount_kobo: 0,
    total_kobo: 2_000_000, refunded_kobo: 0, platform_fee_kobo: 100_000, organiser_net_kobo: 1_900_000,
    fee_bps: 500, refund_policy: 'Non-refundable after the event starts.',
    created_at: daysAgo(21),
    orders: [
      { id: 'ord_2', event_id: 'e_closed', buyer_id: 'u_me', tier_name: 'General', unit_price_kobo: 2_000_000, discount_kobo: 0, total_kobo: 2_000_000, refunded_kobo: 0, status: 'PAID', payment_rail: 'wallet', created_at: daysAgo(21) },
    ],
  },
  {
    booking_ref: 'evt-1760000000003-summit', event_id: 'e_approved', event_title: 'Lagos Tech Summit',
    venue: 'Landmark Centre, Victoria Island, Lagos', city: 'Lagos', starts_at: daysFromNow(14),
    event_state: 'APPROVED', status: 'PAID', seats: 1, subtotal_kobo: 3_500_000, discount_kobo: 350_000,
    total_kobo: 3_150_000, refunded_kobo: 0, platform_fee_kobo: 157_500, organiser_net_kobo: 2_992_500,
    fee_bps: 500, promo_code: 'EARLY10', refund_policy: 'Refundable until 48 hours before the start time.',
    created_at: daysAgo(10),
    orders: [
      { id: 'ord_3', event_id: 'e_approved', buyer_id: 'u_me', tier_name: 'Pro Pass', promo_code: 'EARLY10', unit_price_kobo: 3_500_000, discount_kobo: 350_000, total_kobo: 3_150_000, refunded_kobo: 0, status: 'PAID', payment_rail: 'wallet', created_at: daysAgo(10) },
    ],
  },
];

// One refund in flight: the buyer asked, the organiser has not answered yet.
let MOCK_REFUNDS: Refund[] = [
  {
    id: 'rf_1', event_id: 'e_live', order_id: 'ord_1b', ticket_id: 'tk_1b', buyer_id: 'u_me',
    amount_kobo: 5_000_000, fee_kobo: 250_000, refund_kobo: 4_750_000,
    reason: 'Cannot travel that weekend.', status: 'REQUESTED', created_at: hoursFromNow(-4),
    event_title: 'Felabration 2026', event_state: 'LIVE', tier_name: 'VIP', attendee_name: 'Ada Okafor',
    booking_ref: 'evt-1760000000001-fela',
  },
];

let MOCK_NOTIFICATIONS: EventNotification[] = [
  { id: 'nt_1', kind: 'refund_requested', title: 'Refund request received', body: 'We told the organiser about your request for Felabration 2026. You will get a decision in your inbox.', event_id: 'e_live', order_id: 'ord_1b', refund_id: 'rf_1', created_at: hoursFromNow(-4) },
  { id: 'nt_2', kind: 'support_reply', title: 'Support replied', body: 'Your question about the Lagos Tech Summit promo code has an answer.', event_id: 'e_approved', created_at: daysAgo(1) },
  { id: 'nt_3', kind: 'moderation', title: 'Event approved', body: 'Lagos Tech Summit is on sale.', event_id: 'e_approved', read_at: daysAgo(6), created_at: daysAgo(6) },
];

let MOCK_CASES: SupportCase[] = [
  {
    id: 'sc_1', event_id: 'e_approved', event_title: 'Lagos Tech Summit', order_id: 'ord_3',
    opened_by: 'u_me', kind: 'REFUND', subject: 'Promo code did not apply twice',
    body: 'I used EARLY10 for two seats but only one got the discount.',
    status: 'IN_PROGRESS', priority: 'NORMAL', assigned_to: 'desk_1',
    created_at: daysAgo(2), updated_at: hoursFromNow(-20), reply_count: 1,
    messages: [
      { id: 'sm_1', case_id: 'sc_1', author_id: 'desk_1', author_name: 'Spotlight Support', body: 'Thanks — checking the redemption log for your booking now.', created_at: hoursFromNow(-20) },
    ],
  },
];

// The door roster. Ticket ids match MOCK_TICKETS' event/tier pairing; the seat
// names come from checkout, which is the whole point of capturing them.
const MOCK_ROSTER: RosterRow[] = [
  { id: 'tk_a1', name: 'Bisi Adeyemi', cashtag: '@bisi', tier_name: 'VIP', ticket_id: 'tk_a1', state: 'USED', checked_in: true, checked_in_at: hoursFromNow(-1), attendee_name: 'Bisi Adeyemi', gate: 'main', checkin_method: 'scan', checked_in_by: 'u_steward1', checked_in_by_name: 'Kemi (steward)' },
  { id: 'tk_a2', name: 'Tunde Okafor', cashtag: '@tunde', tier_name: 'Regular', ticket_id: 'tk_a2', state: 'ISSUED', checked_in: false, checked_in_at: null, attendee_name: 'Tunde Okafor' },
  { id: 'tk_a3', name: 'Chidi Nwosu', cashtag: '@chidi', tier_name: 'Regular', ticket_id: 'tk_a3', state: 'USED', checked_in: true, checked_in_at: hoursFromNow(-2), attendee_name: 'Chidi Nwosu', gate: 'vip', checkin_method: 'manual', checked_in_by: 'u_org1', checked_in_by_name: 'Organiser' },
  { id: 'tk_a4', name: 'Ada Eze', cashtag: '@ada', tier_name: 'Table for 5', ticket_id: 'tk_a4', state: 'ISSUED', checked_in: false, checked_in_at: null },
];

let MOCK_CHECKIN_HISTORY: CheckinEntry[] = [
  { id: 'ch_1', ticket_id: 'tk_a1', actor_id: 'u_steward1', actor_name: 'Kemi (steward)', action: 'IN', method: 'scan', gate: 'main', occurred_at: hoursFromNow(-1) },
  { id: 'ch_2', ticket_id: 'tk_a3', actor_id: 'u_org1', actor_name: 'Organiser', action: 'IN', method: 'manual', gate: 'vip', reason: 'Phone dead at the gate', occurred_at: hoursFromNow(-2) },
];

function mockOrders(): Order[] {
  return MOCK_BOOKINGS.flatMap((b) => (b.orders ?? []).map((o) => ({ ...o, booking_ref: b.booking_ref, event_title: b.event_title, event_starts_at: b.starts_at })));
}

// The server derives a quote from the stored tier, the promo and the event's own
// fee — never from what the client claims. The fixture does the same arithmetic
// so a mock run exercises the real numbers.
function mockQuote(eventId: string, tierId: string, quantity: number, promo?: string): Quote {
  const e = MOCK_EVENTS.find((x) => x.id === eventId);
  const tier = e?.tiers.find((t) => t.id === tierId);
  if (!e || !tier) throw new Error('Event or ticket tier not found');
  const subtotal = tier.price_kobo * quantity;
  const percentOff = promo === 'EARLY10' ? 10 : 0;
  const discountPerSeat = Math.floor((tier.price_kobo * percentOff) / 100);
  const discount = discountPerSeat * quantity;
  const total = subtotal - discount;
  const fee = Math.floor((total * e.fee_bps) / 10_000);
  const capacity = tier.capacity;
  return {
    event_id: e.id, event_title: e.title, event_state: e.state, venue: e.venue, city: e.city,
    starts_at: e.starts_at, tier_id: tier.id, tier_name: tier.name, quantity,
    unit_price_kobo: tier.price_kobo, subtotal_kobo: subtotal,
    promo_code: percentOff ? promo : undefined,
    discount_per_seat_kobo: discountPerSeat, discount_kobo: discount, total_kobo: total,
    fee_bps: e.fee_bps, platform_fee_kobo: fee, organiser_net_kobo: total - fee,
    remaining_seats: Math.max(0, capacity - tier.sold), unlimited_capacity: capacity <= 0,
    refund_policy: e.refund_policy, refund_cutoff_hours: e.refund_cutoff_hours,
    checkin_opens_minutes: e.checkin_opens_minutes, checkin_closes_minutes: e.checkin_closes_minutes,
  };
}

function summaryOf(e: EventDetail): EventSummary {
  const activeTiers = e.tiers.filter((t) => t.active);
  const minPrice = activeTiers.length ? Math.min(...activeTiers.map((t) => t.price_kobo)) : null;
  const soldOut = activeTiers.length > 0 && activeTiers.every((t) => t.sold >= t.capacity);
  return {
    id: e.id, title: e.title, venue: e.venue, city: e.city, starts_at: e.starts_at, ends_at: e.ends_at,
    state: e.state, category: e.category, min_price_kobo: minPrice, sold_out: soldOut,
  };
}

export async function listEvents(params?: EventQuery): Promise<EventSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = MOCK_EVENTS.filter((e) => e.state !== 'DRAFT' && e.state !== 'SUSPENDED');
    if (params?.category && params.category !== 'all') list = list.filter((e) => e.category === params.category);
    if (params?.state) list = list.filter((e) => e.state === params.state);
    list = filterSummariesMock(list, params);
    return list.map(summaryOf);
  }
  const query: Record<string, string> = {};
  if (params?.category && params.category !== 'all') query.category = params.category;
  if (params?.state) query.state = params.state;
  // Discovery extensions the backend already serves (UAT EVT-048/049/050): city
  // (commerce column, ignored by the server while its flag is off), free-text,
  // an RFC3339 date window and a deterministic sort.
  if (params?.city)  query.city  = params.city;
  if (params?.q)     query.q     = params.q;
  if (params?.from)  query.from  = params.from;
  if (params?.to)    query.to    = params.to;
  if (params?.sort)  query.sort  = params.sort;
  return pickList<EventSummary>(await api.get(`${API_BASE}`, { params: query }), 'events');
}

// Mirrors the server's own filters so fixture mode behaves like the live list
// rather than silently ignoring a chip the user tapped.
function filterSummariesMock(list: EventDetail[], params?: EventQuery): EventDetail[] {
  let out = list;
  if (params?.city) {
    const city = params.city.trim().toLowerCase();
    out = out.filter((e) => (e.city ?? '').toLowerCase().includes(city));
  }
  if (params?.q) {
    const q = params.q.trim().toLowerCase();
    out = out.filter((e) => e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q));
  }
  if (params?.from) out = out.filter((e) => new Date(e.starts_at).getTime() >= new Date(params.from!).getTime());
  if (params?.to)   out = out.filter((e) => new Date(e.starts_at).getTime() <= new Date(params.to!).getTime());
  const priceOf = (e: EventDetail) => {
    const active = e.tiers.filter((t) => t.active);
    return active.length ? Math.min(...active.map((t) => t.price_kobo)) : Number.MAX_SAFE_INTEGER;
  };
  switch (params?.sort) {
    case 'date_desc':   out = [...out].sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at)); break;
    case 'price_asc':   out = [...out].sort((a, b) => priceOf(a) - priceOf(b)); break;
    case 'price_desc':  out = [...out].sort((a, b) => priceOf(b) - priceOf(a)); break;
    default:            out = [...out].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  }
  return out;
}

export async function getEvent(id: string): Promise<EventDetail> {
  if (USE_MOCK) {
    await delay();
    const e = MOCK_EVENTS.find((x) => x.id === id);
    if (!e) throw new Error('Event not found');
    const like = MOCK_LIKES.get(id);
    return like ? { ...e, liked: like.liked, like_count: like.like_count } : e;
  }
  return unwrap(await api.get(`${API_BASE}/${id}`));
}

export async function listMyTickets(): Promise<Ticket[]> {
  if (USE_MOCK) { await delay(); return MOCK_TICKETS; }
  return pickList<Ticket>(await api.get(`${API_BASE}/my/tickets`), 'tickets');
}

// The backend has no GET /tickets/:id — my/tickets is the only ticket read
// endpoint. Individual ticket screens fetch the list and find by id.
export async function getTicket(id: string): Promise<Ticket> {
  if (USE_MOCK) {
    await delay();
    const t = MOCK_TICKETS.find((x) => x.id === id);
    if (!t) throw new Error('Ticket not found');
    return t;
  }
  const tickets = await listMyTickets();
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new Error('Ticket not found');
  return t;
}

// Live, server-issued rotating gate token for the caller's own ticket — replaces
// any client-computed QR rotation. Re-fetch on an interval just under the
// server's RotateTTL (30s) so the rendered pass changes on the same schedule
// Scan's window-staleness check enforces (see useTicketToken in hooks.ts).
export async function getTicketToken(ticketId: string): Promise<GateToken> {
  if (USE_MOCK) {
    await delay(120);
    return { cid: 'mock-credential', w: Math.floor(Date.now() / 30000), n: 'mock-nonce', sig: 'mock-sig' };
  }
  return unwrap(await api.get(`${API_BASE}/tickets/${ticketId}/token`));
}

export async function getEventWallet(walletId: string): Promise<EventWallet> {
  if (USE_MOCK) { await delay(); return MOCK_WALLET; }
  return unwrap(await api.get(`${API_BASE}/wallet/${walletId}`));
}

// Opens (or returns) the caller's per-event wallet. The backend keys wallets
// by walletId, not eventId, so screens must open a wallet once and hold onto
// its id (see hooks.ts / wallet screens param wiring).
export async function openEventWallet(eventId: string): Promise<EventWallet> {
  if (USE_MOCK) { await delay(); return MOCK_WALLET; }
  return unwrap(await api.post(`${API_BASE}/${eventId}/wallet`, {}));
}

// GET /:id/vendors now exists (identity only: {id, name, active} — see
// backend/internal/top5events Vendor model) and is used by organiser-facing
// vendor management. Tap-to-pay's menu STAYS mock-only on purpose: pricing,
// emoji, and priced menu items (EventVendorDisplay.items, which
// picked-quantity × priceKobo actually drives the charge amount from) have no
// backend concept at all — no vendor-item/price table exists — so wiring the
// real identity-only endpoint here would remove the mock items without
// anything to replace them, breaking the one thing this screen needs to
// charge anyone. See listOrganiserVendors for the real, identity-only read.
export async function listVendors(_eventId: string): Promise<EventVendorDisplay[]> {
  await delay();
  return MOCK_VENDORS;
}

// Real, identity-only vendor list ({id, name, active}) — for organiser-facing
// vendor management, not tap-to-pay (see listVendors above for why that stays
// mock-only).
export async function listOrganiserVendors(eventId: string): Promise<{ id: string; name: string; active: boolean }[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_VENDORS.map((v) => ({ id: v.id, name: v.name, active: true }));
  }
  return pickList(await api.get(`${API_BASE}/${eventId}/vendors`), 'vendors');
}

// NOTE: no venue-map endpoint exists on the backend route table at all.
// Kept mock-only; flagged in the report.
export async function getVenueMap(_eventId: string): Promise<VenueZone[]> {
  await delay();
  return MOCK_VENUE;
}

// GET /organiser/mine — server-scoped + aggregated (real tickets_sold/gross_kobo
// per event, computed in SQL), replacing the previous client-side derive from
// an unscoped listEvents() call.
export async function listOrganiserEvents(): Promise<OrganiserEventStats[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EVENTS.map((e) => {
      const tickets_sold = e.tiers.reduce((s, t) => s + t.sold, 0);
      const tickets_total = e.tiers.reduce((s, t) => s + t.capacity, 0) || null;
      const gross_kobo = e.tiers.reduce((s, t) => s + t.sold * t.price_kobo, 0);
      return { event: summaryOf(e), tickets_sold, tickets_total, gross_kobo };
    });
  }
  return pickList(await api.get(`${API_BASE}/organiser/mine`), 'events');
}

// GET /:id/attendees — organiser/steward-gated real endpoint.
export async function listAttendees(eventId: string): Promise<Attendee[]> {
  if (USE_MOCK) { await delay(); return MOCK_ATTENDEES; }
  return pickList(await api.get(`${API_BASE}/${eventId}/attendees`), 'attendees');
}

export async function purchaseTickets(input: PurchaseTicketInput): Promise<PurchaseResult> {
  if (USE_MOCK) {
    await delay();
    const q = mockQuote(input.eventId, input.tier_id, input.quantity, input.promo_code);
    const tickets: Ticket[] = Array.from({ length: q.quantity }).map((_, i) => ({
      id: `tk_${Date.now()}_${i}`, event_id: input.eventId, tier_id: input.tier_id,
      order_id: `ord_${Date.now()}_${i}`, owner_id: 'u_me', state: 'ISSUED',
      credential_id: `cred_${Math.random().toString(36).slice(2, 8)}`,
      price_paid_kobo: q.unit_price_kobo - q.discount_per_seat_kobo, created_at: new Date().toISOString(),
      attendee_name: input.attendee_names?.[i] || undefined,
    }));
    return {
      ok: true, tickets, total_kobo: q.total_kobo, quantity: q.quantity, fulfilled: tickets.length, partial: false,
      booking_ref: `evt-${Date.now()}-mock`,
    };
  }
  // One POST per checkout, not per seat. The server runs the batch under the
  // tier lock and keys each seat "<Idempotency-Key>:<i>", so one key groups the
  // seats into one booking and a retry resumes without double-charging. It
  // returns the seats it could issue (partial) rather than failing the basket.
  const res = await api.post(`${API_BASE}/${input.eventId}/purchase`,
    {
      tier_id: input.tier_id,
      quantity: input.quantity,
      promo: input.promo_code,
      attendee_names: input.attendee_names,
    },
    { headers: { 'Idempotency-Key': idempotencyKey() } });
  const out = unwrap<PurchaseResult & { total_kobo?: number }>(res);
  const tickets = out.tickets ?? [];
  return {
    ok: true,
    tickets,
    // The server totals the seats it actually issued; never re-derive it here.
    total_kobo: out.total_kobo ?? tickets.reduce((s, t) => s + (t.price_paid_kobo ?? 0), 0),
    quantity: out.quantity, fulfilled: out.fulfilled, partial: out.partial, booking_ref: out.booking_ref,
  };
}

// ── Card checkout (server rail, FEATURE_EVENTS_CARD_CHECKOUT) ───────────────
// POST /:id/purchase/card — the server HOLDS the seats under the same tier
// lock as the wallet purchase and initialises a Paystack transaction for its
// own computed amount (the body carries NO amount). Settlement never trusts
// the client redirect: it runs on the signed webhook or the server-side
// verify the status poll drives — the same shape as mobility's card-direct
// rail (useGatewayCheckout + resolver screen).

export type CardCheckoutStatusValue =
  'pending' | 'processing' | 'confirmed' | 'expired' | 'refunding' | 'refunded';

export interface CardCheckoutIntent {
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
  amountKobo: number;
  currency: string;
  quantity: number;
  status: CardCheckoutStatusValue;
  holdExpiresAt?: string;
}

export interface CardCheckoutStatus {
  reference: string;
  status: CardCheckoutStatusValue;
  amountKobo: number;
  tickets: Ticket[];
}

export async function initiateCardCheckout(
  input: PurchaseTicketInput & { email?: string },
): Promise<CardCheckoutIntent> {
  if (USE_MOCK) {
    await delay(600);
    const e = MOCK_EVENTS.find((x) => x.id === input.eventId);
    const tier = e?.tiers.find((t) => t.id === input.tier_id);
    return {
      reference: `evtorder-mock-${Date.now()}`,
      authorizationUrl: `https://checkout.paystack.test/mock_${Date.now()}`,
      amountKobo: (tier?.price_kobo ?? 0) * input.quantity,
      currency: 'NGN',
      quantity: input.quantity,
      status: 'pending',
    };
  }
  return unwrap<CardCheckoutIntent>(await api.post(`${API_BASE}/${input.eventId}/purchase/card`,
    { tier_id: input.tier_id, quantity: input.quantity, promo: input.promo_code, email: input.email },
    { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

export async function getCardCheckoutStatus(reference: string): Promise<CardCheckoutStatus> {
  if (USE_MOCK) {
    await delay();
    return { reference, status: 'confirmed', amountKobo: 0, tickets: [] };
  }
  return unwrap<CardCheckoutStatus>(await api.get(`${API_BASE}/card/${encodeURIComponent(reference)}/status`));
}

export async function giftTicket(input: GiftTicketInput): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Contract field is `recipient` (the cashtag handle) — sending `cashtag`
  // failed the server's required-field binding and 400'd every gift.
  return unwrap(await api.post(`${API_BASE}/tickets/${input.ticketId}/gift`, { recipient: input.cashtag }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

export async function createEvent(input: CreateEventInput): Promise<EventDetail> {
  if (USE_MOCK) {
    await delay();
    const id = `e_${Date.now()}`;
    return {
      id, organiser_id: 'u_me', title: input.title, description: input.description,
      venue: input.venue, state: 'DRAFT', starts_at: input.starts_at, ends_at: input.ends_at,
      fee_bps: input.fee_bps ?? 500, category: input.category, created_at: new Date().toISOString(),
      tiers: input.tiers.map((t, i) => ({ id: `t_${i}`, event_id: id, name: t.name, price_kobo: t.price_kobo, capacity: t.capacity, sold: 0, active: true })),
      banner_url: null, venue_lat: null, venue_lng: null, venue_place_id: null, like_count: 0, liked: false,
    };
  }
  // createEventBody adds venue_lat / venue_lng / venue_place_id only when a place
  // was picked (events-social); without them the body is as before.
  const created: EventDetail = await unwrap(await api.post(`${API_BASE}`, createEventBody(input),
    { headers: { 'Idempotency-Key': idempotencyKey() } }));

  // Backend has no bulk tier-create — add each tier sequentially, then submit
  // the event into the organiser approval pipeline.
  const tiers: TicketTier[] = [];
  for (const t of input.tiers) {
    tiers.push(await addTicketTier(created.id, { name: t.name, price_kobo: t.price_kobo, capacity: t.capacity }));
  }
  await submitEvent(created.id);
  return { ...created, tiers };
}

export async function addTicketTier(eventId: string, input: AddTierInput): Promise<TicketTier> {
  if (USE_MOCK) {
    await delay();
    return { id: `t_${Date.now()}`, event_id: eventId, name: input.name, price_kobo: input.price_kobo, capacity: input.capacity, sold: 0, active: true };
  }
  return unwrap(await api.post(`${API_BASE}/${eventId}/tiers`, input));
}

export async function submitEvent(eventId: string): Promise<EventDetail> {
  if (USE_MOCK) { await delay(); return getEvent(eventId); }
  return unwrap(await api.post(`${API_BASE}/${eventId}/submit`, {}));
}

export async function goLiveEvent(eventId: string): Promise<EventDetail> {
  if (USE_MOCK) { await delay(); return getEvent(eventId); }
  return unwrap(await api.post(`${API_BASE}/${eventId}/golive`, {}));
}

export async function closeEvent(eventId: string): Promise<EventDetail> {
  if (USE_MOCK) { await delay(); return getEvent(eventId); }
  return unwrap(await api.post(`${API_BASE}/${eventId}/close`, {}));
}

// ── Organiser lifecycle (FEATURE_EVENTS_EDIT_LIFECYCLE) — writes, no mock fallback ──
export async function updateEvent(id: string, patch: EventPatch): Promise<EventDetail> {
  if (USE_MOCK) throw notInFixtureMode('Editing an event');
  return unwrap(await api.patch(`${API_BASE}/${id}`, patch));
}

export async function duplicateEvent(id: string): Promise<EventDetail> {
  if (USE_MOCK) throw notInFixtureMode('Duplicating an event');
  return unwrap(await api.post(`${API_BASE}/${id}/duplicate`, {}));
}

export async function pauseEvent(id: string): Promise<EventDetail> {
  if (USE_MOCK) throw notInFixtureMode('Pausing an event');
  return unwrap(await api.post(`${API_BASE}/${id}/pause`, {}));
}

export async function resumeEvent(id: string): Promise<EventDetail> {
  if (USE_MOCK) throw notInFixtureMode('Resuming an event');
  return unwrap(await api.post(`${API_BASE}/${id}/resume`, {}));
}

// Cancel refunds buyers, so it is a money mutation: the caller supplies the
// Idempotency-Key (generate once per user intent, reuse on retry).
export async function cancelEvent(id: string, reason: string, idemKey: string): Promise<unknown> {
  if (USE_MOCK) throw notInFixtureMode('Cancelling an event');
  return unwrap(await api.post(`${API_BASE}/${id}/cancel`, { reason }, { headers: { 'Idempotency-Key': idemKey } }));
}

// ── Comps / attendee CSV / announcements ───────────────────────────────────
// Comps are zero-price ticket issuance and announcements fan out to every
// holder: both are writes, so the caller supplies the Idempotency-Key (one per
// user intent, reused on retry) and fixture mode refuses instead of faking.
export async function issueComp(eventId: string, input: IssueCompInput, idemKey: string): Promise<Ticket[]> {
  if (USE_MOCK) throw notInFixtureMode('Issuing a comp ticket');
  const body = { tier_id: input.tier_id, recipients: input.recipients, note: input.note };
  return unwrap(await api.post(`${API_BASE}/${eventId}/comps`, body, { headers: { 'Idempotency-Key': idemKey } }));
}

export async function announce(eventId: string, input: AnnounceInput, idemKey: string): Promise<AnnounceResult> {
  if (USE_MOCK) throw notInFixtureMode('Sending an announcement');
  const body = { subject: input.subject, body: input.body };
  return unwrap(await api.post(`${API_BASE}/${eventId}/announcements`, body, { headers: { 'Idempotency-Key': idemKey } }));
}

// GET /:id/attendees?format=csv — a read returning raw text/csv, NOT a JSON
// envelope, so it is returned as-is (no unwrap). Fixture mode returns a small
// fixture, like the other reads.
export async function fetchAttendeesCsv(eventId: string): Promise<string> {
  if (USE_MOCK) {
    await delay();
    const rows = MOCK_ATTENDEES.map((a) => [a.name, a.cashtag, a.tier_name, a.ticket_id, a.state, a.checked_in ? 'yes' : 'no'].join(','));
    return ['name,cashtag,tier,ticket_id,state,checked_in', ...rows].join('\n');
  }
  const res = await api.get(`${API_BASE}/${eventId}/attendees`, {
    params: { format: 'csv' },
    responseType: 'text',
    headers: { Accept: 'text/csv' },
    // Keep the 2xx body raw (it is CSV, not JSON). On an error status the body is
    // the Go JSON error envelope, so parse it back so the client interceptor can
    // surface {error|message} instead of a generic axios message.
    transformResponse: (d: unknown, _headers?: unknown, status?: number) => {
      if (typeof d === 'string' && typeof status === 'number' && status >= 400) {
        try { return JSON.parse(d); } catch { return d; }
      }
      return d;
    },
  });
  return typeof res.data === 'string' ? res.data : String(res.data ?? '');
}

// ── Tier/promo management (FEATURE_EVENTS_TICKETING_DEPTH) — writes, no mock fallback ──
export async function updateTier(eventId: string, tierId: string, patch: TierPatch): Promise<TicketTier> {
  if (USE_MOCK) throw notInFixtureMode('Editing a ticket tier');
  return unwrap(await api.patch(`${API_BASE}/${eventId}/tiers/${tierId}`, patch));
}

export async function updatePromo(eventId: string, promoId: string, patch: PromoPatch): Promise<PromoCode> {
  if (USE_MOCK) throw notInFixtureMode('Editing a promo code');
  return unwrap(await api.patch(`${API_BASE}/${eventId}/promos/${promoId}`, patch));
}

export async function createPromo(eventId: string, input: CreatePromoInput): Promise<PromoCode> {
  if (USE_MOCK) throw notInFixtureMode('Creating a promo code');
  return unwrap(await api.post(`${API_BASE}/${eventId}/promos`, input));
}

// ── Social: likes, follows, organiser profile (FEATURE_EVENTS_SOCIAL) ───────
// Likes and follows move no money, so there is no Idempotency-Key and no ledger.
// Fixture mode keeps them in these in-memory Maps, seeded from MOCK_EVENTS. The
// writes are SESSION-ONLY: they last until the app reloads and are never sent
// anywhere. They are not persisted and must not be presented as saved.
const MOCK_LIKES = new Map<string, LikeState>(
  MOCK_EVENTS.map((e) => [e.id, { liked: e.liked, like_count: e.like_count }]),
);

const MOCK_ME = 'u_me';
const MOCK_ORGANISER_NAMES: Record<string, string> = {
  u_org1: 'Felabration Collective',
  u_org2: 'Lagos Tech Co',
  u_org3: 'Detty Nights',
  [MOCK_ME]: 'My Events',
};
const MOCK_ORGANISER_FOLLOWERS: Record<string, number> = { u_org1: 1204, u_org2: 560, u_org3: 87, [MOCK_ME]: 0 };

type MockOrganiser = {
  display_name: string;
  bio: string;
  banner_url: string | null;
  follower_count: number;
  following: boolean;
};

const MOCK_ORGANISERS = new Map<string, MockOrganiser>(
  Array.from(new Set(MOCK_EVENTS.map((e) => e.organiser_id))).map((id) => [id, {
    display_name: MOCK_ORGANISER_NAMES[id] ?? id,
    bio: '',
    banner_url: null,
    follower_count: MOCK_ORGANISER_FOLLOWERS[id] ?? 0,
    following: false,
  }]),
);

// A mock event without its tiers, as the profile and Following lists return it.
// Like state is the live mock state, so a like on the detail shows there.
function eventOf({ tiers: _tiers, ...ev }: EventDetail): Event {
  const like = MOCK_LIKES.get(ev.id);
  return like ? { ...ev, liked: like.liked, like_count: like.like_count } : ev;
}

// Upcoming public events of one organiser, as on the real profile page.
function upcomingEventsOf(organiserId: string): Event[] {
  return MOCK_EVENTS
    .filter((e) => e.organiser_id === organiserId && (e.state === 'LIVE' || e.state === 'APPROVED'))
    .map(eventOf);
}

function mockOrganiser(id: string): MockOrganiser {
  const o = MOCK_ORGANISERS.get(id);
  if (!o) throw new Error('Organiser not found');
  return o;
}

function profileOf(id: string, o: MockOrganiser): OrganiserProfile {
  return { organiser_id: id, ...o, events: upcomingEventsOf(id) };
}

async function setLike(id: string, liked: boolean): Promise<LikeState> {
  if (USE_MOCK) {
    await delay(120);
    const cur = MOCK_LIKES.get(id);
    if (!cur) throw new Error('Event not found');
    // A repeat write returns the current state, like the server.
    const next: LikeState = cur.liked === liked
      ? cur
      : { liked, like_count: Math.max(0, cur.like_count + (liked ? 1 : -1)) };
    MOCK_LIKES.set(id, next);
    return next;
  }
  const res = liked
    ? await api.post(`${API_BASE}/${id}/like`, {})
    : await api.delete(`${API_BASE}/${id}/like`);
  return unwrap<LikeState>(res);
}

async function setFollow(id: string, following: boolean): Promise<FollowState> {
  if (USE_MOCK) {
    await delay(120);
    // The server rejects a self-follow with 422.
    if (id === MOCK_ME) throw new Error('You cannot follow yourself');
    const o = mockOrganiser(id);
    if (o.following !== following) {
      o.following = following;
      o.follower_count = Math.max(0, o.follower_count + (following ? 1 : -1));
    }
    return { following: o.following, follower_count: o.follower_count };
  }
  const res = following
    ? await api.post(`${API_BASE}/organisers/${id}/follow`, {})
    : await api.delete(`${API_BASE}/organisers/${id}/follow`);
  return unwrap<FollowState>(res);
}

export const likeEvent = (id: string): Promise<LikeState> => setLike(id, true);
export const unlikeEvent = (id: string): Promise<LikeState> => setLike(id, false);
export const followOrganiser = (id: string): Promise<FollowState> => setFollow(id, true);
export const unfollowOrganiser = (id: string): Promise<FollowState> => setFollow(id, false);

export async function getOrganiser(id: string): Promise<OrganiserProfile> {
  if (USE_MOCK) {
    await delay();
    return profileOf(id, mockOrganiser(id));
  }
  return unwrap(await api.get(`${API_BASE}/organisers/${id}`));
}

// PUT /organisers/me. Fixture mode edits the in-memory profile of the mock
// caller (session-only, see above).
export async function updateMyOrganiser(patch: OrganiserPatch): Promise<OrganiserProfile> {
  if (USE_MOCK) {
    await delay();
    const cur = MOCK_ORGANISERS.get(MOCK_ME) ?? {
      display_name: MOCK_ORGANISER_NAMES[MOCK_ME], bio: '', banner_url: null, follower_count: 0, following: false,
    };
    const next: MockOrganiser = {
      ...cur,
      display_name: patch.display_name ?? cur.display_name,
      bio: patch.bio ?? cur.bio,
      banner_url: patch.banner_url === undefined ? cur.banner_url : patch.banner_url,
    };
    MOCK_ORGANISERS.set(MOCK_ME, next);
    return profileOf(MOCK_ME, next);
  }
  return unwrap(await api.put(`${API_BASE}/organisers/me`, patch));
}

// GET /following: upcoming events of the organisers the caller follows, paged.
// Inputs are validated here the same way the server does (limit 1..100, offset
// >= 0) so a bad value fails fast with a clear message instead of a 422.
export async function listFollowingEvents(limit = 20, offset = 0): Promise<Event[]> {
  checkFollowingPage(limit, offset);
  if (USE_MOCK) {
    await delay();
    return MOCK_EVENTS
      .filter((e) => MOCK_ORGANISERS.get(e.organiser_id)?.following && (e.state === 'LIVE' || e.state === 'APPROVED'))
      .map(eventOf)
      .slice(offset, offset + limit);
  }
  return pickList<Event>(await api.get(`${API_BASE}/following`, { params: { limit, offset } }), 'events');
}

// POST /organisers/me/banner/presign. The backend chooses the object key and
// binds content_type into the signature; the caller PUTs the bytes to
// upload_url, then saves object_key via updateMyOrganiser({ banner_url }).
// Fixture mode returns a fake upload_url that nothing accepts: fixture uploads
// are NOT persisted, and the caller must skip the network PUT for fixture:// URLs.
export async function presignOrganiserBanner(fileName: string, contentType: string): Promise<BannerPresign> {
  if (USE_MOCK) {
    await delay(120);
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    return {
      upload_url: 'fixture://banner-upload',
      object_key: `organiser/${MOCK_ME}/banner/fixture-${Date.now()}${ext}`,
      content_type: contentType,
      expires_in: 600,
      method: 'PUT',
    };
  }
  return unwrap(await api.post(`${API_BASE}/organisers/me/banner/presign`, { file_name: fileName, content_type: contentType }));
}

// ── Team roles (FEATURE_EVENTS_TEAM_ROLES) — not money, so no Idempotency-Key ──
const MOCK_TEAM: TeamMember[] = [
  { user_id: 'u_mgr1', handle: 'ada_events', name: 'Ada Obi', role: 'MANAGER', granted_by: 'u_me', created_at: daysAgo(3) },
];

export async function listTeam(eventId: string): Promise<TeamMember[]> {
  if (USE_MOCK) { await delay(); return MOCK_TEAM; }
  return pickList(await api.get(`${API_BASE}/${eventId}/team`), 'team');
}

export async function addTeamMember(eventId: string, input: AddTeamMemberInput): Promise<TeamMember> {
  if (USE_MOCK) throw notInFixtureMode('Granting a team role');
  return unwrap(await api.post(`${API_BASE}/${eventId}/team`, { user_handle: input.user_handle, role: input.role }));
}

export async function removeTeamMember(eventId: string, userId: string): Promise<void> {
  if (USE_MOCK) throw notInFixtureMode('Removing a team member');
  await api.delete(`${API_BASE}/${eventId}/team/${userId}`);
}

// Closed-loop top-up: debits main wallet (via PaymentSheet) → credits event wallet.
export async function topUpEventWallet(walletId: string, amountKobo: number, source: TopUpSource = 'wallet'): Promise<EventWallet> {
  if (USE_MOCK) {
    await delay();
    MOCK_WALLET = { ...MOCK_WALLET, balance_kobo: MOCK_WALLET.balance_kobo + amountKobo };
    MOCK_WALLET_ENTRIES = [
      { id: `w_${Date.now()}`, wallet_id: MOCK_WALLET.id, type: 'TOPUP', amount_kobo: amountKobo, reference: 'Top-up', idempotency_key: idempotencyKey(), created_at: new Date().toISOString() },
      ...MOCK_WALLET_ENTRIES,
    ];
    return MOCK_WALLET;
  }
  return unwrap(await api.post(`${API_BASE}/wallet/${walletId}/topup`, { amount_kobo: amountKobo, source }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

// Tap-to-pay a vendor from the closed-loop event wallet. The charge endpoint
// debits the caller's event wallet for that event server-side.
export async function chargeVendor(vendorId: string, walletId: string, amountKobo: number): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    if (amountKobo > MOCK_WALLET.balance_kobo) throw new Error('Insufficient event-wallet balance. Top up to continue.');
    MOCK_WALLET = { ...MOCK_WALLET, balance_kobo: MOCK_WALLET.balance_kobo - amountKobo };
    MOCK_WALLET_ENTRIES = [
      { id: `w_${Date.now()}`, wallet_id: walletId, type: 'CHARGE', amount_kobo: amountKobo, reference: vendorId, idempotency_key: idempotencyKey(), created_at: new Date().toISOString() },
      ...MOCK_WALLET_ENTRIES,
    ];
    return { ok: true };
  }
  return unwrap(await api.post(`${API_BASE}/vendors/${vendorId}/charge`, { wallet_id: walletId, amount_kobo: amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

// NL-3: residual closed-loop balance refunds to the user's MAIN wallet only.
export async function closeEventWallet(walletId: string): Promise<{ ok: boolean; refundedKobo: number }> {
  if (USE_MOCK) {
    await delay();
    const refunded = MOCK_WALLET.balance_kobo;
    MOCK_WALLET = { ...MOCK_WALLET, balance_kobo: 0, state: 'CLOSED' };
    MOCK_WALLET_ENTRIES = [
      { id: `w_${Date.now()}`, wallet_id: walletId, type: 'REFUND', amount_kobo: refunded, reference: 'Residual refund to main wallet', idempotency_key: idempotencyKey(), created_at: new Date().toISOString() },
      ...MOCK_WALLET_ENTRIES,
    ];
    return { ok: true, refundedKobo: refunded };
  }
  const res = await unwrap<{ refunded_kobo: number }>(await api.post(`${API_BASE}/wallet/${walletId}/close`, {}, { headers: { 'Idempotency-Key': idempotencyKey() } }));
  return { ok: true, refundedKobo: res.refunded_kobo };
}

// derived from mock ledger entries in mock mode, empty otherwise (see report).
// GET /wallet/:walletId/entries — ownership-or-organiser-gated real endpoint.
export async function listWalletEntries(walletId: string): Promise<EventWalletEntry[]> {
  if (USE_MOCK) { await delay(); return MOCK_WALLET_ENTRIES; }
  return pickList(await api.get(`${API_BASE}/wallet/${walletId}/entries`), 'entries');
}

// Steward scan validation (offline-tolerant). Takes the REAL decoded gate token
// (from the camera's QR scan, JSON.parse'd — see app/events/steward/scan.tsx)
// ({token, gate}), matching backend/internal/top5events's scanRequest exactly.
// The previous version sent {credential_id: string} — a request shape the
// backend never accepted, so live check-in was broken end to end.
export async function validateScan(token: GateToken, gate: Gate): Promise<ScanResult> {
  if (USE_MOCK) {
    await delay(180);
    const code = token.cid.trim();
    const att = MOCK_ATTENDEES.find((a) => a.ticket_id.toLowerCase() === code.toLowerCase());
    if (code.toUpperCase().includes('USED') || att?.state === 'USED') return { outcome: 'already-used', ticket_id: att?.ticket_id, holderName: att?.name, tierName: att?.tier_name, offline: false };
    if (code.length > 0) return { outcome: 'valid', ticket_id: att?.ticket_id ?? 'tk_scan', holderName: att?.name ?? 'Guest', tierName: att?.tier_name ?? 'Regular', offline: false };
    return { outcome: 'invalid', offline: false };
  }
  try {
    return unwrap(await api.post(`${API_BASE}/scan`, { token, gate }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
  } catch {
    // Offline fallback: optimistic accept of a well-formed token, queued for
    // sync — the real single-use/replay check only happens server-side, so this
    // is a UX affordance for a flaky gate connection, not a security guarantee.
    const valid = !!(token.cid && token.sig);
    return { outcome: valid ? 'valid' : 'invalid', offline: true };
  }
}

// ── Events commerce (FEATURE_EVENTS_COMMERCIAL) ──────────────────────────────
// Every route below is unmounted on the server while its flag is off, so a call
// made against an unflagged backend is a 404 — not a retryable failure. The
// client mirrors that gate: screens hide the affordance, and these guards catch
// any call that slips past them with a message that says why.
const commerceDisabled = () =>
  new Error('Events commerce is turned off: the server does not expose these routes while FEATURE_EVENTS_COMMERCIAL is unset. Set EXPO_PUBLIC_EVENTS_COMMERCIAL=true only when the backend flag is on and migration 20271400000000 is applied.');

function requireCommerce(): void {
  if (!EVENTS_COMMERCE_ENABLED) throw commerceDisabled();
}

const byNewest = <T extends { created_at?: string; occurred_at?: string }>(a: T, b: T) =>
  new Date((b.created_at ?? b.occurred_at) as string).getTime() - new Date((a.created_at ?? a.occurred_at) as string).getTime();

// GET /:id/quote — the server's price for this basket. The checkout screen shows
// this total, never its own arithmetic, and the wallet is debited exactly it.
export async function quoteTickets(input: QuoteArgs): Promise<Quote> {
  requireCommerce();
  if (USE_MOCK) { await delay(160); return mockQuote(input.eventId, input.tier_id, input.quantity, input.promo_code); }
  const params: Record<string, string | number> = { tier_id: input.tier_id, quantity: Math.max(1, input.quantity || 1) };
  if (input.promo_code) params.promo = input.promo_code;
  return unwrap(await api.get(`${API_BASE}/${input.eventId}/quote`, { params }));
}

// GET /my/orders — one row per seat.
export async function listMyOrders(limit = 50, offset = 0): Promise<Order[]> {
  requireCommerce();
  if (USE_MOCK) { await delay(); return mockOrders().sort(byNewest); }
  return unwrap(await api.get(`${API_BASE}/my/orders`, { params: { limit, offset } }));
}

// GET /my/bookings — one row per checkout (the customer's receipt list).
export async function listMyBookings(limit = 30, offset = 0): Promise<Booking[]> {
  requireCommerce();
  if (USE_MOCK) { await delay(); return [...MOCK_BOOKINGS].sort(byNewest); }
  return unwrap(await api.get(`${API_BASE}/my/bookings`, { params: { limit, offset } }));
}

export async function getBooking(bookingRef: string): Promise<Booking> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const b = MOCK_BOOKINGS.find((x) => x.booking_ref === bookingRef);
    if (!b) throw new Error('Unknown booking reference');
    return b;
  }
  return unwrap(await api.get(`${API_BASE}/my/bookings/${encodeURIComponent(bookingRef)}`));
}

// ── Refunds ──────────────────────────────────────────────────────────────────

// POST /tickets/:ticketId/refund-request — a request, not a payout: the organiser
// (or the desk) decides, and only execution moves money.
export async function requestRefund(ticketId: string, reason: string, idem = idempotencyKey()): Promise<Refund> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const t = MOCK_TICKETS.find((x) => x.id === ticketId);
    if (!t) throw new Error('Ticket not found');
    if (t.state === 'USED') throw new Error('This ticket has already been used');
    const fee = Math.floor((t.price_paid_kobo * 500) / 10_000);
    const refund: Refund = {
      id: `rf_${Date.now()}`, event_id: t.event_id, order_id: t.order_id, ticket_id: t.id, buyer_id: 'u_me',
      amount_kobo: t.price_paid_kobo, fee_kobo: fee, refund_kobo: t.price_paid_kobo - fee,
      reason, status: 'REQUESTED', created_at: new Date().toISOString(),
    };
    MOCK_REFUNDS = [refund, ...MOCK_REFUNDS];
    return refund;
  }
  return unwrap(await api.post(`${API_BASE}/tickets/${ticketId}/refund-request`, { reason }, { headers: { 'Idempotency-Key': idem } }));
}

export async function listMyRefunds(): Promise<Refund[]> {
  requireCommerce();
  if (USE_MOCK) { await delay(); return [...MOCK_REFUNDS].sort(byNewest); }
  return unwrap(await api.get(`${API_BASE}/my/refunds`));
}

// ── Organiser: refund queue ──────────────────────────────────────────────────

export async function listEventRefunds(eventId: string, status = ''): Promise<Refund[]> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    return MOCK_REFUNDS.filter((r) => r.event_id === eventId && (!status || r.status === status)).sort(byNewest);
  }
  const params: Record<string, string> = {};
  if (status) params.status = status;
  return unwrap(await api.get(`${API_BASE}/${eventId}/refunds`, { params }));
}

export async function decideEventRefund(eventId: string, refundId: string, approve: boolean, note = ''): Promise<Refund> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const next = MOCK_REFUNDS.map((r) => (r.id === refundId
      ? { ...r, status: (approve ? 'APPROVED' : 'REJECTED') as Refund['status'], decision_note: note, decided_at: new Date().toISOString() }
      : r));
    MOCK_REFUNDS = next;
    const found = next.find((r) => r.id === refundId);
    if (!found) throw new Error('Unknown refund request');
    return found;
  }
  return unwrap(await api.post(`${API_BASE}/${eventId}/refunds/${refundId}/decide`, { approve, note }));
}

// Execution is the money leg and is idempotent server-side; nothing here should
// re-drive it on a retry — the receipt state is the authority.
export async function executeEventRefund(eventId: string, refundId: string): Promise<Refund> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const next = MOCK_REFUNDS.map((r) => (r.id === refundId
      ? { ...r, status: 'REFUNDED' as Refund['status'], decided_at: r.decided_at ?? new Date().toISOString() }
      : r));
    MOCK_REFUNDS = next;
    const found = next.find((r) => r.id === refundId);
    if (!found) throw new Error('Unknown refund request');
    return found;
  }
  return unwrap(await api.post(`${API_BASE}/${eventId}/refunds/${refundId}/execute`, {}));
}

// ── Notification inbox ───────────────────────────────────────────────────────

// The route answers { success, data: [...], unread: n }, so the count is read off
// the envelope rather than derived from the page the caller paged through.
export async function listNotifications(opts?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<NotificationPage> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const list = [...MOCK_NOTIFICATIONS].sort(byNewest);
    const shown = opts?.unreadOnly ? list.filter((n) => !n.read_at) : list;
    return { notifications: shown, unread: list.filter((n) => !n.read_at).length };
  }
  const params: Record<string, string | number> = { limit: opts?.limit ?? 30, offset: opts?.offset ?? 0 };
  if (opts?.unreadOnly) params.unread = 'true';
  const body = (await api.get(`${API_BASE}/my/notifications`, { params })).data as Record<string, unknown> | undefined;
  const list = (Array.isArray(body?.data) ? body!.data : []) as EventNotification[];
  return { notifications: list, unread: Number(body?.unread ?? list.filter((n) => !n.read_at).length) };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  requireCommerce();
  if (USE_MOCK) {
    await delay(120);
    MOCK_NOTIFICATIONS = MOCK_NOTIFICATIONS.map((n) => (n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n));
    return;
  }
  await api.post(`${API_BASE}/notifications/${notificationId}/read`, {});
}

export async function markAllNotificationsRead(): Promise<number> {
  requireCommerce();
  if (USE_MOCK) {
    await delay(120);
    const now = new Date().toISOString();
    const before = MOCK_NOTIFICATIONS.filter((n) => !n.read_at).length;
    MOCK_NOTIFICATIONS = MOCK_NOTIFICATIONS.map((n) => ({ ...n, read_at: now }));
    return before;
  }
  const out = unwrap<{ marked?: number }>(await api.post(`${API_BASE}/my/notifications/read-all`, {}));
  return out.marked ?? 0;
}

// ── Support desk ─────────────────────────────────────────────────────────────

export async function openSupportCase(input: OpenCaseInput): Promise<SupportCase> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const now = new Date().toISOString();
    const event = MOCK_EVENTS.find((e) => e.id === input.event_id);
    const c: SupportCase = {
      id: `sc_${Date.now()}`, event_id: input.event_id, event_title: event?.title,
      order_id: input.order_id, ticket_id: input.ticket_id,
      opened_by: 'u_me', kind: input.kind, subject: input.subject, body: input.body,
      status: 'OPEN', priority: input.priority ?? 'NORMAL', created_at: now, updated_at: now,
      reply_count: 0,
    };
    MOCK_CASES = [c, ...MOCK_CASES];
    return c;
  }
  return unwrap(await api.post(`${API_BASE}/support/cases`, input, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

export async function listMyCases(status = ''): Promise<SupportCase[]> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    return MOCK_CASES.filter((c) => !status || c.status === status).sort(byNewest);
  }
  const params: Record<string, string> = {};
  if (status) params.status = status;
  return unwrap(await api.get(`${API_BASE}/support/cases`, { params }));
}

export async function getSupportCase(caseId: string): Promise<SupportCase> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const c = MOCK_CASES.find((x) => x.id === caseId);
    if (!c) throw new Error('Support case not found');
    return c;
  }
  return unwrap(await api.get(`${API_BASE}/support/cases/${caseId}`));
}

export async function replySupportCase(caseId: string, body: string): Promise<SupportMessage> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const msg: SupportMessage = { id: `sm_${Date.now()}`, case_id: caseId, author_id: 'u_me', author_name: 'You', body, created_at: new Date().toISOString() };
    MOCK_CASES = MOCK_CASES.map((c) => (c.id === caseId
      ? { ...c, messages: [...(c.messages ?? []), msg], reply_count: (c.reply_count ?? 0) + 1, last_message: msg, updated_at: msg.created_at }
      : c));
    return msg;
  }
  return unwrap(await api.post(`${API_BASE}/support/cases/${caseId}/replies`, { body }));
}

// ── Door operations (organiser / steward) ────────────────────────────────────

// GET /:id/roster — the list the door works from, filtered server-side.
export async function listRoster(eventId: string, f: RosterFilter = {}): Promise<RosterRow[]> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    let rows = [...MOCK_ROSTER];
    if (f.state === 'waiting')     rows = rows.filter((r) => !r.checked_in && r.state !== 'REFUNDED');
    if (f.state === 'checked_in')  rows = rows.filter((r) => r.checked_in);
    if (f.state)                   rows = rows.filter((r) => r.state === f.state);
    if (f.gate)                    rows = rows.filter((r) => r.gate === f.gate);
    if (f.q) {
      const q = f.q.trim().toLowerCase();
      rows = rows.filter((r) => (r.attendee_name ?? '').toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.cashtag.toLowerCase().includes(q) || r.ticket_id.toLowerCase().includes(q));
    }
    const offset = f.offset ?? 0;
    return f.limit ? rows.slice(offset, offset + f.limit) : rows.slice(offset);
  }
  const params: Record<string, string | number> = {};
  if (f.state) params.state = f.state;
  if (f.gate)  params.gate  = f.gate;
  if (f.q)     params.q     = f.q;
  if (f.limit)  params.limit  = f.limit;
  if (f.offset) params.offset = f.offset;
  return unwrap(await api.get(`${API_BASE}/${eventId}/roster`, { params }));
}

// GET /:id/checkin-stats — the door counters, including whether the window is
// open right now (the server decides; the screen only renders it).
export async function getCheckinStats(eventId: string): Promise<CheckinStats> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const rows = [...MOCK_ROSTER];
    const checked = rows.filter((r) => r.checked_in);
    const byGate: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    for (const r of checked) {
      if (r.gate) byGate[r.gate] = (byGate[r.gate] ?? 0) + 1;
      if (r.checkin_method) byMethod[r.checkin_method] = (byMethod[r.checkin_method] ?? 0) + 1;
    }
    const ev = MOCK_EVENTS.find((e) => e.id === eventId);
    return {
      total: rows.length, checked_in: checked.length,
      waiting: rows.filter((r) => !r.checked_in && r.state !== 'REFUNDED').length,
      refunded: rows.filter((r) => r.state === 'REFUNDED').length,
      by_gate: byGate, by_method: byMethod,
      window_opens_at: ev ? new Date(new Date(ev.starts_at).getTime() - (ev.checkin_opens_minutes ?? 0) * 60_000).toISOString() : null,
      window_closes_at: ev ? new Date(new Date(ev.starts_at).getTime() + (ev.checkin_closes_minutes ?? 0) * 60_000).toISOString() : null,
      open: true,
    };
  }
  return unwrap(await api.get(`${API_BASE}/${eventId}/checkin-stats`));
}

export async function listCheckinHistory(eventId: string, limit = 100, offset = 0): Promise<CheckinEntry[]> {
  requireCommerce();
  if (USE_MOCK) { await delay(); return [...MOCK_CHECKIN_HISTORY].sort(byNewest).slice(offset, offset + limit); }
  return unwrap(await api.get(`${API_BASE}/${eventId}/checkin-history`, { params: { limit, offset } }));
}

// Manual check-in is an audited override, so a reason is not decoration: the
// reversal screen and any dispute read this row.
export async function manualCheckIn(eventId: string, input: { ticket_id: string; gate?: string; reason?: string }): Promise<Ticket> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    const row = MOCK_ROSTER.find((r) => r.ticket_id === input.ticket_id);
    if (!row) throw new Error('Ticket not found for this event');
    if (row.checked_in) throw new Error('Already checked in');
    const now = new Date().toISOString();
    row.checked_in = true; row.checked_in_at = now; row.state = 'USED';
    row.gate = input.gate || 'main'; row.checkin_method = 'manual';
    row.checked_in_by = 'u_me'; row.checked_in_by_name = 'You';
    MOCK_CHECKIN_HISTORY = [
      { id: `ch_${Date.now()}`, ticket_id: input.ticket_id, actor_id: 'u_me', actor_name: 'You', action: 'IN', method: 'manual', gate: row.gate, reason: input.reason, occurred_at: now },
      ...MOCK_CHECKIN_HISTORY,
    ];
    const t = MOCK_TICKETS.find((x) => x.id === input.ticket_id);
    return t ? { ...t, state: 'USED', checked_in_at: now, checkin_method: 'manual', checked_in_gate: row.gate } :
      { id: input.ticket_id, event_id: eventId, tier_id: '', order_id: '', owner_id: '', state: 'USED', credential_id: '', price_paid_kobo: 0, created_at: now };
  }
  return unwrap(await api.post(`${API_BASE}/${eventId}/checkin`, input));
}

export async function undoCheckIn(eventId: string, input: { ticket_id: string; reason: string }): Promise<Ticket> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    if (!input.reason.trim()) throw new Error('A reason is required to reverse a check-in');
    const row = MOCK_ROSTER.find((r) => r.ticket_id === input.ticket_id);
    if (!row) throw new Error('Ticket not found for this event');
    if (!row.checked_in) throw new Error('This ticket has not been checked in');
    const now = new Date().toISOString();
    row.checked_in = false; row.checked_in_at = null; row.state = 'ISSUED';
    MOCK_CHECKIN_HISTORY = [
      { id: `ch_${Date.now()}`, ticket_id: input.ticket_id, actor_id: 'u_me', actor_name: 'You', action: 'OUT', method: 'undo', gate: row.gate, reason: input.reason, occurred_at: now },
      ...MOCK_CHECKIN_HISTORY,
    ];
    const t = MOCK_TICKETS.find((x) => x.id === input.ticket_id);
    return t ? { ...t, state: 'ISSUED', checked_in_at: undefined } :
      { id: input.ticket_id, event_id: eventId, tier_id: '', order_id: '', owner_id: '', state: 'ISSUED', credential_id: '', price_paid_kobo: 0, created_at: now };
  }
  return unwrap(await api.post(`${API_BASE}/${eventId}/checkin/undo`, input));
}

// ── Governance: submit for review + trail ────────────────────────────────────

// POST /:id/submit-review — with commerce on, a submission needs a complete
// disclosure set (city, address, refund policy, check-in windows) and the server
// refuses without it.
export async function submitEventForReview(eventId: string): Promise<void> {
  requireCommerce();
  if (USE_MOCK) throw notInFixtureMode('Submitting an event for review');
  await api.post(`${API_BASE}/${eventId}/submit-review`, {});
}

export async function listEventModeration(eventId: string): Promise<ModerationDecision[]> {
  requireCommerce();
  if (USE_MOCK) {
    await delay();
    return [
      { id: 'md_1', event_id: eventId, actor_id: 'u_me', actor_name: 'You', action: 'SUBMIT', from_state: 'DRAFT', to_state: 'SUBMITTED', created_at: daysAgo(18) },
      { id: 'md_2', event_id: eventId, actor_id: 'admin_1', actor_name: 'Spotlight Review', action: 'APPROVE', from_state: 'SUBMITTED', to_state: 'APPROVED', created_at: daysAgo(12) },
    ];
  }
  return unwrap(await api.get(`${API_BASE}/${eventId}/moderation`));
}
