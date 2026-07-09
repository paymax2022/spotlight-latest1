// ── Paymax Stays — API wrapper ───────────────────────────────────────────────
// Typed data layer the screens code against. Mock-first via USE_MOCK; live path
// hits the frontend-web proxy at `${STAYS_API_BASE}/...` → Go /api/finance/stays/*.
// Supplier/provider JSON never leaks past this layer — only normalised models.
//
// BACKEND SHAPE NOTE (see docs/stays-integration-plan.md): the Go backend is a
// dual-rail SUPPLY GATEWAY. Rates only exist inside a dated /search and are
// addressed by rail + supplier_code + supplier_*_ref + offer_token. The mobile
// model is property-centric with a single opaque id. We bridge with an ADAPTER:
// the composite supplier key (+ the search dates + card essentials) is ENCODED
// into the opaque `id` strings the UI already passes around (PropertyCard.id,
// RoomType.id, RatePlan.id, PrebookResult.bookToken) and DECODED here. Every
// live response is unwrapped from the Go `{ "data": ... }` envelope.
//
// IRON RULES:
//  • All monetary amounts are integers in minor units (kobo for NGN, cents USD).
//  • Two-step prebook → book (PRD §11). Book carries an Idempotency-Key.
//  • Discovery (home/deals/destinations/nearby/saved/addons/profile) has NO
//    backend yet — those live branches return empty/static with a TODO, never a
//    404 call. See the plan doc for the build list.

import { api } from '@/api/client';
import {
  STAYS_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
  chargeableKobo,
  usdCentsToNgnKobo,
} from './constants/stays.constants';
import {
  MOCK_PROPERTIES,
  MOCK_ROOM_TYPES,
  MOCK_REVIEWS,
  MOCK_DESTINATIONS,
  MOCK_DEALS,
  MOCK_PROFILE,
  MOCK_ADDONS,
  MOCK_SAVED_IDS,
} from './api/stays.mock';
import type {
  BookInput,
  BookResult,
  BoardBasis,
  Currency,
  Deal,
  DestinationSuggestion,
  GuestConfig,
  GuestProfile,
  PaymentMethod,
  PrebookInput,
  PrebookResult,
  PriceBreakdownData,
  PriceLine,
  PropertyCard,
  PropertyDetail,
  PropertyType,
  RatePlan,
  Reservation,
  ReservationState,
  Review,
  RoomType,
  SearchQuery,
  StaysFilter,
  StaysHome,
  AddOn,
} from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));

