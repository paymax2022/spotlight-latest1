// ── Paymax Stays (SM2) — Trips / bookings data layer ─────────────────────────
// Self-contained, mock-first data layer for the confirmation + trip-management
// surface (PRD §13 cancel/modify/no-show, §17 E). ADDS to SM1 — never edits
// SM1's api.ts / hooks.ts / types.ts.
//
// IRON RULES honoured here:
//  • Money is integer minor units (kobo). Currency always explicit on display.
//  • Modify = re-prebook for the delta; the price difference is charged/refunded
//    via the WALLET (PRD §13). Cancel within the free-cancel window = instant
//    reversing credit to the wallet. Both carry an Idempotency-Key (money-path).
//  • Policy snapshot is captured on the reservation; later policy changes never
//    alter an existing booking.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  STAYS_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
  newIdempotencyKey,
  nightsBetween,
} from './constants/stays.constants';
import type {
  Currency,
  GuestConfig,
  LeadGuest,
  PaymentMethod,
  ReservationState,
} from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
const KEY = 'stays';

// Backend wraps every response body in { data: ... }.
function unwrap<T>(body: any): T {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

// Backend reservation shape (member routes /api/v1/stays/reservations*).
interface BEReservation {
  id: string;
  property_id: string;
  room_type_id: string;
  rate_plan_id: string;
  source_rail: string;
  supplier_code: string;
  supplier_ref?: string;
  state: string; // UPPERCASE e.g. CONFIRMED/COMPLETED/CANCELLED_BY_GUEST/VOID
  check_in: string; // RFC3339
  check_out: string;
  rooms: number;
  occupancy?: { adults?: number; children?: number; childrenAges?: number[] };
  currency: string;
  gross_amount_kobo: number;
  tax_amount_kobo: number;
  net_rate_kobo: number;
  payment_method: string; // UPPERCASE
  voucher_ref?: string;
  created_at: string;
  // Best-effort display content attached by the backend enrichment block.
  content?: {
    name?: string;
    city?: string;
    address?: string;
    cover_url?: string;
    star_rating?: number;
    property_type?: string;
  } | null;
}

/** Map the backend UPPERCASE state onto the local ReservationState union. */
function mapState(state: string): ReservationState {
  // SEARCHING has no backend equivalent; otherwise the backend uses the same
  // UPPERCASE tokens as the local ReservationState union, so cast through.
  if (state === 'SEARCHING') return 'OFFER_SELECTED';
  return state as ReservationState;
}

/** Derive the trips bucket from backend state / dates. */
function bucketFor(r: BEReservation): TripBucket {
  if (r.state.startsWith('CANCELLED') || r.state === 'VOID') return 'cancelled';
  if (r.state === 'COMPLETED') return 'past';
  return 'upcoming';
}

/** Map a backend reservation into the local Trip type.
 *  Backend Reservation carries IDs, not display content — property display
 *  fields default to '' / null. */
function mapReservationToTrip(r: BEReservation): Trip {
  const checkIn = (r.check_in ?? '').slice(0, 10);
  const checkOut = (r.check_out ?? '').slice(0, 10);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const total = r.gross_amount_kobo ?? 0;
  return {
    id: r.id,
    reference: r.supplier_ref ?? r.id,
    state: mapState(r.state),
    bucket: bucketFor(r),
    // Display content from the backend enrichment block (name/city/photo).
    // room/rate names remain ID-only (TODO(stays): embed room/rate content).
    propertyName: r.content?.name ?? '',
    coverUrl: r.content?.cover_url ?? '',
    city: r.content?.city ?? '',
    address: r.content?.address ?? '',
    roomTypeName: '',
    ratePlanName: '',
    checkIn,
    checkOut,
    nights,
    guests: {
      adults: r.occupancy?.adults ?? 0,
      children: r.occupancy?.children ?? 0,
      childrenAges: r.occupancy?.childrenAges ?? [],
      rooms: r.rooms ?? 1,
    },
    paymentMethod: (r.payment_method?.toLowerCase() ?? 'wallet') as PaymentMethod,
    totalKobo: total,
    currency: (r.currency ?? 'NGN') as Currency,
    displayTotalMinor: total,
    // TODO(stays): backend Reservation has no lead-guest display content.
    leadGuest: { fullName: '', email: '', phone: '', country: '' },
    createdAt: r.created_at ?? '',
    // TODO(stays): backend Reservation has no policy snapshot text.
    cancellationPolicy: '',
    refundable: false,
    supplierRef: r.supplier_ref,
    propertyId: r.property_id,
    // TODO(stays): backend Reservation has no geo/voucher/check-in-time content.
    geo: { lat: 0, lng: 0 },
    voucherUrl: '',
    checkInTime: '',
    checkOutTime: '',
  };
}

// ── Domain types (SM2-owned, additive) ───────────────────────────────────────
export type TripBucket = 'upcoming' | 'past' | 'cancelled';

export interface RefundLeg {
  label: string;
  amountKobo: number; // negative = penalty/fee, positive = credit to wallet
}

export interface CancellationPreview {
  refundableKobo: number; // credited to wallet
  penaltyKobo: number; // retained per policy snapshot
  paidKobo: number;
  legs: RefundLeg[];
  freeCancel: boolean;
  policyText: string;
  /** Refund settles to the Paymax wallet instantly when free-cancel. */
  instant: boolean;
}

export interface ModifyQuote {
  /** Delta to charge (>0) or refund (<0), in NGN kobo, settled via wallet. */
  deltaKobo: number;
  newTotalKobo: number;
  oldTotalKobo: number;
  newNights: number;
  /** True when the new dates/occupancy are unavailable on re-prebook. */
  unavailable: boolean;
}

export interface ModifyInput {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  guests: GuestConfig;
}

export type RefundStatusStep = 'requested' | 'approved' | 'credited';

export interface RefundStatus {
  reservationId: string;
  status: RefundStatusStep;
  amountKobo: number;
  requestedAt: string;
  creditedAt?: string;
  destination: 'wallet';
  reference: string;
}

/** A reservation as shown across trips screens. Superset of SM1's Reservation
 *  shape (kept structurally compatible) plus the trip-management fields. */
export interface Trip {
  id: string;
  reference: string;
  state: ReservationState;
  bucket: TripBucket;
  propertyName: string;
  coverUrl: string;
  city: string;
  address: string;
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
  refundable: boolean;
  freeCancelUntil?: string;
  supplierRef?: string;
  propertyId: string;
  /** Coordinates used by ride-to-hotel + directions CTAs. */
  geo: { lat: number; lng: number };
  voucherUrl: string;
  checkInTime: string;
  checkOutTime: string;
}

// ── Mock data ────────────────────────────────────────────────────────────────
const COVER_A = 'https://images.unsplash.com/photo-1566073771259-6a8506099945';
const COVER_B = 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa';
const COVER_C = 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b';

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
function isoTs(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

const LEAD: LeadGuest = {
  fullName: 'Ada Okafor',
  email: 'ada.okafor@example.com',
  phone: '+2348031234567',
  country: 'NG',
};

const MOCK_TRIPS: Trip[] = [
  {
    id: 'res_eko_001',
    reference: 'PMX-EKO4Q1',
    state: 'CONFIRMED',
    bucket: 'upcoming',
    propertyName: 'Eko Signature Hotel',
    coverUrl: COVER_A,
    city: 'Lagos',
    address: 'Victoria Island, Lagos, Nigeria',
    roomTypeName: 'Deluxe King Room',
    ratePlanName: 'Flexible · Breakfast included',
    checkIn: iso(12),
    checkOut: iso(15),
    nights: 3,
    guests: { adults: 2, children: 0, childrenAges: [], rooms: 1 },
    paymentMethod: 'wallet',
    totalKobo: 28_500_000,
    currency: 'NGN',
    displayTotalMinor: 28_500_000,
    leadGuest: LEAD,
    createdAt: isoTs(-2),
    cancellationPolicy: 'Free cancellation until 48h before check-in.',
    refundable: true,
    freeCancelUntil: iso(10),
    supplierRef: 'SUP-EKO12',
    propertyId: 'stay_lag_eko',
    geo: { lat: 6.4281, lng: 3.4219 },
    voucherUrl: 'https://stays.paymax.ng/voucher/PMX-EKO4Q1.pdf',
    checkInTime: '14:00',
    checkOutTime: '12:00',
  },
  {
    id: 'res_abj_002',
    reference: 'PMX-ABJ7TZ',
    state: 'CONFIRMED',
    bucket: 'upcoming',
    propertyName: 'Transcorp Hilton Abuja',
    coverUrl: COVER_B,
    city: 'Abuja',
    address: 'Maitama, Abuja, Nigeria',
    roomTypeName: 'Executive Twin',
    ratePlanName: 'Non-refundable · Room only',
    checkIn: iso(30),
    checkOut: iso(32),
    nights: 2,
    guests: { adults: 1, children: 0, childrenAges: [], rooms: 1 },
    paymentMethod: 'card',
    totalKobo: 19_200_000,
    currency: 'NGN',
    displayTotalMinor: 19_200_000,
    leadGuest: LEAD,
    createdAt: isoTs(-5),
    cancellationPolicy: 'Non-refundable rate. No refund on cancellation.',
    refundable: false,
    supplierRef: 'SUP-ABJ88',
    propertyId: 'stay_abj_hilton',
    geo: { lat: 9.0765, lng: 7.4983 },
    voucherUrl: 'https://stays.paymax.ng/voucher/PMX-ABJ7TZ.pdf',
    checkInTime: '15:00',
    checkOutTime: '12:00',
  },
  {
    id: 'res_ph_003',
    reference: 'PMX-PHC9MK',
    state: 'COMPLETED',
    bucket: 'past',
    propertyName: 'Hotel Presidential PH',
    coverUrl: COVER_C,
    city: 'Port Harcourt',
    address: 'Old GRA, Port Harcourt, Nigeria',
    roomTypeName: 'Standard Queen',
    ratePlanName: 'Flexible · Breakfast included',
    checkIn: iso(-20),
    checkOut: iso(-18),
    nights: 2,
    guests: { adults: 2, children: 1, childrenAges: [6], rooms: 1 },
    paymentMethod: 'wallet',
    totalKobo: 14_800_000,
    currency: 'NGN',
    displayTotalMinor: 14_800_000,
    leadGuest: LEAD,
    createdAt: isoTs(-30),
    cancellationPolicy: 'Free cancellation until 24h before check-in.',
    refundable: true,
    freeCancelUntil: iso(-21),
    supplierRef: 'SUP-PHC42',
    propertyId: 'stay_ph_presidential',
    geo: { lat: 4.8156, lng: 7.0498 },
    voucherUrl: 'https://stays.paymax.ng/voucher/PMX-PHC9MK.pdf',
    checkInTime: '14:00',
    checkOutTime: '11:00',
  },
  {
    id: 'res_lag_004',
    reference: 'PMX-LAG2RB',
    state: 'COMPLETED',
    bucket: 'past',
    propertyName: 'The George Lagos',
    coverUrl: COVER_B,
    city: 'Lagos',
    address: 'Ikoyi, Lagos, Nigeria',
    roomTypeName: 'Premier Suite',
    ratePlanName: 'Flexible · Half board',
    checkIn: iso(-60),
    checkOut: iso(-57),
    nights: 3,
    guests: { adults: 2, children: 0, childrenAges: [], rooms: 1 },
    paymentMethod: 'wallet',
    totalKobo: 42_000_000,
    currency: 'NGN',
    displayTotalMinor: 42_000_000,
    leadGuest: LEAD,
    createdAt: isoTs(-70),
    cancellationPolicy: 'Free cancellation until 72h before check-in.',
    refundable: true,
    freeCancelUntil: iso(-63),
    supplierRef: 'SUP-LAG09',
    propertyId: 'stay_lag_george',
    geo: { lat: 6.4498, lng: 3.4361 },
    voucherUrl: 'https://stays.paymax.ng/voucher/PMX-LAG2RB.pdf',
    checkInTime: '14:00',
    checkOutTime: '12:00',
  },
  {
    id: 'res_kan_005',
    reference: 'PMX-KAN5WD',
    state: 'CANCELLED_BY_GUEST',
    bucket: 'cancelled',
    propertyName: 'Tahir Guest Palace Kano',
    coverUrl: COVER_C,
    city: 'Kano',
    address: 'Nassarawa GRA, Kano, Nigeria',
    roomTypeName: 'Standard Double',
    ratePlanName: 'Flexible · Room only',
    checkIn: iso(-5),
    checkOut: iso(-3),
    nights: 2,
    guests: { adults: 1, children: 0, childrenAges: [], rooms: 1 },
    paymentMethod: 'wallet',
    totalKobo: 9_600_000,
    currency: 'NGN',
    displayTotalMinor: 9_600_000,
    leadGuest: LEAD,
    createdAt: isoTs(-15),
    cancellationPolicy: 'Free cancellation until 24h before check-in.',
    refundable: true,
    freeCancelUntil: iso(-6),
    supplierRef: 'SUP-KAN77',
    propertyId: 'stay_kan_tahir',
    geo: { lat: 12.0022, lng: 8.5167 },
    voucherUrl: 'https://stays.paymax.ng/voucher/PMX-KAN5WD.pdf',
    checkInTime: '14:00',
    checkOutTime: '12:00',
  },
];

// Session-scoped mutable store so cancel/modify persist across screens.
const trips: Trip[] = MOCK_TRIPS.map((t) => ({ ...t }));
const refundStatuses = new Map<string, RefundStatus>();

function findTrip(id: string): Trip | undefined {
  return trips.find((t) => t.id === id);
}

// ── API ──────────────────────────────────────────────────────────────────────
export async function listTrips(bucket?: TripBucket): Promise<Trip[]> {
  if (USE_MOCK) {
    await delay();
    const all = [...trips].sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1));
    return bucket ? all.filter((t) => t.bucket === bucket) : all;
  }
  // Live: backend has /reservations (no /trips). Fetch all, map, filter client-side.
  const { data } = await api.get(`${STAYS_API_BASE}/reservations`, {
    params: { limit: 100, offset: 0 },
  });
  const rows = unwrap<BEReservation[]>(data) ?? [];
  const mapped = rows.map(mapReservationToTrip);
  if (!bucket) return mapped;
  return mapped.filter((t) => {
    if (bucket === 'upcoming') {
      return t.state === 'CONFIRMED' || (!!t.checkIn && new Date(t.checkIn).getTime() > Date.now());
    }
    if (bucket === 'past') return t.state === 'COMPLETED';
    // cancelled
    return t.state.startsWith('CANCELLED') || t.state === 'VOID';
  });
}

