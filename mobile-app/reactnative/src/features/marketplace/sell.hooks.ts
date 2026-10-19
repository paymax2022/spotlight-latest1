// relevant queries. Layered on the Sell API (./api/sell.api) which itself talks
// the shared client. Mirrors the Discover hooks conventions.
// The boost purchase is the one money mutation here: it PERSISTS an
// Idempotency-Key (SecureStore-backed, keyed by listingId+duration) so an app-kill
// mid-charge + retry reuses the same key and the backend dedupes rather than
// double-debiting the wallet.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { getSecureItem, setSecureItem, deleteSecureItem } from '@/lib/secureStorage';
import { newMktIdempotencyKey, MktApiError } from './api/client';
import * as sellApi from './api/sell.api';
import type {
  Boost,
  CreateListingInput,
  UpdateListingInput,
} from './types';

const IDEM_PREFIX = 'mkt_sell_idem_';

async function getOrCreateIdemKey(operationKey: string): Promise<string> {
  const storageKey = IDEM_PREFIX + operationKey;
  const existing = await getSecureItem(storageKey);
  if (existing) return existing;
  const fresh = newMktIdempotencyKey();
  await setSecureItem(storageKey, fresh);
  return fresh;
}

async function clearIdemKey(operationKey: string): Promise<void> {
  await deleteSecureItem(IDEM_PREFIX + operationKey);
}

export const SELL_KEYS = {
  categories: ['mkt', 'sell', 'categories'] as const,
  category: (id: string) => ['mkt', 'sell', 'category', id] as const,
  myListings: ['mkt', 'sell', 'my-listings'] as const,
  listing: (id: string) => ['mkt', 'listing', id] as const,
  boostPricing: ['mkt', 'sell', 'boost-pricing'] as const,
  boost: (id: string) => ['mkt', 'sell', 'boost', id] as const,
  boostQuote: (durationDays?: number, endsAt?: string) => ['mkt', 'sell', 'boost-quote', durationDays ?? '', endsAt ?? ''] as const,
  insights: (id: string) => ['mkt', 'sell', 'insights', id] as const,
};

export function useCurrentSellerId(): string | null {
  return useAuthStore((s) => s.user?.id ?? null);
}

export const useSellCategories = () =>
  useQuery({ queryKey: SELL_KEYS.categories, queryFn: sellApi.getCategories, staleTime: 5 * 60_000 });

export const useSellCategory = (id: string | null) =>
  useQuery({
    queryKey: SELL_KEYS.category(id ?? ''),
    queryFn: () => sellApi.getCategory(id as string),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

export function useMyListings() {
  const sellerId = useCurrentSellerId();
  return useQuery({
    queryKey: SELL_KEYS.myListings,
    queryFn: () => sellApi.getMyListings(sellerId),
  });
}

export function useCreateListing() {
  return useMutation({ mutationFn: (input: CreateListingInput) => sellApi.createListing(input) });
}

export function useUpdateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateListingInput }) => sellApi.updateListing(id, input),
    onSuccess: (listing) => qc.setQueryData(SELL_KEYS.listing(listing.id), listing),
  });
}

function useListingMediaMutation<TArgs extends { id: string }>(
  mutationFn: (args: TArgs) => Promise<import('./types').Listing>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (listing) => {
      qc.setQueryData(SELL_KEYS.listing(listing.id), listing);
      qc.invalidateQueries({ queryKey: SELL_KEYS.myListings });
    },
  });
}

export const useAddListingMedia = () =>
  useListingMediaMutation(({ id, mediaIds }: { id: string; mediaIds: string[] }) => sellApi.addListingMedia(id, mediaIds));

export const useRemoveListingMedia = () =>
  useListingMediaMutation(({ id, mediaId }: { id: string; mediaId: string }) => sellApi.removeListingMedia(id, mediaId));

export const useReorderListingMedia = () =>
  useListingMediaMutation(({ id, mediaIds }: { id: string; mediaIds: string[] }) => sellApi.reorderListingMedia(id, mediaIds));

export function useSubmitListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sellApi.submitListing(id),
    onSuccess: (listing) => {
      qc.setQueryData(SELL_KEYS.listing(listing.id), listing);
      qc.invalidateQueries({ queryKey: SELL_KEYS.myListings });
    },
  });
}

export const useSellListing = (id: string | null) =>
  useQuery({
    queryKey: SELL_KEYS.listing(id ?? ''),
    queryFn: () => sellApi.getListing(id as string),
    enabled: !!id,
  });

function useListingLifecycle(mutationFn: (id: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutationFn(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SELL_KEYS.myListings }),
  });
}