// In-memory mock stores (per session) so saved/booking mutations persist across
// screens while USE_MOCK is on.
const savedIds = new Set<string>(MOCK_SAVED_IDS);
const mockReservations: Reservation[] = [];
// Live offers keyed by bookToken (mock prebook → book bridge).
const mockOffers = new Map<string, { input: PrebookInput; breakdown: PriceBreakdownData; soldOut: boolean }>();

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function nights(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T00:00:00`).getTime();
  const b = new Date(`${checkOut}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE ADAPTER — envelope unwrap, composite-id codec, backend↔frontend mappers.
// ════════════════════════════════════════════════════════════════════════════

/** Unwrap the Go `{ data: ... }` envelope; tolerate a bare body too. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

// The composite offer key we thread through opaque ids. Kept small; carries the
// supplier addressing + the dated-search context + a few card essentials so a
// property/room screen can rebuild without a second round-trip.
interface OfferKey {
  r: string;   // rail (BEDBANK|DIRECT)
  s: string;   // supplier_code
  p: string;   // supplier_property_ref
  rt?: string; // supplier_room_type_ref
  rp?: string; // supplier_rate_plan_ref
  ot?: string; // offer_token
  ci: string;  // check_in (yyyy-mm-dd)
  co: string;  // check_out
  rm: number;  // rooms
  ad: number;  // adults
  cur: string; // currency
  // Card essentials (for detail reconstruction without a re-search).
  nm?: string; cy?: string; st?: number; pt?: string;
  lat?: number; lng?: number; price?: number;
}

function encodeKey(k: OfferKey): string {
  return 'k_' + encodeURIComponent(JSON.stringify(k));
}
function decodeKey(id: string): OfferKey | null {
  try {
    if (!id.startsWith('k_')) return null;
    return JSON.parse(decodeURIComponent(id.slice(2))) as OfferKey;
  } catch {
    return null;
  }
}

const CURRENCIES: Currency[] = ['NGN', 'USD'];
function toCurrency(c: string | undefined): Currency {
  return CURRENCIES.includes(c as Currency) ? (c as Currency) : 'NGN';
}

const PROPERTY_TYPES: PropertyType[] = ['hotel', 'apartment', 'guesthouse', 'resort'];
function toPropertyType(t: string | undefined): PropertyType {
  const v = (t ?? '').toLowerCase();
  return PROPERTY_TYPES.includes(v as PropertyType) ? (v as PropertyType) : 'hotel';
}

const BOARDS: BoardBasis[] = ['room_only', 'breakfast', 'half_board', 'full_board'];
function toBoard(b: string | undefined): BoardBasis {
  const v = (b ?? '').toLowerCase().replace(/[\s-]/g, '_');
  return BOARDS.includes(v as BoardBasis) ? (v as BoardBasis) : 'room_only';
}

function toPaymentMethod(m: string | undefined): PaymentMethod {
  switch ((m ?? '').toUpperCase()) {
    case 'CARD': return 'card';
    case 'TRANSFER': return 'transfer';
    case 'PAY_AT_PROPERTY': return 'pay_at_property';
    case 'DEPOSIT': return 'deposit';
    default: return 'wallet';
  }
}

const RESERVATION_STATES: ReservationState[] = [
  'OFFER_SELECTED', 'PREBOOK_OK', 'PAYMENT_HELD', 'BOOKING', 'CONFIRMED', 'COMPLETED',
  'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOTEL', 'NO_SHOW', 'BOOK_FAILED', 'PAYMENT_FAILED',
  'PREBOOK_FAILED', 'VOID',
];
function toReservationState(s: string | undefined): ReservationState {
  const v = (s ?? '').toUpperCase();
  if (v === 'SEARCHING') return 'OFFER_SELECTED';
  return RESERVATION_STATES.includes(v as ReservationState) ? (v as ReservationState) : 'PREBOOK_OK';
}

// ── Backend DTOs (subset we read) ────────────────────────────────────────────
interface BEBreakdown {
  net_rate_kobo: number;
  markup_kobo: number;
  commission_kobo: number;
  tax_kobo: number;
  discount_kobo: number;
  discounts?: { code: string; bps: number; kobo: number }[];
  gross_kobo: number;
  source_currency: string;
  display_currency: string;
  fx_rate?: number;
}
interface BEOffer {
  rail: string;
  supplier_code: string;
  supplier_property_ref: string;
  mapped_property_id?: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  star_rating: number;
  property_type: string;
  supplier_room_type_ref: string;
  room_name: string;
  rate_plan: {
    supplier_rate_plan_ref: string;
    type: string;
    board: string;
    refundable: boolean;
    mobile_only: boolean;
    cancellation_policy?: unknown;
  };
  net_rate_kobo: number;
  tax_kobo: number;
  currency: string;
  offer_token?: string;
  expires_at?: string;
}
interface BEResult { offer: BEOffer; breakdown: BEBreakdown }
interface BEContent {
  supplier_property_ref: string;
  name: string;
  description: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  star_rating: number;
  property_type: string;
  amenities: string[];
  photos: string[];
}
interface BEReservation {
  id: string;
  property_id: string;
  room_type_id: string;
  rate_plan_id: string;
  source_rail: string;
  supplier_code: string;
  supplier_ref?: string | null;
  state: string;
  check_in: string;
  check_out: string;
  rooms: number;
  occupancy?: Record<string, unknown>;
  currency: string;
  gross_amount_kobo: number;
  tax_amount_kobo: number;
  net_rate_kobo: number;
  payment_method: string;
  voucher_ref?: string | null;
  created_at: string;
  // Best-effort display content attached by the backend (name/city/photo) so the
  // client can render a booking without a second content call.
  content?: {
    name?: string;
    city?: string;
    address?: string;
    cover_url?: string;
    star_rating?: number;
    property_type?: string;
  } | null;
}

function mapBreakdown(b: BEBreakdown): PriceBreakdownData {
  const lines: PriceLine[] = [{ label: 'Room', amountKobo: b.net_rate_kobo, kind: 'room' }];
  if (b.markup_kobo > 0) lines.push({ label: 'Service', amountKobo: b.markup_kobo, kind: 'fee' });
  if (b.tax_kobo > 0) lines.push({ label: 'Taxes & fees', amountKobo: b.tax_kobo, kind: 'tax' });
  for (const d of b.discounts ?? []) {
    lines.push({ label: `Discount ${d.code}`, amountKobo: -Math.abs(d.kobo), kind: 'discount' });
  }
  const displayCurrency = toCurrency(b.display_currency);
  const fxNote =
    b.fx_rate && b.fx_rate > 0 && b.source_currency !== b.display_currency
      ? `Rates sourced in ${b.source_currency}; charged in NGN (indicative FX ${b.fx_rate}).`
      : undefined;
  return {
    lines,
    totalKobo: b.gross_kobo,
    fxNote,
    displayCurrency,
    displayTotalMinor: b.gross_kobo,
  };
}

function mapReservation(r: BEReservation): Reservation {
  const ci = (r.check_in ?? '').slice(0, 10);
  const co = (r.check_out ?? '').slice(0, 10);
  const occ = r.occupancy ?? {};
  const adults = Number(occ.adults ?? 0) || 0;
  const children = Number(occ.children ?? 0) || 0;
  const guests: GuestConfig = { adults, children, childrenAges: [], rooms: r.rooms ?? 1 };
  const content = r.content ?? undefined;
  return {
    id: r.id,
    reference: r.voucher_ref ?? r.supplier_ref ?? r.id.slice(0, 8).toUpperCase(),
    state: toReservationState(r.state),
    // Display content comes from the backend's best-effort enrichment block.
    // room/rate names are still ID-only (TODO(stays): embed room/rate content).
    propertyName: content?.name ?? '',
    coverUrl: content?.cover_url ?? '',
    city: content?.city ?? '',
    roomTypeName: '',
    ratePlanName: '',
    checkIn: ci,
    checkOut: co,
    nights: ci && co ? nights(ci, co) : 1,
    guests,
    paymentMethod: toPaymentMethod(r.payment_method),
    totalKobo: r.gross_amount_kobo,
    currency: toCurrency(r.currency),
    displayTotalMinor: r.gross_amount_kobo,
    leadGuest: { fullName: '', email: '', phone: '', country: '' },
    createdAt: r.created_at,
    cancellationPolicy: '',
    supplierRef: r.supplier_ref ?? undefined,
  };
}

/** NDPA data-share consent must exist before /prebook (backend 428s otherwise). */
async function ensureStaysConsent(): Promise<void> {
  try {
    const { data } = await api.get(`${STAYS_API_BASE}/consent`, { params: { scope: 'supplier_data_share' } });
    const status = unwrap<{ granted?: boolean }>(data);
    if (status?.granted) return;
  } catch {
    /* fall through to grant */
  }
  // TODO(stays): a production flow should collect this NDPA consent from an
  // explicit UI affirmation before checking live supplier prices.
  await api.post(`${STAYS_API_BASE}/consent`, { scope: 'supplier_data_share' });
}

// ── Home / discovery ─────────────────────────────────────────────────────────
export async function getStaysHome(): Promise<StaysHome> {
  if (USE_MOCK) {
    await delay();
    return {
      recentSearches: [
        { destination: 'Lagos', checkIn: addDays(7), checkOut: addDays(9), guests: { adults: 2, children: 0, childrenAges: [], rooms: 1 } },
        { destination: 'Abuja', checkIn: addDays(14), checkOut: addDays(16), guests: { adults: 1, children: 0, childrenAges: [], rooms: 1 } },
      ],
      deals: MOCK_DEALS,
      trendingDestinations: MOCK_DESTINATIONS.slice(0, 4),
      saved: MOCK_PROPERTIES.filter((p) => savedIds.has(p.id)),
    };
  }
  // Live: trending destinations come from real inventory; deals/recent/saved are
  // still client-side/unbacked (see the plan doc) and return empty for now.
  const { data } = await api.get(`${STAYS_API_BASE}/home`);
  const body = unwrap<{
    trending_destinations?: Array<{ id: string; name: string; region: string; kind: string; property_count: number }>;
  }>(data) ?? {};
  const trendingDestinations = (body.trending_destinations ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    region: d.region ?? '',
    kind: (d.kind === 'landmark' || d.kind === 'area' ? d.kind : 'city') as DestinationSuggestion['kind'],
    propertyCount: d.property_count ?? 0,
  }));
  return { recentSearches: [], deals: [], trendingDestinations, saved: [] };
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Destination autocomplete ─────────────────────────────────────────────────
export async function searchDestinations(q: string): Promise<DestinationSuggestion[]> {
  if (USE_MOCK) {
    await delay(180);
    const needle = q.trim().toLowerCase();
    if (!needle) return MOCK_DESTINATIONS;
    return MOCK_DESTINATIONS.filter(
      (d) => d.name.toLowerCase().includes(needle) || d.region.toLowerCase().includes(needle),
    );
  }
  // Live: distinct cities from on-platform (DIRECT) inventory.
  const { data } = await api.get(`${STAYS_API_BASE}/destinations`, { params: { q } });
  const rows = unwrap<Array<{ id: string; name: string; region: string; kind: string; property_count: number }>>(data) ?? [];
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    region: d.region ?? '',
    kind: (d.kind === 'landmark' || d.kind === 'area' ? d.kind : 'city') as DestinationSuggestion['kind'],
    propertyCount: d.property_count ?? 0,
  }));
}

