// ── Paymax Stays — Domain types ──────────────────────────────────────────────
// Normalised models only (supplier JSON never leaks past the api layer — PRD §7).
// Money is integer minor units: kobo for NGN, cents for USD. Currency is always
// explicit (FX integrity — every rate carries its currency).

import type { Currency, ReviewDimension, SortKey } from './constants/stays.constants';

export type { Currency, SortKey } from './constants/stays.constants';

export type Kobo = number;

export type SourceRail = 'BEDBANK' | 'DIRECT';

export type PropertyType = 'hotel' | 'apartment' | 'guesthouse' | 'resort';

export type BoardBasis = 'room_only' | 'breakfast' | 'half_board' | 'full_board';

// ── Search request ───────────────────────────────────────────────────────────
export interface GuestConfig {
  adults: number;
  children: number;
  childrenAges: number[];
  rooms: number;
}

export interface SearchQuery {
  destination: string;       // city / landmark text
  destinationId?: string;    // resolved place id
  checkIn: string;           // ISO date (yyyy-mm-dd)
  checkOut: string;          // ISO date
  guests: GuestConfig;
}

export interface StaysFilter {
  query?: string;
  minPriceKobo?: number;      // budget filter is always evaluated in NGN
  maxPriceKobo?: number;
  minScore?: number;          // out of 10
  stars?: number[];           // selected star ratings
  propertyTypes?: PropertyType[];
  amenities?: string[];
  freeCancellation?: boolean;
  dealsOnly?: boolean;
  boardBasis?: BoardBasis;
  sort?: SortKey;
}

// ── Destination autocomplete ─────────────────────────────────────────────────
export interface DestinationSuggestion {
  id: string;
  name: string;
  region: string;
  kind: 'city' | 'landmark' | 'area';
  propertyCount: number;
}

// ── Property ─────────────────────────────────────────────────────────────────
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface NearbyLandmark {
  name: string;
  distanceM: number;
}

export interface PropertyCard {
  id: string;
  name: string;
  city: string;
  area: string;
  star: number;
  propertyType: PropertyType;
  sourceRail: SourceRail;
  coverUrl: string;
  /** Lead nightly rate, in the property's display currency. */
  leadPriceMinor: number;
  currency: Currency;
  /** Strike-through original (deal). */
  wasPriceMinor?: number;
  reviewScore: number;        // out of 10
  reviewCount: number;
  freeCancellation: boolean;
  amenities: string[];
  geo: GeoPoint;
  soldOut: boolean;
  distanceKm?: number;
  loyaltyDeal?: boolean;
}

export interface PropertyDetail extends PropertyCard {
  description: string;
  address: string;
  media: string[];
  mediaCategories: { label: string; urls: string[] }[];
  nearbyLandmarks: NearbyLandmark[];
  subScores: Record<ReviewDimension, number>;
  policies: HousePolicies;
  checkInTime: string;
  checkOutTime: string;
}

export interface HousePolicies {
  checkIn: string;
  checkOut: string;
  cancellation: string;
  children: string;
  pets: string;
  smoking: string;
  extraBeds: string;
}

// ── Rooms & rate plans ───────────────────────────────────────────────────────
export interface RoomType {
  id: string;
  propertyId: string;
  name: string;
  photos: string[];
  maxOccupancy: number;
  bedding: string;
  sizeSqm: number;
  /** Cheapest bookable rate-plan price (display currency). */
  fromPriceMinor: number;
  currency: Currency;
  ratePlans: RatePlan[];
}

export interface RatePlan {
  id: string;
  roomTypeId: string;
  name: string;
  board: BoardBasis;
  refundable: boolean;
  freeCancelUntil?: string;   // ISO date; null/undefined = non-ref
  mobileOnly: boolean;
  /** Per-night price in display currency. */
  pricePerNightMinor: number;
  currency: Currency;
  /** Loyalty-discounted variant present. */
  loyaltyDiscountPct?: number;
}

// ── Reviews ──────────────────────────────────────────────────────────────────
export interface Review {
  id: string;
  author: string;
  country: string;
  score: number;             // out of 10
  title: string;
  body: string;
  stayDate: string;
  roomType: string;
  hotelierResponse?: string;
}

