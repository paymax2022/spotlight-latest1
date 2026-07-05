// ── Paymax Stays — API wrapper ───────────────────────────────────────────────
// Typed data layer the screens code against. Mock-first via USE_MOCK; live path
// hits the frontend-web proxy at `${STAYS_API_BASE}/...`. Supplier/provider JSON
// never leaks past this layer — only normalised models (PRD §7).
//
// IRON RULES:
//  • All monetary amounts are integers in minor units (kobo for NGN, cents USD).
//  • Two-step prebook → book is mandatory (PRD §11). Prebook may re-price / sell
//    out; Book may fail → the wallet HOLD is RELEASED, no debit (the #1 invariant).
//  • Book carries an Idempotency-Key (money-path convention).

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
  BookingDraft,
  Deal,
  DestinationSuggestion,
  GuestProfile,
  PrebookInput,
  PrebookResult,
  PriceBreakdownData,
  PriceLine,
  PropertyCard,
  PropertyDetail,
  Reservation,
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

// ── Home / discovery ─────────────────────────────────────────────────────────
export async function getStaysHome(): Promise<StaysHome> {
  if (USE_MOCK) {
    await delay();
    return {
      recentSearches: [
        {
          destination: 'Lagos',
          checkIn: addDays(7),
          checkOut: addDays(9),
          guests: { adults: 2, children: 0, childrenAges: [], rooms: 1 },
        },
        {
          destination: 'Abuja',
          checkIn: addDays(14),
          checkOut: addDays(16),
          guests: { adults: 1, children: 0, childrenAges: [], rooms: 1 },
        },
      ],
      deals: MOCK_DEALS,
      trendingDestinations: MOCK_DESTINATIONS.slice(0, 4),
      saved: MOCK_PROPERTIES.filter((p) => savedIds.has(p.id)),
    };
  }
  const { data } = await api.get<StaysHome>(`${STAYS_API_BASE}/home`);
  return data;
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
  const { data } = await api.get<DestinationSuggestion[]>(`${STAYS_API_BASE}/destinations`, {
    params: { q },
  });
  return data;
}

// ── Deals ────────────────────────────────────────────────────────────────────
export async function getDeals(): Promise<Deal[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_DEALS;
  }
  const { data } = await api.get<Deal[]>(`${STAYS_API_BASE}/deals`);
  return data;
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

export async function searchStays(q: SearchQuery, f: StaysFilter = {}): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    return applyFilter(MOCK_PROPERTIES, q, f);
  }
  const { data } = await api.post<PropertyCard[]>(`${STAYS_API_BASE}/search`, { query: q, filter: f });
  return data;
}

/** Relaxed-criteria suggestions for the empty state (drop the binding filters). */
export async function searchRelaxed(q: SearchQuery): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    return applyFilter(MOCK_PROPERTIES, { ...q, destination: '' }, { sort: 'top_picks' }).slice(0, 6);
  }
  const { data } = await api.post<PropertyCard[]>(`${STAYS_API_BASE}/search/relaxed`, { query: q });
  return data;
}

export async function getNearbyStays(): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_PROPERTIES].sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  }
  const { data } = await api.get<PropertyCard[]>(`${STAYS_API_BASE}/nearby`);
  return data;
}

// ── Property detail ──────────────────────────────────────────────────────────
export async function getProperty(id: string): Promise<PropertyDetail> {
  if (USE_MOCK) {
    await delay(260);
    const found = MOCK_PROPERTIES.find((p) => p.id === id);
    if (!found) throw new Error('Property not found');
    return toDetail(found);
  }
  const { data } = await api.get<PropertyDetail>(`${STAYS_API_BASE}/properties/${encodeURIComponent(id)}`);
  return data;
}

export async function getRoomTypes(propertyId: string): Promise<RoomType[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_ROOM_TYPES[propertyId] ?? MOCK_ROOM_TYPES.__default;
  }
  const { data } = await api.get<RoomType[]>(`${STAYS_API_BASE}/properties/${encodeURIComponent(propertyId)}/rooms`);
  return data;
}

export async function getReviews(propertyId: string): Promise<Review[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_REVIEWS[propertyId] ?? MOCK_REVIEWS.__default;
  }
  const { data } = await api.get<Review[]>(`${STAYS_API_BASE}/properties/${encodeURIComponent(propertyId)}/reviews`);
  return data;
}

// ── Add-ons (cross-sell into Transport / Insurance) ──────────────────────────
export async function getAddOns(): Promise<AddOn[]> {
  if (USE_MOCK) {
    await delay(160);
    return MOCK_ADDONS;
  }
  const { data } = await api.get<AddOn[]>(`${STAYS_API_BASE}/addons`);
  return data;
}

// ── Profile prefill (KYC/profile mock) ───────────────────────────────────────
export async function getGuestProfile(): Promise<GuestProfile> {
  if (USE_MOCK) {
    await delay(140);
    return MOCK_PROFILE;
  }
  const { data } = await api.get<GuestProfile>(`${STAYS_API_BASE}/profile`);
  return data;
}

// ── Saved / wishlists ────────────────────────────────────────────────────────
export async function getSaved(): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay(180);
    return MOCK_PROPERTIES.filter((p) => savedIds.has(p.id));
  }
  const { data } = await api.get<PropertyCard[]>(`${STAYS_API_BASE}/saved`);
  return data;
}