export async function getTrip(id: string): Promise<Trip> {
  if (USE_MOCK) {
    await delay(180);
    const t = findTrip(id);
    if (!t) throw new Error('Booking not found');
    return { ...t };
  }
  const { data } = await api.get(`${STAYS_API_BASE}/reservations/${encodeURIComponent(id)}`);
  return mapReservationToTrip(unwrap<BEReservation>(data));
}

/** Cancellation preview from the captured policy snapshot (no charge yet). */
export async function previewCancellation(id: string): Promise<CancellationPreview> {
  if (USE_MOCK) {
    await delay(220);
    const t = findTrip(id);
    if (!t) throw new Error('Booking not found');
    const beforeDeadline =
      !!t.freeCancelUntil && new Date(`${t.freeCancelUntil}T00:00:00`).getTime() > Date.now();
    const freeCancel = t.refundable && beforeDeadline;
    if (freeCancel) {
      return {
        refundableKobo: t.totalKobo,
        penaltyKobo: 0,
        paidKobo: t.totalKobo,
        legs: [{ label: 'Refund to wallet', amountKobo: t.totalKobo }],
        freeCancel: true,
        instant: true,
        policyText: t.cancellationPolicy,
      };
    }
    if (!t.refundable) {
      return {
        refundableKobo: 0,
        penaltyKobo: t.totalKobo,
        paidKobo: t.totalKobo,
        legs: [{ label: 'Non-refundable rate — no refund', amountKobo: 0 }],
        freeCancel: false,
        instant: false,
        policyText: t.cancellationPolicy,
      };
    }
    // Past deadline on a refundable rate → one-night penalty.
    const penalty = Math.round(t.totalKobo / Math.max(1, t.nights));
    const refundable = Math.max(0, t.totalKobo - penalty);
    return {
      refundableKobo: refundable,
      penaltyKobo: penalty,
      paidKobo: t.totalKobo,
      legs: [
        { label: 'First-night penalty (past free-cancel window)', amountKobo: -penalty },
        { label: 'Refund to wallet', amountKobo: refundable },
      ],
      freeCancel: false,
      instant: true,
      policyText: t.cancellationPolicy,
    };
  }
  // TODO(stays): no backend endpoint yet for cancellation preview.
  // Return a safe default (refundability unknown) without a network call.
  return {
    refundableKobo: 0,
    penaltyKobo: 0,
    paidKobo: 0,
    legs: [],
    freeCancel: false,
    instant: false,
    policyText: '',
  };
}