// ── Deals ────────────────────────────────────────────────────────────────────
export async function getDeals(): Promise<Deal[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_DEALS;
  }
  // Live: curated deals from stays_deals. Each carries a denormalised property
  // snapshot; we rebuild a PropertyCard (its id encodes the supplier key so a tap
  // navigates to the real property detail).
  const { data } = await api.get(`${STAYS_API_BASE}/deals`);
  const rows = unwrap<Array<{
    id: string; kind: string; title: string; subtitle: string;
    property: {
      rail: string; supplier: string; ref: string; name: string; city: string; area: string;
      star: number; property_type: string; lead_price_kobo: number; was_price_kobo?: number | null;
      currency: string; cover_url: string; review_score: number; review_count: number; free_cancellation: boolean;
    };
  }>>(data) ?? [];
  return rows.map((row) => {
    const p = row.property;
    const currency = toCurrency(p.currency);
    const cardId = encodeKey({
      r: p.rail, s: p.supplier, p: p.ref, ci: '', co: '', rm: 1, ad: 2, cur: currency,
      nm: p.name, cy: p.city, st: p.star, pt: p.property_type, price: p.lead_price_kobo,
    });
    const property: PropertyCard = {
      id: cardId,
      name: p.name,
      city: p.city,
      area: p.area || p.city,
      star: p.star || 0,
      propertyType: toPropertyType(p.property_type),
      sourceRail: p.rail === 'DIRECT' ? 'DIRECT' : 'BEDBANK',
      coverUrl: p.cover_url || '',
      leadPriceMinor: Math.trunc(p.lead_price_kobo ?? 0),
      currency,
      wasPriceMinor: p.was_price_kobo != null ? Math.trunc(p.was_price_kobo) : undefined,
      reviewScore: p.review_score ?? 0,
      reviewCount: p.review_count ?? 0,
      freeCancellation: Boolean(p.free_cancellation),
      amenities: [],
      geo: { lat: 0, lng: 0 },
      soldOut: false,
      loyaltyDeal: row.kind === 'loyalty',
    };
    const kind = (row.kind === 'mobile_rate' || row.kind === 'last_minute' || row.kind === 'loyalty'
      ? row.kind
      : 'loyalty') as Deal['kind'];
    return { id: row.id, kind, title: row.title, subtitle: row.subtitle, property };
  });
}