export async function toggleSaved(id: string): Promise<{ saved: boolean }> {
  if (USE_MOCK) {
    await delay(120);
    if (savedIds.has(id)) savedIds.delete(id);
    else savedIds.add(id);
    return { saved: savedIds.has(id) };
  }
  const { data } = await api.post<{ saved: boolean }>(`${STAYS_API_BASE}/saved/${encodeURIComponent(id)}/toggle`, {});
  return data;
}

export function isSavedSync(id: string): boolean {
  return savedIds.has(id);
}

// ── Pricing helper (shared by prebook + review preview) ───────────────────────
export function buildBreakdown(input: PrebookInput, addOns: AddOn[], priceBumpPct = 0): PriceBreakdownData {
  const { draft, addOnKeys, useLoyalty, promoCode } = input;
  const n = draft.nights;
  // Room subtotal, converted to NGN kobo for the ledger.
  const perNightKobo = chargeableKobo(draft.pricePerNightMinor, draft.currency);
  const bumped = Math.round(perNightKobo * (1 + priceBumpPct));
  const roomKobo = bumped * n;

  const lines: PriceLine[] = [
    {
      label: `${draft.roomTypeName} · ${n} night${n > 1 ? 's' : ''}`,
      amountKobo: roomKobo,
      kind: 'room',
    },
  ];

  // Add-ons (always NGN).
  for (const key of addOnKeys) {
    const a = addOns.find((x) => x.key === key);
    if (a) lines.push({ label: a.label, amountKobo: a.priceMinor, kind: 'addon' });
  }

  // Taxes & fees (7.5% VAT + 5% service charge on room — typical NG hotel).
  const vat = Math.round(roomKobo * 0.075);
  const service = Math.round(roomKobo * 0.05);
  lines.push({ label: 'VAT (7.5%)', amountKobo: vat, kind: 'tax' });
  lines.push({ label: 'Service charge (5%)', amountKobo: service, kind: 'fee' });

  // Loyalty discount (Paymax Stays — host/margin funded).
  if (useLoyalty) {
    const disc = -Math.round(roomKobo * 0.08);
    lines.push({ label: 'Paymax Stays loyalty (-8%)', amountKobo: disc, kind: 'discount' });
  }
  // Promo.
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
  const { data } = await api.post<PriceBreakdownData>(`${STAYS_API_BASE}/quote`, input);
  return data;
}

// ── Prebook (step 1 — live re-check price + availability) ─────────────────────
export async function prebook(input: PrebookInput): Promise<PrebookResult> {
  if (USE_MOCK) {
    await delay(700);
    // Deterministic-ish demo behaviour: properties tagged sold_out re-check as
    // sold out; one demo property re-prices +6% to exercise the drift notice.
    const soldOut = input.draft.propertyId === 'stay_soldout';
    const priceChanged = input.draft.propertyId === 'stay_lag_eko';
    const addOns = await getAddOns();
    const breakdown = buildBreakdown(input, addOns, priceChanged ? 0.06 : 0);
    const token = uid('tok');
    mockOffers.set(token, { input, breakdown, soldOut });
    return {
      bookToken: token,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      priceChanged,
      soldOut,
      breakdown,
    };
  }
  const { data } = await api.post<PrebookResult>(`${STAYS_API_BASE}/prebook`, input);
  return data;
}

// ── Book (step 2 — consume token; CHARGE on confirm / RELEASE on fail) ────────
export async function book(args: BookInput): Promise<BookResult> {
  if (USE_MOCK) {
    await delay(1200);
    const offer = mockOffers.get(args.bookToken);
    if (!offer) {
      return { ok: false, errorCode: 'OFFER_EXPIRED', holdReleased: true };
    }
    // Demo failure path: a tagged property fails at book → auto-release.
    if (offer.input.draft.propertyId === 'stay_lag_fail') {
      return { ok: false, errorCode: 'BOOK_REJECTED_BY_SUPPLIER', holdReleased: true };
    }
    const d = offer.input.draft;
    const reservation: Reservation = {
      id: uid('res'),
      reference: `PMX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      state: args.paymentMethod === 'pay_at_property' ? 'CONFIRMED' : 'CONFIRMED',
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
      cancellationPolicy: d.refundable
        ? `Free cancellation until ${d.freeCancelUntil ?? d.checkIn}`
        : 'Non-refundable',
      supplierRef: `SUP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    };
    mockReservations.unshift(reservation);
    mockOffers.delete(args.bookToken);
    return { ok: true, reservation };
  }
  // Live: Idempotency-Key REQUIRED on book (money-path; PRD §12).
  const { data } = await api.post<BookResult>(
    `${STAYS_API_BASE}/book`,
    {
      bookToken: args.bookToken,
      leadGuest: args.leadGuest,
      occupants: args.occupants,
      paymentMethod: args.paymentMethod,
      consentNdpa: args.consentNdpa,
    },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

export async function getReservation(id: string): Promise<Reservation> {
  if (USE_MOCK) {
    await delay(180);
    const found = mockReservations.find((r) => r.id === id);
    if (!found) throw new Error('Reservation not found');
    return found;
  }
  const { data } = await api.get<Reservation>(`${STAYS_API_BASE}/reservations/${encodeURIComponent(id)}`);
  return data;
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
