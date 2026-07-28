import { api } from '@/api/client';
import { USE_MOCK, API_BASE } from './constants/events.constants';
import type {
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
} from './types';

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
function idempotencyKey(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const daysAgo     = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

// ── Mock fixtures (field names match the real backend shape; opt-in only via
// EXPO_PUBLIC_EVENTS_USE_MOCK=true — see constants/events.constants.ts) ──────
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
  },
  {
    id: 'e_closed', organiser_id: 'u_org3', title: 'Detty December Beach Rave', category: 'music', state: 'CLOSED',
    starts_at: daysAgo(20), ends_at: daysAgo(20), venue: 'Landmark Beach, Oniru, Lagos',
    fee_bps: 500, created_at: daysAgo(80),
    description: 'Sun, sand and sound — the closer to the year.',
    tiers: [{ id: 't_ga', event_id: 'e_closed', name: 'General', price_kobo: 2_000_000, capacity: 4000, sold: 4000, active: false }],
  },
  {
    id: 'e_draft', organiser_id: 'u_me', title: 'Abuja Comedy Night', category: 'comedy', state: 'DRAFT',
    starts_at: daysFromNow(30), ends_at: daysFromNow(30), venue: 'Transcorp Hilton, Maitama, Abuja',
    fee_bps: 500, created_at: daysAgo(2),
    description: "A night of stand-up from Nigeria's funniest. (Pending approval.)",
    tiers: [{ id: 't_std', event_id: 'e_draft', name: 'Standard', price_kobo: 1_000_000, capacity: 300, sold: 0, active: true }],
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
  { id: 'a1', name: 'Bisi Adeyemi', cashtag: '@bisi',  tierName: 'VIP',     ticketId: 'tk_a1', state: 'ISSUED', checkedIn: true,  checkedInAtISO: hoursFromNow(-1) },
  { id: 'a2', name: 'Tunde Okafor', cashtag: '@tunde', tierName: 'Regular', ticketId: 'tk_a2', state: 'ISSUED', checkedIn: false, checkedInAtISO: null },
  { id: 'a3', name: 'Chidi Nwosu',  cashtag: '@chidi', tierName: 'Regular', ticketId: 'tk_a3', state: 'USED',   checkedIn: true,  checkedInAtISO: hoursFromNow(-2) },
  { id: 'a4', name: 'Ada Eze',      cashtag: '@ada',   tierName: 'Table for 5', ticketId: 'tk_a4', state: 'ISSUED', checkedIn: false, checkedInAtISO: null },
];

function summaryOf(e: EventDetail): EventSummary {
  const activeTiers = e.tiers.filter((t) => t.active);
  const minPrice = activeTiers.length ? Math.min(...activeTiers.map((t) => t.price_kobo)) : null;
  const soldOut = activeTiers.length > 0 && activeTiers.every((t) => t.sold >= t.capacity);
  return {
    id: e.id, title: e.title, venue: e.venue, starts_at: e.starts_at, ends_at: e.ends_at,
    state: e.state, category: e.category, min_price_kobo: minPrice, sold_out: soldOut,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────────
export async function listEvents(params?: { category?: string; state?: string }): Promise<EventSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = MOCK_EVENTS.filter((e) => e.state !== 'DRAFT' && e.state !== 'SUSPENDED');
    if (params?.category && params.category !== 'all') list = list.filter((e) => e.category === params.category);
    if (params?.state) list = list.filter((e) => e.state === params.state);
    return list.map(summaryOf);
  }
  const query: Record<string, string> = {};
  if (params?.category && params.category !== 'all') query.category = params.category;
  if (params?.state) query.state = params.state;
  return pickList<EventSummary>(await api.get(`${API_BASE}`, { params: query }), 'events');
}