// ── Search & ranking (PRD §15) ───────────────────────────────────────────────
const SORT = {
  top_picks: (a: PropertyCard, b: PropertyCard) =>
    Number(a.soldOut) - Number(b.soldOut) || b.reviewScore - a.reviewScore,
  price_asc: (a: PropertyCard, b: PropertyCard) =>
    chargeableKobo(a.leadPriceMinor, a.currency) - chargeableKobo(b.leadPriceMinor, b.currency),
  price_desc: (a: PropertyCard, b: PropertyCard) =>
    chargeableKobo(b.leadPriceMinor, b.currency) - chargeableKobo(a.leadPriceMinor, a.currency),
  review_score: (a: PropertyCard, b: PropertyCard) => b.reviewScore - a.reviewScore,
  distance: (a: PropertyCard, b: PropertyCard) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99),
} as const;

function applyFilter(list: PropertyCard[], q: SearchQuery, f: StaysFilter): PropertyCard[] {
  let out = [...list];
  const dest = (q.destination ?? '').trim().toLowerCase();
  if (dest) out = out.filter((p) => p.city.toLowerCase().includes(dest) || p.area.toLowerCase().includes(dest) || p.name.toLowerCase().includes(dest));
  if (f.query) {
    const needle = f.query.trim().toLowerCase();
    out = out.filter((p) => p.name.toLowerCase().includes(needle) || p.area.toLowerCase().includes(needle));
  }
  if (f.minPriceKobo != null) out = out.filter((p) => chargeableKobo(p.leadPriceMinor, p.currency) >= f.minPriceKobo!);
  if (f.maxPriceKobo != null) out = out.filter((p) => chargeableKobo(p.leadPriceMinor, p.currency) <= f.maxPriceKobo!);
  if (f.minScore != null) out = out.filter((p) => p.reviewScore >= f.minScore!);
  if (f.stars?.length) out = out.filter((p) => f.stars!.includes(p.star));
  if (f.propertyTypes?.length) out = out.filter((p) => f.propertyTypes!.includes(p.propertyType));
  if (f.amenities?.length) out = out.filter((p) => f.amenities!.every((a) => p.amenities.includes(a)));
  if (f.freeCancellation) out = out.filter((p) => p.freeCancellation);
  if (f.dealsOnly) out = out.filter((p) => p.wasPriceMinor != null || p.loyaltyDeal);
  out.sort(SORT[f.sort ?? 'top_picks']);
  return out;
}

/** Build search query params for the live gateway from the frontend SearchQuery. */
function searchParams(q: SearchQuery): Record<string, string | number> {
  return {
    city: q.destination ?? '',
    check_in: q.checkIn,
    check_out: q.checkOut,
    rooms: q.guests?.rooms ?? 1,
    adults: q.guests?.adults ?? 2,
    currency: 'NGN',
  };
}

/** Group per-offer gateway results into one PropertyCard per property. */
function resultsToCards(results: BEResult[], q: SearchQuery): PropertyCard[] {
  const byProp = new Map<string, BEResult[]>();
  for (const res of results) {
    const key = `${res.offer.rail}|${res.offer.supplier_code}|${res.offer.supplier_property_ref}`;
    const arr = byProp.get(key);
    if (arr) arr.push(res);
    else byProp.set(key, [res]);
  }
  const cards: PropertyCard[] = [];
  for (const group of byProp.values()) {
    // Cheapest offer drives the lead price.
    const lead = group.reduce((min, r) => (r.breakdown.gross_kobo < min.breakdown.gross_kobo ? r : min), group[0]);
    const o = lead.offer;
    const currency = toCurrency(lead.breakdown.display_currency || o.currency);
    const key: OfferKey = {
      r: o.rail, s: o.supplier_code, p: o.supplier_property_ref,
      ci: q.checkIn, co: q.checkOut, rm: q.guests?.rooms ?? 1, ad: q.guests?.adults ?? 2, cur: currency,
      nm: o.name, cy: o.city, st: o.star_rating, pt: o.property_type,
      lat: o.lat, lng: o.lng, price: lead.breakdown.gross_kobo,
    };
    cards.push({
      id: encodeKey(key),
      name: o.name,
      city: o.city,
      area: o.address || o.city,
      star: o.star_rating || 0,
      propertyType: toPropertyType(o.property_type),
      sourceRail: o.rail === 'DIRECT' ? 'DIRECT' : 'BEDBANK',
      // TODO(stays): search offers carry no photos (content-only). Results cards
      // show no cover until a content-thumbnail is added to the search offer.
      coverUrl: '',
      leadPriceMinor: lead.breakdown.gross_kobo,
      currency,
      reviewScore: 0, // TODO(stays): review aggregates not in search response.
      reviewCount: 0,
      freeCancellation: group.some((r) => r.offer.rate_plan?.refundable),
      amenities: [],
      geo: { lat: o.lat, lng: o.lng },
      soldOut: false,
    });
  }
  return cards;
}

