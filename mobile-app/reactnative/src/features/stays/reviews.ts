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
  const { data } = await api.get<ReviewableStay[]>(`${STAYS_API_BASE}/reviews/eligible`);
  return data;
}

/** Resolve a single reviewable stay by reservation id (gate the write screen). */
export async function getReviewableStay(reservationId: string): Promise<ReviewableStay | null> {
  if (USE_MOCK) {
    await delay(160);
    const eligible = await listReviewableStays();
    return eligible.find((s) => s.reservationId === reservationId) ?? null;
  }
  const { data } = await api.get<ReviewableStay | null>(
    `${STAYS_API_BASE}/reviews/eligible/${encodeURIComponent(reservationId)}`,
  );
  return data;
}

export async function listMyReviews(): Promise<MyReview[]> {
  if (USE_MOCK) {
    await delay(200);
    return [...myReviews].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const { data } = await api.get<MyReview[]>(`${STAYS_API_BASE}/reviews/mine`);
  return data;
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
  const { data } = await api.post<MyReview>(`${STAYS_API_BASE}/reviews`, input);
  return data;
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
  const { data } = await api.get<LoyaltyStatus>(`${STAYS_API_BASE}/loyalty`);
  return data;
}

// ── Saved guests / travel docs ───────────────────────────────────────────────
export async function listSavedGuests(): Promise<SavedGuest[]> {
  if (USE_MOCK) {
    await delay(180);
    return [...savedGuests];
  }
  const { data } = await api.get<SavedGuest[]>(`${STAYS_API_BASE}/saved-guests`);
  return data;
}

export async function addSavedGuest(g: Omit<SavedGuest, 'id'>): Promise<SavedGuest> {
  if (USE_MOCK) {
    await delay(300);
    const created: SavedGuest = { ...g, id: `g_${Math.random().toString(36).slice(2, 7)}` };
    savedGuests.push(created);
    return created;
  }
  const { data } = await api.post<SavedGuest>(`${STAYS_API_BASE}/saved-guests`, g);
  return data;
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