export const usePauseListing = () => useListingLifecycle(sellApi.pauseListing);
export const useResumeListing = () => useListingLifecycle(sellApi.resumeListing);
export const useRenewListing = () => useListingLifecycle(sellApi.renewListing);
export const useDeleteListing = () => useListingLifecycle(sellApi.deleteListing);

// PERMANENT deletion — irreversible, and distinct from useDeleteListing which
// only soft-removes. The server refuses (409 LISTING_HAS_HISTORY) when the
// listing carries orders, boosts, offers or buyer threads, so callers must
// surface the error message rather than assume success.
export const usePurgeListing = () => useListingLifecycle(sellApi.purgeListing);

// Bulk manage (LM-006). No batch endpoint exists, so this fans out over the
// per-listing lifecycle calls and reports partial success. Uses allSettled so one
// { ok, failed } counts so the UI can surface partial failures.
export function useBulkListings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: 'delete' | 'pause' | 'resume' }) => {
      const fn = action === 'delete' ? sellApi.deleteListing : action === 'pause' ? sellApi.pauseListing : sellApi.resumeListing;
      const results = await Promise.allSettled(ids.map((id) => fn(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { action, ok: ids.length - failed, failed };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SELL_KEYS.myListings }),
  });
}

export function useMarkSold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, viaEscrow }: { id: string; viaEscrow: boolean }) => sellApi.markSold(id, viaEscrow),
    onSuccess: () => qc.invalidateQueries({ queryKey: SELL_KEYS.myListings }),
  });
}

// One number drives every boost price: the admin's live ₦/day rate (see
// api/sell.api.getBoostPricing). Kept briefly stale rather than cached long — an
// admin can reprice at any moment and the next load should reflect it.
export const useBoostPricing = () =>
  useQuery({ queryKey: SELL_KEYS.boostPricing, queryFn: sellApi.getBoostPricing, staleTime: 30_000 });

// Seller performance for one listing. Short staleTime: a seller opening this
// screen wants the current figures, not a cached snapshot from earlier today.
export const useListingInsights = (id: string | null) =>
  useQuery({
    queryKey: SELL_KEYS.insights(id ?? ''),
    queryFn: () => sellApi.getListingInsights(id as string),
    enabled: !!id,
    staleTime: 15_000,
  });

export const useBoost = (id: string | null) =>
  useQuery({
    queryKey: SELL_KEYS.boost(id ?? ''),
    queryFn: () => sellApi.getBoost(id as string),
    enabled: !!id,
  });

// Live price preview for a would-be boost purchase — pass exactly one of
// durationDays/endsAt. Disabled until one is actually chosen, so the screen doesn't
// fire a request for an incomplete selection.
export const useBoostQuote = (params: { durationDays?: number; endsAt?: string }) =>
  useQuery({
    queryKey: SELL_KEYS.boostQuote(params.durationDays, params.endsAt),
    queryFn: () => sellApi.getBoostQuote(params),
    enabled: params.durationDays != null || !!params.endsAt,
  });

/**
 * Purchase a boost (money path). Pass either { durationDays } for a whole-day
 * boost starting now or { endsAt } for one ending at a chosen moment. The
 * Idempotency-Key is persisted per listingId+selection BEFORE the charge fires, so
 * a retry after an app-kill reuses it and the backend's dedupe window makes the
 * retry a safe replay (never a double-debit). Cleared on terminal success. On a
 * 409 idempotency replay the echoed original Boost is returned.
 */
export function usePurchaseBoost(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (selection: { durationDays?: number; endsAt?: string }): Promise<Boost> => {
      const operationKey = `boost:${listingId}:${selection.durationDays ?? `custom:${selection.endsAt}`}`;
      const idemKey = await getOrCreateIdemKey(operationKey);
      try {
        const boost = await sellApi.createBoost({ listingId, durationDays: selection.durationDays, endsAt: selection.endsAt }, idemKey);
        await clearIdemKey(operationKey);
        return boost;
      } catch (e) {
        if (e instanceof MktApiError && e.isIdempotentReplay && e.replayBody) {
          await clearIdemKey(operationKey);
          return e.replayBody as Boost;
        }
        throw e;
      }
    },
    onSuccess: (boost) => qc.setQueryData(SELL_KEYS.boost(boost.id), boost),
  });
}

// Stop the caller's own active boost early (prorated refund on the backend).
// No Idempotency-Key: unlike a purchase, a retried cancel on an
// already-cancelled boost is safely rejected server-side (FSM guard), not a
// double charge, so there is nothing to dedupe against.
export function useCancelBoost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sellApi.cancelBoost(id),
    onSuccess: (boost) => qc.setQueryData(SELL_KEYS.boost(boost.id), boost),
  });
}
