// ── Paymax Stays (SM2) — Reviews / loyalty / profile data layer ──────────────
// Self-contained, mock-first. ADDS to SM1; never edits SM1's owned files.
//
// Review integrity (PRD §14): a review is unlocked ONLY after a COMPLETED
// reservation and binds to that reservation (verified-guest only). Sub-scores
// (cleanliness, staff, location, value, comfort, facilities, WiFi) + overall.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  STAYS_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
  REVIEW_DIMENSIONS,
} from './constants/stays.constants';
import type { ReviewDimension } from './constants/stays.constants';
import { listTrips } from './trips';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
const KEY = 'stays';

// Backend wraps every response body in { data: ... }.
function unwrap<T>(body: any): T {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

// Backend review shape (member routes /api/v1/stays/reviews-mine etc.).
interface BEReview {
  id: string;
  reservation_id: string;
  property_id: string;
  overall_score: number; // 1..5
  sub_scores: Record<string, number>;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

/** Map a backend review into the local MyReview (overall is out of 10). */
function mapReview(r: BEReview): MyReview {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    propertyId: r.property_id,
    // TODO(stays): backend review has property_id only, no display content.
    propertyName: '',
    coverUrl: '',
    overall: (r.overall_score ?? 0) * 2, // backend 1..5 → local out-of-10
    subScores: (r.sub_scores ?? {}) as Partial<Record<ReviewDimension, number>>,
    title: r.title ?? '',
    body: r.body ?? '',
    createdAt: r.created_at ?? '',
    stayDate: (r.created_at ?? '').slice(0, 10),
  };
}

// ── Types ──────────────────────────────────────────────────────────────────--
export interface ReviewableStay {
  reservationId: string;
  propertyId: string;
  propertyName: string;
  coverUrl: string;
  city: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
}

export interface MyReview {
  id: string;
  reservationId: string;
  propertyId: string;
  propertyName: string;
  coverUrl: string;
  overall: number; // out of 10
  subScores: Partial<Record<ReviewDimension, number>>;
  title: string;
  body: string;
  createdAt: string;
  stayDate: string;
  hotelierResponse?: string;
}

export interface WriteReviewInput {
  reservationId: string;
  propertyId: string;
  subScores: Record<ReviewDimension, number>;
  title: string;
  body: string;
}

// ── Loyalty (PRD §16 — Paymax Stays, Genius equivalent) ──────────────────────
export interface LoyaltyTierPerk {
  icon: string; // lucide name
  label: string;
}
export interface LoyaltyTier {
  level: number;
  name: string;
  perks: LoyaltyTierPerk[];
  staysRequired: number;
}
export interface LoyaltyStatus {
  currentLevel: number;
  currentTierName: string;
  staysCompleted: number;
  staysInWindow: number;
  windowLabel: string;
  nextTier?: LoyaltyTier;
  staysToNext: number;
  discountPct: number;
  tiers: LoyaltyTier[];
  lifetimeSavingsKobo: number;
}

// ── Saved guests / travel docs (PRD §17 G, screen 54) ────────────────────────
export interface SavedGuest {
  id: string;
  fullName: string;
  relationship: string;
  dateOfBirth?: string;
  docType?: 'passport' | 'national_id' | 'drivers_license';
  docNumber?: string;
  docExpiry?: string;
}

// ── Mock stores ───────────────────────────────────────────────────────────────
const myReviews: MyReview[] = [
  {
    id: 'rev_001',
    reservationId: 'res_lag_004',
    propertyId: 'stay_lag_george',
    propertyName: 'The George Lagos',
    coverUrl: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa',
    overall: 9.2,
    subScores: { cleanliness: 9.5, staff: 9.0, location: 9.4, value: 8.6, comfort: 9.3, facilities: 9.0, wifi: 8.8 },
    title: 'Outstanding service in Ikoyi',
    body: 'Spotless suite, brilliant breakfast and the front desk arranged a wallet-paid ride for us. Will book again.',
    createdAt: new Date(Date.now() - 55 * 86_400_000).toISOString(),
    stayDate: new Date(Date.now() - 57 * 86_400_000).toISOString().slice(0, 10),
    hotelierResponse: 'Thank you, Ada! Delighted you enjoyed your stay — see you next time.',
  },
];

const savedGuests: SavedGuest[] = [
  { id: 'g_1', fullName: 'Chidi Okafor', relationship: 'Spouse', dateOfBirth: '1989-04-12', docType: 'passport', docNumber: 'A0123456', docExpiry: '2030-04-11' },
  { id: 'g_2', fullName: 'Zara Okafor', relationship: 'Child', dateOfBirth: '2019-08-02' },
];

const LOYALTY_TIERS: LoyaltyTier[] = [
  {
    level: 1,
    name: 'Paymax Stays Level 1',
    staysRequired: 1,
    perks: [
      { icon: 'BadgePercent', label: '5% off eligible rate plans' },
      { icon: 'Headset', label: 'Priority support' },
    ],
  },
  {
    level: 2,
    name: 'Paymax Stays Level 2',
    staysRequired: 5,
    perks: [
      { icon: 'BadgePercent', label: '8% off eligible rate plans' },
      { icon: 'Coffee', label: 'Occasional free breakfast' },
      { icon: 'Headset', label: 'Priority support' },
    ],
  },
  {
    level: 3,
    name: 'Paymax Stays Level 3',
    staysRequired: 15,
    perks: [
      { icon: 'BadgePercent', label: '10% off eligible rate plans' },
      { icon: 'Coffee', label: 'Free breakfast' },
      { icon: 'Clock', label: 'Late checkout when available' },
      { icon: 'ArrowUpCircle', label: 'Room upgrades when available' },
    ],
  },
];

// ── API ──────────────────────────────────────────────────────────────────────

/** Stays eligible for a review = COMPLETED reservations without a review yet. */
export async function listReviewableStays(): Promise<ReviewableStay[]> {
  if (USE_MOCK) {
    await delay(220);
    const past = await listTrips('past');
    const reviewedIds = new Set(myReviews.map((r) => r.reservationId));
    return past
      .filter((t) => t.state === 'COMPLETED' && !reviewedIds.has(t.id))
      .map((t) => ({
        reservationId: t.id,
        propertyId: t.propertyId,
        propertyName: t.propertyName,
        coverUrl: t.coverUrl,
        city: t.city,
        roomTypeName: t.roomTypeName,
        checkIn: t.checkIn,
        checkOut: t.checkOut,
      }));
  }
  // TODO(stays): no backend list-eligible endpoint (eligibility is per-reservation only).
  return [];
}

/** Resolve a single reviewable stay by reservation id (gate the write screen). */
export async function getReviewableStay(reservationId: string): Promise<ReviewableStay | null> {
  if (USE_MOCK) {
    await delay(160);
    const eligible = await listReviewableStays();
    return eligible.find((s) => s.reservationId === reservationId) ?? null;
  }
  // Live: GET /reservations/:id/review-eligibility → { can_review, reason? }.
  const { data } = await api.get(
    `${STAYS_API_BASE}/reservations/${encodeURIComponent(reservationId)}/review-eligibility`,
  );
  const elig = unwrap<{ can_review: boolean; reason?: string }>(data);
  // ReviewableStay has no `locked` flag → return null when not eligible.
  if (!elig?.can_review) return null;
  // Eligible, but the endpoint returns no property display content.
  // TODO(stays): eligibility endpoint has IDs only, no property display content.
  return {
    reservationId,
    propertyId: '',
    propertyName: '',
    coverUrl: '',
    city: '',
    roomTypeName: '',
    checkIn: '',
    checkOut: '',
  };
}

export async function listMyReviews(): Promise<MyReview[]> {
  if (USE_MOCK) {
    await delay(200);
    return [...myReviews].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const { data } = await api.get(`${STAYS_API_BASE}/reviews-mine`, {
    params: { limit: 100, offset: 0 },
  });
  const rows = unwrap<BEReview[]>(data) ?? [];
  return rows.map(mapReview);
}

export async function writeReview(input: WriteReviewInput): Promise<MyReview> {
  if (USE_MOCK) {
    await delay(800);
    const stay = await getReviewableStay(input.reservationId);
    if (!stay) throw new Error('This stay is not eligible for a review.');
    const vals = REVIEW_DIMENSIONS.map((d) => input.subScores[d]).filter((v) => typeof v === 'number');
    const overall = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : 0;
    const review: MyReview = {
      id: `rev_${Math.random().toString(36).slice(2, 8)}`,
      reservationId: input.reservationId,
      propertyId: input.propertyId,
      propertyName: stay.propertyName,
      coverUrl: stay.coverUrl,
      overall,
      subScores: input.subScores,
      title: input.title,
      body: input.body,
      createdAt: new Date().toISOString(),
      stayDate: stay.checkIn,
    };
    myReviews.unshift(review);
    return review;
  }
  // Compute an overall out-of-10 from the sub-scores, then map to backend 1..5.
  const vals = REVIEW_DIMENSIONS.map((d) => input.subScores[d]).filter(
    (v) => typeof v === 'number',
  );
  const overallTen = vals.length
    ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
    : 0;
  // Backend overall_score is an int in 1..5.
  const overallFive = Math.min(5, Math.max(1, Math.round(overallTen / 2)));
  const { data } = await api.post(
    `${STAYS_API_BASE}/reservations/${encodeURIComponent(input.reservationId)}/review`,
    {
      overall_score: overallFive,
      sub_scores: input.subScores,
      title: input.title,
      body: input.body,
    },
  );
  const created = unwrap<{ id: string }>(data);
  // Construct the local MyReview from the input + returned id.
  // TODO(stays): backend returns { id } only, no property display content.
  return {
    id: created?.id ?? '',
    reservationId: input.reservationId,
    propertyId: input.propertyId,
    propertyName: '',
    coverUrl: '',
    overall: overallTen,
    subScores: input.subScores,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
    stayDate: new Date().toISOString().slice(0, 10),
  };
}

// ── Loyalty ────────────────────────────────────────────────────────────────--
export async function getLoyaltyStatus(): Promise<LoyaltyStatus> {
  if (USE_MOCK) {
    await delay(220);
    const all = await listTrips();
    const completed = all.filter((t) => t.state === 'COMPLETED').length;
    const inWindow = completed; // rolling-window mock == lifetime here
    const currentLevel = inWindow >= 15 ? 3 : inWindow >= 5 ? 2 : inWindow >= 1 ? 1 : 0;
    const current = LOYALTY_TIERS.find((t) => t.level === currentLevel);
    const next = LOYALTY_TIERS.find((t) => t.level === currentLevel + 1);
    const discountPct = currentLevel === 3 ? 10 : currentLevel === 2 ? 8 : currentLevel === 1 ? 5 : 0;
    return {
      currentLevel,
      currentTierName: current?.name ?? 'Not yet a member',
      staysCompleted: completed,
      staysInWindow: inWindow,
      windowLabel: 'Last 24 months',
      nextTier: next,
      staysToNext: next ? Math.max(0, next.staysRequired - inWindow) : 0,
      discountPct,
      tiers: LOYALTY_TIERS,
      lifetimeSavingsKobo: 3_640_000,
    };
  }
  // Live: backend returns raw stay counts; tier/perks/discount are derived here
  // against the client-side LOYALTY_TIERS table (single source of tier config).
  const { data } = await api.get(`${STAYS_API_BASE}/loyalty`);
  const b = unwrap<{
    stays_completed?: number;
    stays_in_window?: number;
    window_label?: string;
    lifetime_savings_kobo?: number;
  }>(data);
  const completed = b.stays_completed ?? 0;
  const inWindow = b.stays_in_window ?? 0;
  const sorted = [...LOYALTY_TIERS].sort((a, z) => a.level - z.level);
  let currentLevel = 0;
  for (const t of sorted) if (inWindow >= t.staysRequired) currentLevel = t.level;
  const current = LOYALTY_TIERS.find((t) => t.level === currentLevel);
  const next = LOYALTY_TIERS.find((t) => t.level === currentLevel + 1);
  const discountPct = currentLevel === 3 ? 10 : currentLevel === 2 ? 8 : currentLevel === 1 ? 5 : 0;
  return {
    currentLevel,
    currentTierName: current?.name ?? 'Not yet a member',
    staysCompleted: completed,
    staysInWindow: inWindow,
    windowLabel: b.window_label ?? 'Last 12 months',
    nextTier: next,
    staysToNext: next ? Math.max(0, next.staysRequired - inWindow) : 0,
    discountPct,
    tiers: LOYALTY_TIERS,
    lifetimeSavingsKobo: Math.trunc(b.lifetime_savings_kobo ?? 0),
  };
}

// ── Saved guests / travel docs ───────────────────────────────────────────────
// Backend saved-guest shape (member routes /api/finance/stays/saved-guests). The
// backend stores name/email/phone/is_lead only; the local SavedGuest carries a
// few extra travel-doc fields that live client-side (not persisted server-side).
interface BESavedGuest {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  is_lead: boolean;
  created_at: string;
}

/** Map a backend saved guest onto the local SavedGuest type. */
function mapSavedGuest(g: BESavedGuest): SavedGuest {
  return {
    id: g.id,
    fullName: g.full_name ?? '',
    // is_lead is the only relationship signal the backend holds.
    relationship: g.is_lead ? 'Lead guest' : '',
  };
}

export async function listSavedGuests(): Promise<SavedGuest[]> {
  if (USE_MOCK) {
    await delay(180);
    return [...savedGuests];
  }
  const { data } = await api.get(`${STAYS_API_BASE}/saved-guests`);
  const rows = unwrap<BESavedGuest[]>(data) ?? [];
  return rows.map(mapSavedGuest);
}

export async function addSavedGuest(g: Omit<SavedGuest, 'id'>): Promise<SavedGuest> {
  if (USE_MOCK) {
    await delay(300);
    const created: SavedGuest = { ...g, id: `g_${Math.random().toString(36).slice(2, 7)}` };
    savedGuests.push(created);
    return created;
  }
  const { data } = await api.post(`${STAYS_API_BASE}/saved-guests`, {
    full_name: g.fullName,
    email: '',
    phone: '',
    is_lead: g.relationship?.toLowerCase() === 'lead guest',
  });
  return mapSavedGuest(unwrap<BESavedGuest>(data));
}

export async function removeSavedGuest(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(200);
    const i = savedGuests.findIndex((g) => g.id === id);
    if (i >= 0) savedGuests.splice(i, 1);
    return { ok: true };
  }
  await api.delete(`${STAYS_API_BASE}/saved-guests/${encodeURIComponent(id)}`);
  return { ok: true };
}

// ── Hooks ──────────────────────────────────────────────────────────────────--
export function useReviewableStays() {
  return useQuery({ queryKey: [KEY, 'reviewable'], queryFn: listReviewableStays, staleTime: 15_000 });
}

export function useReviewableStay(reservationId: string) {
  return useQuery({
    queryKey: [KEY, 'reviewable', reservationId],
    queryFn: () => getReviewableStay(reservationId),
    enabled: !!reservationId,
  });
}

export function useMyReviews() {
  return useQuery({ queryKey: [KEY, 'my-reviews'], queryFn: listMyReviews, staleTime: 15_000 });
}

export function useWriteReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WriteReviewInput) => writeReview(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'my-reviews'] });
      qc.invalidateQueries({ queryKey: [KEY, 'reviewable'] });
    },
  });
}

export function useLoyaltyStatus() {
  return useQuery({ queryKey: [KEY, 'loyalty'], queryFn: getLoyaltyStatus, staleTime: 60_000 });
}

export function useSavedGuests() {
  return useQuery({ queryKey: [KEY, 'saved-guests'], queryFn: listSavedGuests, staleTime: 30_000 });
}

export function useAddSavedGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: Omit<SavedGuest, 'id'>) => addSavedGuest(g),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'saved-guests'] }),
  });
}

export function useRemoveSavedGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeSavedGuest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'saved-guests'] }),
  });
}