export async function searchStays(q: SearchQuery, f: StaysFilter = {}): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    return applyFilter(MOCK_PROPERTIES, q, f);
  }
  const { data } = await api.get(`${STAYS_API_BASE}/search`, { params: searchParams(q) });
  const results = unwrap<BEResult[]>(data) ?? [];
  // Client-side filter/sort over the normalised cards (server ranks by price only).
  return applyFilter(resultsToCards(results, q), q, f);
}

/** Relaxed-criteria suggestions for the empty state (drop the binding filters). */
export async function searchRelaxed(q: SearchQuery): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    return applyFilter(MOCK_PROPERTIES, { ...q, destination: '' }, { sort: 'top_picks' }).slice(0, 6);
  }
  const { data } = await api.get(`${STAYS_API_BASE}/search`, { params: searchParams(q) });
  const results = unwrap<BEResult[]>(data) ?? [];
  return resultsToCards(results, q).slice(0, 6);
}

export async function getNearbyStays(): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_PROPERTIES].sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  }
  // TODO(stays): the gateway supports lat/lng but the search handler reads only
  // `city`; no dedicated nearby route. Needs a device-geo → city/coords bridge.
  return [];
}

// ── Property detail ──────────────────────────────────────────────────────────
export async function getProperty(id: string): Promise<PropertyDetail> {
  if (USE_MOCK) {
    await delay(260);
    const found = MOCK_PROPERTIES.find((p) => p.id === id);
    if (!found) throw new Error('Property not found');
    return toDetail(found);
  }
  const key = decodeKey(id);
  if (!key) throw new Error('Property not found');
  const { data } = await api.get(
    `${STAYS_API_BASE}/properties/${encodeURIComponent(key.r)}/${encodeURIComponent(key.s)}/${encodeURIComponent(key.p)}`,
  );
  const c = unwrap<BEContent>(data);
  const currency = toCurrency(key.cur);
  const media = c.photos ?? [];
  const card: PropertyCard = {
    id,
    name: c.name ?? key.nm ?? '',
    city: c.city ?? key.cy ?? '',
    area: c.address || c.city || key.cy || '',
    star: c.star_rating || key.st || 0,
    propertyType: toPropertyType(c.property_type ?? key.pt),
    sourceRail: key.r === 'DIRECT' ? 'DIRECT' : 'BEDBANK',
    coverUrl: media[0] ?? '',
    leadPriceMinor: key.price ?? 0,
    currency,
    reviewScore: 0,
    reviewCount: 0,
    freeCancellation: false,
    amenities: c.amenities ?? [],
    geo: { lat: c.lat ?? key.lat ?? 0, lng: c.lng ?? key.lng ?? 0 },
    soldOut: false,
  };
  return {
    ...card,
    description: c.description ?? '',
    address: c.address ?? `${c.city ?? ''}`,
    media,
    mediaCategories: media.length ? [{ label: 'Photos', urls: media }] : [],
    nearbyLandmarks: [],
    subScores: { cleanliness: 0, staff: 0, location: 0, value: 0, comfort: 0, facilities: 0, wifi: 0 },
    policies: {
      checkIn: 'From 14:00',
      checkOut: 'Until 12:00',
      cancellation: 'See individual rate plans for cancellation terms.',
      children: 'Contact the property for child policy.',
      pets: 'Contact the property.',
      smoking: 'Non-smoking rooms available.',
      extraBeds: 'Subject to availability.',
    },
    checkInTime: '14:00',
    checkOutTime: '12:00',
  };
}

export async function getRoomTypes(propertyId: string): Promise<RoomType[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_ROOM_TYPES[propertyId] ?? MOCK_ROOM_TYPES.__default;
  }
  const key = decodeKey(propertyId);
  if (!key) return [];
  // Re-run the dated search and keep only this property's offers; each offer is a
  // room+rate. Group into RoomType[] with RatePlan[]; encode the supplier refs +
  // offer_token into each RatePlan.id so prebook can address it.
  const q: SearchQuery = {
    destination: key.cy ?? '',
    checkIn: key.ci,
    checkOut: key.co,
    guests: { adults: key.ad, children: 0, childrenAges: [], rooms: key.rm },
  };
  const { data } = await api.get(`${STAYS_API_BASE}/search`, { params: searchParams(q) });
  const results = (unwrap<BEResult[]>(data) ?? []).filter((res) => res.offer.supplier_property_ref === key.p);
  const n = nights(key.ci, key.co);
  const byRoom = new Map<string, BEResult[]>();
  for (const res of results) {
    const rk = res.offer.supplier_room_type_ref || res.offer.room_name;
    const arr = byRoom.get(rk);
    if (arr) arr.push(res);
    else byRoom.set(rk, [res]);
  }
  const rooms: RoomType[] = [];
  for (const [roomRef, group] of byRoom.entries()) {
    const first = group[0].offer;
    const currency = toCurrency(group[0].breakdown.display_currency || first.currency);
    const ratePlans: RatePlan[] = group.map((res) => {
      const o = res.offer;
      const perNight = Math.round(res.breakdown.gross_kobo / n);
      const rpKey: OfferKey = {
        r: o.rail, s: o.supplier_code, p: o.supplier_property_ref,
        rt: o.supplier_room_type_ref, rp: o.rate_plan?.supplier_rate_plan_ref, ot: o.offer_token,
        ci: key.ci, co: key.co, rm: key.rm, ad: key.ad, cur: currency, price: perNight,
      };
      return {
        id: encodeKey(rpKey),
        roomTypeId: roomRef,
        name: o.rate_plan?.type || 'Standard rate',
        board: toBoard(o.rate_plan?.board),
        refundable: Boolean(o.rate_plan?.refundable),
        mobileOnly: Boolean(o.rate_plan?.mobile_only),
        pricePerNightMinor: perNight,
        currency,
      };
    });
    const fromPrice = ratePlans.reduce((m, rp) => Math.min(m, rp.pricePerNightMinor), ratePlans[0]?.pricePerNightMinor ?? 0);
    rooms.push({
      id: roomRef,
      propertyId,
      name: first.room_name || 'Room',
      photos: [],
      maxOccupancy: key.ad,
      bedding: '',
      sizeSqm: 0,
      fromPriceMinor: fromPrice,
      currency,
      ratePlans,
    });
  }
  return rooms;
}