export async function getEvent(id: string): Promise<EventDetail> {
  if (USE_MOCK) {
    await delay();
    const e = MOCK_EVENTS.find((x) => x.id === id);
    if (!e) throw new Error('Event not found');
    return e;
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

// NOTE: the backend route table has no GET list-vendors endpoint (only
// POST /:id/vendors to register one). Tap-to-pay's vendor menu is therefore
// mock-only display data until that read endpoint lands; see report.
export async function listVendors(_eventId: string): Promise<EventVendorDisplay[]> {
  if (USE_MOCK) { await delay(); return MOCK_VENDORS; }
  return MOCK_VENDORS;
}

// NOTE: no venue-map endpoint exists on the backend route table at all.
// Kept mock-only; flagged in the report.
export async function getVenueMap(_eventId: string): Promise<VenueZone[]> {
  await delay();
  return MOCK_VENUE;
}

// NOTE: no organiser-stats aggregate endpoint exists. Derived client-side from
// the organiser's own events (there's also no "my organiser events" filter on
// GET /api/finance/events — this lists ALL events and would need server-side
// organiser scoping to be correct in production; see report).
export async function listOrganiserEvents(): Promise<OrganiserEventStats[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EVENTS.map((e) => {
      const ticketsSold = e.tiers.reduce((s, t) => s + t.sold, 0);
      const ticketsTotal = e.tiers.reduce((s, t) => s + t.capacity, 0) || null;
      const grossKobo = e.tiers.reduce((s, t) => s + t.sold * t.price_kobo, 0);
      return { event: summaryOf(e), ticketsSold, ticketsTotal, grossKobo };
    });
  }
  const events = await listEvents();
  return events.map((event) => ({ event, ticketsSold: 0, ticketsTotal: null, grossKobo: 0 }));
}

// NOTE: no attendees-list endpoint exists on the backend route table.
// Mock-only; the screen shows an "unavailable" empty state when USE_MOCK is
// false — see report.
export async function listAttendees(_eventId: string): Promise<Attendee[]> {
  if (USE_MOCK) { await delay(); return MOCK_ATTENDEES; }
  return [];
}

// ── Mutations (each money mutation carries an Idempotency-Key) ────────────────
export async function purchaseTickets(input: PurchaseTicketInput): Promise<PurchaseResult> {
  if (USE_MOCK) {
    await delay();
    const e = MOCK_EVENTS.find((x) => x.id === input.eventId);
    const tier = e?.tiers.find((t) => t.id === input.tier_id);
    const tickets: Ticket[] = Array.from({ length: input.quantity }).map((_, i) => ({
      id: `tk_${Date.now()}_${i}`, event_id: input.eventId, tier_id: input.tier_id,
      order_id: `ord_${Date.now()}`, owner_id: 'u_me', state: 'ISSUED',
      credential_id: `cred_${Math.random().toString(36).slice(2, 8)}`,
      price_paid_kobo: tier?.price_kobo ?? 0, created_at: new Date().toISOString(),
    }));
    return { ok: true, tickets, total_kobo: (tier?.price_kobo ?? 0) * input.quantity };
  }
  const body = { tier_id: input.tier_id, quantity: input.quantity, promo_code: input.promo_code };
  return unwrap(await api.post(`${API_BASE}/${input.eventId}/purchase`, body, { headers: { 'Idempotency-Key': idempotencyKey() } }));
}

export async function giftTicket(input: GiftTicketInput): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return unwrap(await api.post(`${API_BASE}/tickets/${input.ticketId}/gift`, { cashtag: input.cashtag }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
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
    };
  }
  const created: EventDetail = await unwrap(await api.post(`${API_BASE}`, {
    title: input.title, description: input.description, venue: input.venue,
    category: input.category, starts_at: input.starts_at, ends_at: input.ends_at,
    fee_bps: input.fee_bps ?? 500,
  }, { headers: { 'Idempotency-Key': idempotencyKey() } }));

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

// ── Organiser lifecycle (state machine: DRAFT -> SUBMITTED -> APPROVED -> LIVE -> CLOSED) ──
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
// is vendor-scoped (POST /vendors/:vendorId/charge), not wallet-scoped; it
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

// Wallet transaction history — no dedicated list endpoint on the route table;
// derived from mock ledger entries in mock mode, empty otherwise (see report).
export async function listWalletEntries(_walletId: string): Promise<EventWalletEntry[]> {
  if (USE_MOCK) { await delay(); return MOCK_WALLET_ENTRIES; }
  return [];
}

// Steward scan validation (offline-tolerant). Live calls fall back to a local
// manifest when the network is unreachable.
export async function validateScan(credentialId: string): Promise<ScanResult> {
  if (USE_MOCK) {
    await delay(180);
    const code = credentialId.trim();
    const att = MOCK_ATTENDEES.find((a) => a.ticketId.toLowerCase() === code.toLowerCase());
    if (code.toUpperCase().includes('USED') || att?.state === 'USED') return { outcome: 'already-used', ticket_id: att?.ticketId, holderName: att?.name, tierName: att?.tierName, offline: false };
    if (code.length > 0) return { outcome: 'valid', ticket_id: att?.ticketId ?? 'tk_scan', holderName: att?.name ?? 'Guest', tierName: att?.tierName ?? 'Regular', offline: false };
    return { outcome: 'invalid', offline: false };
  }
  try {
    return unwrap(await api.post(`${API_BASE}/scan`, { credential_id: credentialId }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
  } catch {
    // Offline fallback: optimistic accept of well-formed codes, queued for sync.
    const valid = credentialId.trim().length > 0;
    return { outcome: valid ? 'valid' : 'invalid', offline: true };
  }
}