export async function cancelTrip(id: string): Promise<RefundStatus> {
  if (USE_MOCK) {
    await delay(900);
    const t = findTrip(id);
    if (!t) throw new Error('Booking not found');
    const preview = await previewCancellation(id);
    t.state = 'CANCELLED_BY_GUEST';
    t.bucket = 'cancelled';
    const status: RefundStatus = {
      reservationId: id,
      status: preview.refundableKobo > 0 ? 'credited' : 'approved',
      amountKobo: preview.refundableKobo,
      requestedAt: new Date().toISOString(),
      creditedAt: preview.refundableKobo > 0 ? new Date().toISOString() : undefined,
      destination: 'wallet',
      reference: `RF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    };
    refundStatuses.set(id, status);
    return status;
  }
  // Live: Idempotency-Key REQUIRED (money-path; refund is a reversing entry).
  const { data } = await api.post(
    `${STAYS_API_BASE}/reservations/${encodeURIComponent(id)}/cancel`,
    { reason: '' },
    { headers: { 'Idempotency-Key': newIdempotencyKey() } },
  );
  const r = unwrap<BEReservation>(data);
  // Best-effort map: backend returns the updated reservation, not a refund record.
  // TODO(stays): no backend refund-amount field — refund amount unknown, defaulted to 0.
  const cancelled = r.state?.startsWith('CANCELLED') || r.state === 'VOID';
  return {
    reservationId: id,
    status: cancelled ? 'approved' : 'requested',
    amountKobo: 0,
    requestedAt: new Date().toISOString(),
    destination: 'wallet',
    reference: r.supplier_ref ?? r.id ?? id,
  };
}

/** Re-prebook for the delta (PRD §13) — price difference charged/refunded via wallet. */
export async function quoteModify(input: ModifyInput): Promise<ModifyQuote> {
  if (USE_MOCK) {
    await delay(700);
    const t = findTrip(input.reservationId);
    if (!t) throw new Error('Booking not found');
    const newNights = nightsBetween(input.checkIn, input.checkOut);
    // Demo unavailable path when shrinking to a single night on a non-ref rate.
    const unavailable = !t.refundable && newNights < t.nights;
    const perNight = Math.round(t.totalKobo / Math.max(1, t.nights));
    const occMultiplier = 1 + Math.max(0, input.guests.adults - t.guests.adults) * 0.15;
    const newTotal = Math.round(perNight * newNights * occMultiplier);
    return {
      deltaKobo: newTotal - t.totalKobo,
      newTotalKobo: newTotal,
      oldTotalKobo: t.totalKobo,
      newNights,
      unavailable,
    };
  }
  // TODO(stays): no backend modify-quote endpoint yet.
  // Return a safe default (no delta, availability unknown) without a network call.
  return {
    deltaKobo: 0,
    newTotalKobo: 0,
    oldTotalKobo: 0,
    newNights: nightsBetween(input.checkIn, input.checkOut),
    unavailable: false,
  };
}

export async function applyModify(input: ModifyInput): Promise<Trip> {
  if (USE_MOCK) {
    await delay(1000);
    const t = findTrip(input.reservationId);
    if (!t) throw new Error('Booking not found');
    const quote = await quoteModify(input);
    if (quote.unavailable) throw new Error('Those dates are not available for this rate.');
    t.checkIn = input.checkIn;
    t.checkOut = input.checkOut;
    t.nights = quote.newNights;
    t.guests = input.guests;
    t.totalKobo = quote.newTotalKobo;
    t.displayTotalMinor = quote.newTotalKobo;
    return { ...t };
  }
  // Live: Idempotency-Key REQUIRED — the delta is a wallet charge/refund.
  const { data } = await api.post(
    `${STAYS_API_BASE}/reservations/${encodeURIComponent(input.reservationId)}/modify`,
    { check_in: input.checkIn, check_out: input.checkOut },
    { headers: { 'Idempotency-Key': newIdempotencyKey() } },
  );
  return mapReservationToTrip(unwrap<BEReservation>(data));
}

export async function getRefundStatus(id: string): Promise<RefundStatus> {
  if (USE_MOCK) {
    await delay(200);
    const existing = refundStatuses.get(id);
    if (existing) return existing;
    const t = findTrip(id);
    // Synthesize a credited refund for already-cancelled mock trips.
    const status: RefundStatus = {
      reservationId: id,
      status: 'credited',
      amountKobo: t?.totalKobo ?? 0,
      requestedAt: isoTs(-1),
      creditedAt: isoTs(-1),
      destination: 'wallet',
      reference: `RF-${(t?.reference ?? 'XXXXXX').slice(-6)}`,
    };
    return status;
  }
  // TODO(stays): no backend refund-status endpoint yet. Derive minimally from
  // the reservation state; refund amount is unknown, defaulted to 0.
  const { data } = await api.get(`${STAYS_API_BASE}/reservations/${encodeURIComponent(id)}`);
  const r = unwrap<BEReservation>(data);
  const cancelled = r.state?.startsWith('CANCELLED') || r.state === 'VOID';
  return {
    reservationId: id,
    status: cancelled ? 'approved' : 'requested',
    amountKobo: 0,
    requestedAt: r.created_at ?? new Date().toISOString(),
    destination: 'wallet',
    reference: r.supplier_ref ?? r.id ?? id,
  };
}

// ── Hooks ──────────────────────────────────────────────────────────────────--
export function useTrips(bucket?: TripBucket) {
  return useQuery({
    queryKey: [KEY, 'trips', bucket ?? 'all'],
    queryFn: () => listTrips(bucket),
    staleTime: 15_000,
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: [KEY, 'trip', id],
    queryFn: () => getTrip(id),
    enabled: !!id,
  });
}

export function useCancellationPreview(id: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'cancel-preview', id],
    queryFn: () => previewCancellation(id),
    enabled: !!id && enabled,
  });
}

export function useCancelTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelTrip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'trips'] });
      qc.invalidateQueries({ queryKey: [KEY, 'trip'] });
    },
  });
}

export function useModifyQuote() {
  return useMutation({ mutationFn: (input: ModifyInput) => quoteModify(input) });
}

export function useApplyModify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModifyInput) => applyModify(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'trips'] });
      qc.invalidateQueries({ queryKey: [KEY, 'trip'] });
    },
  });
}

export function useRefundStatus(id: string) {
  return useQuery({
    queryKey: [KEY, 'refund', id],
    queryFn: () => getRefundStatus(id),
    enabled: !!id,
  });
}