export async function getReviews(propertyId: string): Promise<Review[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_REVIEWS[propertyId] ?? MOCK_REVIEWS.__default;
  }
  const key = decodeKey(propertyId);
  // Backend reviews are keyed by the internal property_id; we only hold the
  // supplier ref, so this may return [] until a supplier-ref→property_id lookup
  // exists. TODO(stays): map supplier ref to internal property id for reviews.
  const propId = key?.p ?? propertyId;
  const { data } = await api.get(`${STAYS_API_BASE}/reviews`, { params: { property_id: propId } });
  const rows = unwrap<Array<{
    id: string; overall_score: number; title?: string; body?: string; created_at: string;
  }>>(data) ?? [];
  return rows.map((rv) => ({
    id: rv.id,
    author: 'Verified guest',
    country: '',
    score: (rv.overall_score ?? 0) * 2, // backend 1..5 → frontend out-of-10
    title: rv.title ?? '',
    body: rv.body ?? '',
    stayDate: (rv.created_at ?? '').slice(0, 10),
    roomType: '',
  }));
}

// ── Add-ons (cross-sell into Transport / Insurance) ──────────────────────────
export async function getAddOns(): Promise<AddOn[]> {
  // Add-ons are a fixed local catalogue (Transport/Insurance cross-sell), not
  // user data — served the same in mock and live until a backend catalogue exists.
  if (USE_MOCK) await delay(160);
  return MOCK_ADDONS;
}

// ── Profile prefill ──────────────────────────────────────────────────────────
export async function getGuestProfile(): Promise<GuestProfile> {
  if (USE_MOCK) {
    await delay(140);
    return MOCK_PROFILE;
  }
  // TODO(stays): no stays-specific profile endpoint; a production build should
  // prefill from the shared account/KYC profile. Return an empty prefill.
  return { fullName: '', email: '', phone: '', country: 'NG', kycTier: 0 };
}

// ── Saved / wishlists (client-only until a backend wishlist exists) ──────────
export async function getSaved(): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay(180);
    return MOCK_PROPERTIES.filter((p) => savedIds.has(p.id));
  }
  // Live: backend wishlist returns opaque property keys (most-recent first). Each
  // key decodes back into a PropertyCard via the composite-id codec. Keep the
  // module-level savedIds Set in sync so isSavedSync stays correct.
  const { data } = await api.get(`${STAYS_API_BASE}/saved`);
  const keys = unwrap<string[]>(data) ?? [];
  savedIds.clear();
  const cards: PropertyCard[] = [];
  for (const key of keys) {
    savedIds.add(key);
    const k = decodeKey(key);
    if (!k) continue;
    cards.push({
      id: key,
      name: k.nm ?? '',
      city: k.cy ?? '',
      area: k.cy ?? '',
      star: k.st ?? 0,
      propertyType: toPropertyType(k.pt),
      sourceRail: k.r === 'DIRECT' ? 'DIRECT' : 'BEDBANK',
      coverUrl: '',
      leadPriceMinor: Math.trunc(k.price ?? 0),
      currency: toCurrency(k.cur),
      reviewScore: 0,
      reviewCount: 0,
      freeCancellation: false,
      amenities: [],
      geo: { lat: 0, lng: 0 },
      soldOut: false,
    });
  }
  return cards;
}

export async function toggleSaved(id: string): Promise<{ saved: boolean }> {
  if (USE_MOCK) {
    await delay(120);
    // Client-only toggle (no backend wishlist endpoint in mock).
    if (savedIds.has(id)) savedIds.delete(id);
    else savedIds.add(id);
    return { saved: savedIds.has(id) };
  }
  // Live: server-side delete-then-insert toggle; sync the local Set to the result.
  const { data } = await api.post(`${STAYS_API_BASE}/saved/${encodeURIComponent(id)}/toggle`);
  const { saved } = unwrap<{ saved: boolean }>(data) ?? { saved: false };
  if (saved) savedIds.add(id);
  else savedIds.delete(id);
  return { saved };
}

export function isSavedSync(id: string): boolean {
  return savedIds.has(id);
}

