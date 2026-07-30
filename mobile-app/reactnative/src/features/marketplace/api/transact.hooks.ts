// ── Marketplace — Deal Room React Query hooks (connect model) ────────────────
//
// The connect surface's data hooks: chat threads, structured (non-binding)
// offers, meetup safe-spots, and the optional self-reported review. There is no
// escrow / order / dispute money-path any more — the deal is arranged
// off-platform (Meetup) once both parties agree. Query keys namespaced under
// ['mkt', 'transact', …].
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import * as offersApi from './offers.api';
import * as meetupApi from './meetup.api';
import { MKT_USE_MOCK } from './client';
import type { CreateOfferInput, Offer } from '../types';

// Near-real-time polling for live chat (no websocket infra). Only polls when
// pointed at the real backend and only while the app is foregrounded (react-query
// default refetchIntervalInBackground=false) to spare battery. Mock mode is local,
// so nothing to poll.
//
// When SSE realtime is enabled (EXPO_PUBLIC_REALTIME_ENABLED=true, see
// realtime/useMarketplaceRealtime.ts) push handles the fast path, so we relax the
// message poll to 20s — polling STAYS as the safety net (reconnect gaps, dropped
// frames), it just runs less often. With realtime off, the tighter 6s poll stands.
const REALTIME_ENABLED = (process.env.EXPO_PUBLIC_REALTIME_ENABLED ?? 'false') === 'true';
const MESSAGE_POLL_MS = MKT_USE_MOCK ? (false as const) : REALTIME_ENABLED ? 20_000 : 6_000;
const THREADS_POLL_MS = MKT_USE_MOCK ? (false as const) : 15_000;

// ── Current user id (for own-vs-counterparty bubble rendering in live mode) ────
// Sourced from the Supabase-backed auth store (same source useCurrentSellerId in
// sell.hooks.ts uses). Null when signed-out; the Deal Room falls back to MOCK_ME
// so mock/offline mode still renders own bubbles correctly.
export function useCurrentUserId(): string | null {
  return useAuthStore((s) => s.user?.id ?? null);
}

// ── Query keys ────────────────────────────────────────────────────────────────
export const TX_KEYS = {
  threads: ['mkt', 'transact', 'threads'] as const,
  thread: (id: string) => ['mkt', 'transact', 'thread', id] as const,
  messages: (id: string) => ['mkt', 'transact', 'messages', id] as const,
  offers: (listingId: string) => ['mkt', 'transact', 'offers', listingId] as const,
  review: (dealId: string) => ['mkt', 'transact', 'review', dealId] as const,
  safeSpots: ['mkt', 'transact', 'safe-spots'] as const,
};

// ── Chat inbox / Deal Room ────────────────────────────────────────────────────
export const useThreads = () =>
  useQuery({ queryKey: TX_KEYS.threads, queryFn: offersApi.listThreads, refetchInterval: THREADS_POLL_MS });

export const useThread = (id: string) =>
  useQuery({ queryKey: TX_KEYS.thread(id), queryFn: () => offersApi.getThread(id), enabled: !!id });

export const useMessages = (threadId: string) =>
  useQuery({
    queryKey: TX_KEYS.messages(threadId),
    queryFn: () => offersApi.getMessages(threadId),
    enabled: !!threadId,
    refetchInterval: MESSAGE_POLL_MS,
  });

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => offersApi.sendMessage(threadId, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: TX_KEYS.messages(threadId) }),
  });
}

// ── Offers (first-class, NON-BINDING price proposals) ─────────────────────────
// An offer is just a structured price suggestion. Accepting one agrees a number
// for the meetup — it creates no order and holds no funds.
export const useOffers = (listingId: string) =>
  useQuery({ queryKey: TX_KEYS.offers(listingId), queryFn: () => offersApi.listOffers(listingId), enabled: !!listingId, refetchInterval: MESSAGE_POLL_MS });

export function useCreateOffer(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOfferInput) => offersApi.createOffer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: TX_KEYS.offers(listingId) }),
  });
}

export function useCounterOffer(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { offerId: string; priceKobo: number }) => offersApi.counterOffer(input.offerId, input.priceKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: TX_KEYS.offers(listingId) }),
  });
}

export function useAcceptOffer(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => offersApi.acceptOffer(offerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: TX_KEYS.offers(listingId) }),
  });
}

export function useDeclineOffer(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => offersApi.declineOffer(offerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: TX_KEYS.offers(listingId) }),
  });
}

// ── Reviews — optional, self-reported after a deal is marked complete ─────────
export const useReviewForDeal = (dealId: string) =>
  useQuery({ queryKey: TX_KEYS.review(dealId), queryFn: () => meetupApi.getReviewForDeal(dealId), enabled: !!dealId });

export function useSubmitReview(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rating: number; tags: string[]; text?: string }) => meetupApi.submitReview(dealId, input),
    onSuccess: (review) => qc.setQueryData(TX_KEYS.review(dealId), review),
  });
}

// ── Mark met (ADR-023 "mark met" signal — unlocks review-writes) ──────────────
// Marks the deal met, then refreshes the thread (so `met` flips true and the
// review CTA appears) and the inbox.
export function useMarkDealMet(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => meetupApi.markDealMet(dealId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TX_KEYS.thread(dealId) });
      qc.invalidateQueries({ queryKey: TX_KEYS.threads });
    },
  });
}

// ── Meetup ────────────────────────────────────────────────────────────────────
export const useSafeSpots = () =>
  useQuery({ queryKey: TX_KEYS.safeSpots, queryFn: meetupApi.getSafeSpots, staleTime: 5 * 60_000 });

// Re-export offer type for screens that only import from the hooks module.
export type { Offer };
