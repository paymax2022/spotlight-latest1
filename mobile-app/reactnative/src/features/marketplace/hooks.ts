// ── Marketplace — Discover React Query hooks ─────────────────────────────────
// Query keys namespaced under ['mkt', …]; mutations invalidate the relevant
// queries. These cover the Discovery group (screens 1–9); sibling agents add
// their own hooks for Sell/Transact/Account against the same client.
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { discoveryApi } from './index';
import type { SearchParams } from './types';

export const MKT_KEYS = {
  categories: ['mkt', 'categories'] as const,
  category: (id: string) => ['mkt', 'category', id] as const,
  homeRails: (coords?: { lat: number; lng: number }) => ['mkt', 'home-rails', coords ?? null] as const,
  search: (params: SearchParams) => ['mkt', 'search', params] as const,
  suggest: (q: string) => ['mkt', 'suggest', q] as const,
  trending: ['mkt', 'trending'] as const,
  listing: (id: string) => ['mkt', 'listing', id] as const,
  savedItems: ['mkt', 'saved-items'] as const,
  savedSearches: ['mkt', 'saved-searches'] as const,
  sellerProfile: (id: string) => ['mkt', 'seller', id, 'profile'] as const,
  sellerListings: (id: string) => ['mkt', 'seller', id, 'listings'] as const,
  sellerReviews: (id: string) => ['mkt', 'seller', id, 'reviews'] as const,
};

// ── Home ────────────────────────────────────────────────────────────────────
export const useCategories = () =>
  useQuery({ queryKey: MKT_KEYS.categories, queryFn: discoveryApi.getCategories, staleTime: 5 * 60_000 });

export const useCategory = (id: string) =>
  useQuery({ queryKey: MKT_KEYS.category(id), queryFn: () => discoveryApi.getCategory(id), enabled: !!id, staleTime: 5 * 60_000 });

export const useHomeRails = (coords?: { lat: number; lng: number }) =>
  useQuery({ queryKey: MKT_KEYS.homeRails(coords), queryFn: () => discoveryApi.getHomeRails(coords) });

// ── Search / Results ──────────────────────────────────────────────────────────
export const useSearch = (params: SearchParams, enabled = true) =>
  useQuery({
    queryKey: MKT_KEYS.search(params),
    queryFn: () => discoveryApi.searchListings(params),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useSuggest = (q: string) =>
  useQuery({ queryKey: MKT_KEYS.suggest(q), queryFn: () => discoveryApi.suggest(q), enabled: q.trim().length > 1, staleTime: 30_000 });

export const useTrending = () =>
  useQuery({ queryKey: MKT_KEYS.trending, queryFn: discoveryApi.trendingSearches, staleTime: 5 * 60_000 });

// ── Listing detail ────────────────────────────────────────────────────────────
export const useListing = (id: string) =>
  useQuery({ queryKey: MKT_KEYS.listing(id), queryFn: () => discoveryApi.getListing(id), enabled: !!id, retry: 1 });

// ── Seller ─────────────────────────────────────────────────────────────────────
export const useSellerProfile = (id: string) =>
  useQuery({ queryKey: MKT_KEYS.sellerProfile(id), queryFn: () => discoveryApi.getSellerProfile(id), enabled: !!id });

export const useSellerListings = (id: string) =>
  useQuery({ queryKey: MKT_KEYS.sellerListings(id), queryFn: () => discoveryApi.getSellerListings(id), enabled: !!id });

export const useSellerReviews = (id: string) =>
  useQuery({ queryKey: MKT_KEYS.sellerReviews(id), queryFn: () => discoveryApi.getSellerReviews(id), enabled: !!id });

// ── Saved items ────────────────────────────────────────────────────────────────
export const useSavedItems = () =>
  useQuery({ queryKey: MKT_KEYS.savedItems, queryFn: discoveryApi.getSavedItems });

// ── Saved searches ───────────────────────────────────────────────────────────
export const useSavedSearches = () =>
  useQuery({ queryKey: MKT_KEYS.savedSearches, queryFn: discoveryApi.listSavedSearches });

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { query?: string; filters: Record<string, unknown> }) =>
      discoveryApi.createSavedSearch(input.query, input.filters),
    onSuccess: () => qc.invalidateQueries({ queryKey: MKT_KEYS.savedSearches }),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => discoveryApi.deleteSavedSearch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: MKT_KEYS.savedSearches }),
  });
}

export function useToggleSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; alertEnabled: boolean; frequency?: 'instant' | 'daily' | 'off' }) =>
      discoveryApi.toggleSavedSearch(input.id, input.alertEnabled, input.frequency),
    onSuccess: () => qc.invalidateQueries({ queryKey: MKT_KEYS.savedSearches }),
  });
}