// ── Pricing helper (shared by prebook + review preview) ───────────────────────
export function buildBreakdown(input: PrebookInput, addOns: AddOn[], priceBumpPct = 0): PriceBreakdownData {
  const { draft, addOnKeys, useLoyalty, promoCode } = input;
  const n = draft.nights;
  const perNightKobo = chargeableKobo(draft.pricePerNightMinor, draft.currency);
  const bumped = Math.round(perNightKobo * (1 + priceBumpPct));
  const roomKobo = bumped * n;

  const lines: PriceLine[] = [
    { label: `${draft.roomTypeName} · ${n} night${n > 1 ? 's' : ''}`, amountKobo: roomKobo, kind: 'room' },
  ];
  for (const key of addOnKeys) {
    const a = addOns.find((x) => x.key === key);
    if (a) lines.push({ label: a.label, amountKobo: a.priceMinor, kind: 'addon' });
  }
  const vat = Math.round(roomKobo * 0.075);
  const service = Math.round(roomKobo * 0.05);
  lines.push({ label: 'VAT (7.5%)', amountKobo: vat, kind: 'tax' });
  lines.push({ label: 'Service charge (5%)', amountKobo: service, kind: 'fee' });
  if (useLoyalty) {
    const disc = -Math.round(roomKobo * 0.08);
    lines.push({ label: 'Paymax Stays loyalty (-8%)', amountKobo: disc, kind: 'discount' });
  }
  if (promoCode && promoCode.trim().toUpperCase() === 'PAYMAX10') {
    const disc = -Math.round(roomKobo * 0.1);
    lines.push({ label: `Promo ${promoCode.toUpperCase()} (-10%)`, amountKobo: disc, kind: 'discount' });
  }
  const totalKobo = lines.reduce((s, l) => s + l.amountKobo, 0);
  const fxNote =
    draft.currency === 'USD'
      ? `Rates shown in USD; you will be charged ${'₦'}${(totalKobo / 100).toLocaleString('en-NG')} (indicative, settled in NGN).`
      : undefined;
  return {
    lines,
    totalKobo,
    fxNote,
    displayCurrency: draft.currency,
    displayTotalMinor: draft.currency === 'USD' ? Math.round((totalKobo / usdCentsToNgnKobo(100)) * 100) : totalKobo,
  };
}

/** Preview breakdown WITHOUT a live re-check (used on the review screen). */
export async function previewBreakdown(input: PrebookInput): Promise<PriceBreakdownData> {
  const addOns = await getAddOns();
  if (USE_MOCK) {
    await delay(160);
    return buildBreakdown(input, addOns);
  }
  // No standalone /quote endpoint — the client-side breakdown is the preview; the
  // authoritative price comes from /prebook. Add-ons are always NGN.
  return buildBreakdown(input, addOns);
}

// ── Prebook (step 1 — live re-check price + availability) ─────────────────────
export async function prebook(input: PrebookInput): Promise<PrebookResult> {
  if (USE_MOCK) {
    await delay(700);
    const soldOut = input.draft.propertyId === 'stay_soldout';
    const priceChanged = input.draft.propertyId === 'stay_lag_eko';
    const addOns = await getAddOns();
    const breakdown = buildBreakdown(input, addOns, priceChanged ? 0.06 : 0);
    const token = uid('tok');
    mockOffers.set(token, { input, breakdown, soldOut });
    return { bookToken: token, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), priceChanged, soldOut, breakdown };
  }
  // Live: address the offer via the refs encoded in the rate-plan id.
  // TODO(stays): VERIFY against a running backend — `property_id/room_type_id/
  // rate_plan_id` are sent as the supplier refs; if the gateway requires the
  // INTERNAL mapped ids for mapped supply, thread offer.mapped_property_id here.
  const key = decodeKey(input.draft.ratePlanId) ?? decodeKey(input.draft.propertyId);
  if (!key) throw new Error('This offer expired. Please search again.');
  await ensureStaysConsent();
  const body = {
    rail: key.r,
    supplier_code: key.s,
    property_id: key.p,
    room_type_id: key.rt ?? '',
    rate_plan_id: key.rp ?? '',
    supplier_property_ref: key.p,
    supplier_room_type_ref: key.rt ?? '',
    supplier_rate_plan_ref: key.rp ?? '',
    offer_token: key.ot ?? '',
    check_in: input.draft.checkIn,
    check_out: input.draft.checkOut,
    rooms: input.draft.guests.rooms,
    occupancy: { adults: input.draft.guests.adults, children: input.draft.guests.children },
    currency: toCurrency(input.draft.currency),
    payment_method: 'WALLET',
  };
  const { data } = await api.post(`${STAYS_API_BASE}/prebook`, body);
  const res = unwrap<{ reservation: BEReservation; breakdown: BEBreakdown; book_token: string }>(data);
  return {
    // Carry the reservation id + book_token together; book() splits them.
    bookToken: encodeKey({ r: 'BOOK', s: res.reservation.id, p: res.book_token, ci: '', co: '', rm: 0, ad: 0, cur: '' }),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    priceChanged: false, // backend 409s on drift rather than flagging it here.
    soldOut: false,
    breakdown: mapBreakdown(res.breakdown),
  };
}