// ── Booking lifecycle (PRD §11) ──────────────────────────────────────────────
export type ReservationState =
  | 'OFFER_SELECTED'
  | 'PREBOOK_OK'
  | 'PAYMENT_HELD'
  | 'BOOKING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED_BY_GUEST'
  | 'CANCELLED_BY_HOTEL'
  | 'NO_SHOW'
  | 'BOOK_FAILED'
  | 'PAYMENT_FAILED'
  | 'PREBOOK_FAILED'
  | 'VOID';

export type PaymentMethod =
  | 'wallet'
  | 'card'
  | 'transfer'
  | 'pay_at_property'
  | 'deposit';

export interface AddOn {
  key: 'breakfast' | 'late_checkout' | 'airport_pickup' | 'travel_insurance';
  label: string;
  description: string;
  priceMinor: number;        // NGN kobo (add-ons are always charged in Naira)
  currency: Currency;
  /** Cross-sell target route, if any (Transport / Insurance). */
  crossSellRoute?: string;
}

export interface LeadGuest {
  fullName: string;
  email: string;
  phone: string;
  country: string;
}

export interface Occupant {
  fullName: string;
  type: 'adult' | 'child';
  age?: number;
}

/** A selected, priced offer the user is taking through checkout. */
export interface BookingDraft {
  propertyId: string;
  propertyName: string;
  coverUrl: string;
  city: string;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  board: BoardBasis;
  refundable: boolean;
  freeCancelUntil?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: GuestConfig;
  /** Per-night price snapshot at selection (display currency). */
  pricePerNightMinor: number;
  currency: Currency;
  sourceRail: SourceRail;
}

export interface PriceLine {
  label: string;
  amountKobo: number;        // always NGN kobo (what the ledger moves)
  kind: 'room' | 'tax' | 'fee' | 'addon' | 'discount';
  note?: string;
}

export interface PriceBreakdownData {
  lines: PriceLine[];
  totalKobo: number;
  /** FX note shown when display currency differs from NGN. */
  fxNote?: string;
  displayCurrency: Currency;
  displayTotalMinor: number;
}

// ── Prebook (two-step prebook → book; PRD §11) ───────────────────────────────
export interface PrebookInput {
  draft: BookingDraft;
  addOnKeys: string[];
  promoCode?: string;
  useLoyalty?: boolean;
}

export interface PrebookResult {
  bookToken: string;         // short-lived; consumed by book
  expiresAt: string;         // ISO; offer TTL
  /** True if the live re-check moved the price (PREBOOK_PRICE_CHANGED). */
  priceChanged: boolean;
  /** Sold out on re-check (PREBOOK_SOLD_OUT). */
  soldOut: boolean;
  breakdown: PriceBreakdownData;
}

export interface BookInput {
  bookToken: string;
  leadGuest: LeadGuest;
  occupants: Occupant[];
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  consentNdpa: boolean;
}

export interface Reservation {
  id: string;
  reference: string;         // human voucher code
  state: ReservationState;
  propertyName: string;
  coverUrl: string;
  city: string;
  roomTypeName: string;
  ratePlanName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: GuestConfig;
  paymentMethod: PaymentMethod;
  totalKobo: number;
  currency: Currency;
  displayTotalMinor: number;
  leadGuest: LeadGuest;
  createdAt: string;
  cancellationPolicy: string;
  supplierRef?: string;
}

export interface BookResult {
  ok: boolean;
  reservation?: Reservation;
  /** Set when ok=false: BOOK_REJECTED_BY_SUPPLIER / SUPPLIER_TIMEOUT / OVERSELL_BLOCKED. */
  errorCode?: string;
  /** Always true on failure in the hold model — the hold was released. */
  holdReleased?: boolean;
}

// ── Deals / loyalty ──────────────────────────────────────────────────────────
export interface Deal {
  id: string;
  kind: 'mobile_rate' | 'last_minute' | 'loyalty';
  title: string;
  subtitle: string;
  property: PropertyCard;
}

export interface StaysHome {
  recentSearches: SearchQuery[];
  deals: Deal[];
  trendingDestinations: DestinationSuggestion[];
  saved: PropertyCard[];
}

// ── Profile prefill (from KYC/profile mock) ──────────────────────────────────
export interface GuestProfile {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  kycTier: number;
}
