// ── Marketplace — Sell React Query hooks ─────────────────────────────────────
// Query keys namespaced under ['mkt','sell', …]; mutations invalidate/patch the
// relevant queries. Layered on the Sell API (./api/sell.api) which itself talks
// the shared client. Mirrors the Discover hooks conventions.
//
// The boost purchase is the one money mutation here: it PERSISTS an
// Idempotency-Key (SecureStore-backed, keyed by listingId+tier) so an app-kill
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

// ─── Idempotency-Key persistence (SecureStore-backed) ────────────────────────
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

// ─── Query keys ───────────────────────────────────────────────────────────────
export const SELL_KEYS = {
  categories: ['mkt', 'sell', 'categories'] as const,
  category: (id: string) => ['mkt', 'sell', 'category', id] as const,
  myListings: ['mkt', 'sell', 'my-listings'] as const,
  listing: (id: string) => ['mkt', 'listing', id] as const,
  boostTiers: ['mkt', 'sell', 'boost-tiers'] as const,
  boost: (id: string) => ['mkt', 'sell', 'boost', id] as const,
  boostQuote: (tier?: string, endsAt?: string) => ['mkt', 'sell', 'boost-quote', tier ?? '', endsAt ?? ''] as const,
};

// ─── Current seller id (for GET /sellers/:id/listings) ───────────────────────
export function useCurrentSellerId(): string | null {
  return useAuthStore((s) => s.user?.id ?? null);
}

// ─── Categories / attribute schema ────────────────────────────────────────────
export const useSellCategories = () =>
  useQuery({ queryKey: SELL_KEYS.categories, queryFn: sellApi.getCategories, staleTime: 5 * 60_000 });

export const useSellCategory = (id: string | null) =>
  useQuery({
    queryKey: SELL_KEYS.category(id ?? ''),
    queryFn: () => sellApi.getCategory(id as string),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

// ─── My Listings dashboard (screen 15) ────────────────────────────────────────
export function useMyListings() {
  const sellerId = useCurrentSellerId();
  return useQuery({
    queryKey: SELL_KEYS.myListings,
    queryFn: () => sellApi.getMyListings(sellerId),
  });
}

// ─── Listing (create → submit is the publish sequence, screen 14) ────────────
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

// ─── Listing lifecycle quick actions (screen 15) ─────────────────────────────
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

// Bulk manage (LM-006). No batch endpoint exists, so this fans out over the
// per-listing lifecycle calls and reports partial success. Uses allSettled so one
// failure never aborts the rest; refreshes My Listings once at the end. Returns
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

// ─── Boosts (screens 16–17) ───────────────────────────────────────────────────
export const useBoostTiers = () =>
  useQuery({ queryKey: SELL_KEYS.boostTiers, queryFn: sellApi.getBoostTiers, staleTime: 5 * 60_000 });

export const useBoost = (id: string | null) =>
  useQuery({
    queryKey: SELL_KEYS.boost(id ?? ''),
    queryFn: () => sellApi.getBoost(id as string),
    enabled: !!id,
  });

// Live price preview for a would-be boost purchase — pass exactly one of
// tier/endsAt. Disabled until one is actually chosen, so the screen doesn't
// fire a request for an incomplete selection.
export const useBoostQuote = (params: { tier?: string; endsAt?: string }) =>
  useQuery({
    queryKey: SELL_KEYS.boostQuote(params.tier, params.endsAt),
    queryFn: () => sellApi.getBoostQuote(params),
    enabled: !!(params.tier || params.endsAt),
  });

/**
 * Purchase a boost (money path). Pass either { tier } for a preset package or
 * { endsAt } for a custom date-range boost. The Idempotency-Key is persisted
 * per listingId+selection BEFORE the charge fires, so a retry after an
 * app-kill reuses it and the backend's dedupe window makes the retry a safe
 * replay (never a double-debit). Cleared on terminal success. On a 409
 * idempotency replay the echoed original Boost is returned.
 */
export function usePurchaseBoost(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (selection: { tier?: string; endsAt?: string }): Promise<Boost> => {
      const operationKey = `boost:${listingId}:${selection.tier ?? `custom:${selection.endsAt}`}`;
      const idemKey = await getOrCreateIdemKey(operationKey);
      try {
        const boost = await sellApi.createBoost({ listingId, tier: selection.tier, endsAt: selection.endsAt }, idemKey);
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