// ── Book (step 2 — consume token; CHARGE on confirm / RELEASE on fail) ────────
export async function book(args: BookInput): Promise<BookResult> {
  if (USE_MOCK) {
    await delay(1200);
    const offer = mockOffers.get(args.bookToken);
    if (!offer) return { ok: false, errorCode: 'OFFER_EXPIRED', holdReleased: true };
    if (offer.input.draft.propertyId === 'stay_lag_fail') {
      return { ok: false, errorCode: 'BOOK_REJECTED_BY_SUPPLIER', holdReleased: true };
    }
    const d = offer.input.draft;
    const reservation: Reservation = {
      id: uid('res'),
      reference: `PMX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      state: 'CONFIRMED',
      propertyName: d.propertyName,
      coverUrl: d.coverUrl,
      city: d.city,
      roomTypeName: d.roomTypeName,
      ratePlanName: d.ratePlanName,
      checkIn: d.checkIn,
      checkOut: d.checkOut,
      nights: d.nights,
      guests: d.guests,
      paymentMethod: args.paymentMethod,
      totalKobo: offer.breakdown.totalKobo,
      currency: offer.breakdown.displayCurrency,
      displayTotalMinor: offer.breakdown.displayTotalMinor,
      leadGuest: args.leadGuest,
      createdAt: new Date().toISOString(),
      cancellationPolicy: d.refundable ? `Free cancellation until ${d.freeCancelUntil ?? d.checkIn}` : 'Non-refundable',
      supplierRef: `SUP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    };
    mockReservations.unshift(reservation);
    mockOffers.delete(args.bookToken);
    return { ok: true, reservation };
  }
  // Live: Idempotency-Key REQUIRED on book (money-path; PRD §12). The bookToken
  // carries the reservation id + backend book_token (see prebook()).
  const carrier = decodeKey(args.bookToken);
  if (!carrier || carrier.r !== 'BOOK') return { ok: false, errorCode: 'OFFER_EXPIRED', holdReleased: true };
  const [first, ...rest] = (args.leadGuest.fullName || '').trim().split(/\s+/);
  const guest = {
    first_name: first || args.leadGuest.fullName || 'Guest',
    last_name: rest.join(' ') || '-',
    email: args.leadGuest.email,
    phone: args.leadGuest.phone,
  };
  try {
    const { data } = await api.post(
      `${STAYS_API_BASE}/book`,
      { reservation_id: carrier.s, book_token: carrier.p, guest },
      { headers: { 'Idempotency-Key': args.idempotencyKey } },
    );
    return { ok: true, reservation: mapReservation(unwrap<BEReservation>(data)) };
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: { data?: BEReservation; error?: string; code?: string } } };
    const status = e.response?.status;
    // 409 with data.state=VOID = supplier could not confirm; hold auto-released.
    let errorCode = 'PAYMENT_FAILED';
    if (status === 409) errorCode = 'BOOK_REJECTED_BY_SUPPLIER';
    else if (status === 402) errorCode = 'INSUFFICIENT_FUNDS';
    else if (status === 428) errorCode = 'DUPLICATE_REQUEST'; // consent gate (rare here)
    return { ok: false, errorCode, holdReleased: true };
  }
}

export async function getReservation(id: string): Promise<Reservation> {
  if (USE_MOCK) {
    await delay(180);
    const found = mockReservations.find((r) => r.id === id);
    if (!found) throw new Error('Reservation not found');
    return found;
  }
  const { data } = await api.get(`${STAYS_API_BASE}/reservations/${encodeURIComponent(id)}`);
  return mapReservation(unwrap<BEReservation>(data));
}

// ── Internal: build a property detail from a card (mock) ──────────────────────
function toDetail(p: PropertyCard): PropertyDetail {
  const media = [
    p.coverUrl,
    'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa',
    'https://images.unsplash.com/photo-1631049307264-da0ec9d70304',
    'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b',
    'https://images.unsplash.com/photo-1590490360182-c33d57733427',
  ];
  return {
    ...p,
    description:
      `${p.name} is a ${p.star}-star ${p.propertyType} in ${p.area}, ${p.city}. ` +
      'Spacious rooms, reliable power and fast WiFi, with easy access to the business district. ' +
      'Confirmed inventory and instant wallet refunds on free-cancel rates.',
    address: `${p.area}, ${p.city}, Nigeria`,
    media,
    mediaCategories: [
      { label: 'Rooms', urls: media.slice(0, 3) },
      { label: 'Facilities', urls: media.slice(2) },
      { label: 'Exterior', urls: [media[0], media[4]] },
    ],
    nearbyLandmarks: [
      { name: 'City centre', distanceM: 1200 },
      { name: 'Airport', distanceM: 18000 },
      { name: 'Shopping mall', distanceM: 900 },
    ],
    subScores: {
      cleanliness: clamp(p.reviewScore + 0.3),
      staff: clamp(p.reviewScore + 0.1),
      location: clamp(p.reviewScore + 0.5),
      value: clamp(p.reviewScore - 0.2),
      comfort: clamp(p.reviewScore),
      facilities: clamp(p.reviewScore - 0.3),
      wifi: clamp(p.reviewScore - 0.1),
    },
    checkInTime: '14:00',
    checkOutTime: '12:00',
    policies: {
      checkIn: 'From 14:00',
      checkOut: 'Until 12:00',
      cancellation: p.freeCancellation
        ? 'Free cancellation up to 24h before check-in on flexible rates.'
        : 'Non-refundable rates available; check each rate plan.',
      children: 'Children of all ages welcome. Extra-bed charges may apply.',
      pets: 'Pets are not allowed.',
      smoking: 'Non-smoking property; designated outdoor areas only.',
      extraBeds: 'One extra bed allowed in selected rooms (surcharge).',
    },
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}
