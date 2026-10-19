//   • mock  → ../api/discovery.mock fixtures (offline-first, camelCase already)
//   • live  → the shared client (mktGet/…) which normalizes snake→camel for us.
// searchListings() catches that (err.isSearchNotWired) and falls back to the mock
// result set so Results/Map never dead-end while search is being provisioned.

import { MKT_USE_MOCK, MktApiError, mktGet, mktPost, mktDelete, mktPatch, arr } from './client';
import * as M from './discovery.mock';
import { DEFAULT_RADIUS_KM } from '../proximity';
import type {
  Category,
  Listing,
  ListingSummary,
  SavedItem,
  SavedSearch,
  SearchParams,
  SearchResponse,
  SearchSuggestion,
  SellerProfile,
  Review,
} from '../types';

export async function searchListings(params: SearchParams): Promise<SearchResponse> {
  if (MKT_USE_MOCK) return M.mockSearch(params);
  try {
    const res = await mktGet<SearchResponse>('/search', params as Record<string, unknown>);
    return { ...res, results: arr(res?.results) };
  } catch (e) {
    // GET /search is 501 until ES is wired — degrade to the local set rather than error out.
    if (e instanceof MktApiError && e.isSearchNotWired) {
      return M.mockSearch(params);
    }
    throw e;
  }
}

/** Instant-suggest for the Search screen. No dedicated backend endpoint yet, so
 *  this is mock-only today; live builds fall back to a title/category prefix over
 *  a small search page (kept graceful — never blocks typing). */
export async function suggest(q: string): Promise<SearchSuggestion[]> {
  if (MKT_USE_MOCK) return M.mockSuggest(q);
  try {
    const res = await searchListings({ q, limit: 6 });
    return res.results.slice(0, 6).map((r) => ({ type: 'query' as const, text: r.title }));
  } catch {
    return [];
  }
}

export async function trendingSearches(): Promise<string[]> {
  if (MKT_USE_MOCK) return M.mockTrending();
  // No backend endpoint; the mock trending list is a safe static fallback.
  return M.mockTrending();
}

export async function getListing(id: string): Promise<Listing> {
  if (MKT_USE_MOCK) return M.mockGetListing(id);
  return mktGet<Listing>(`/listings/${id}`);
}

// /search sorts. Kept resilient — a rail failing returns empty rather than
// blanking the whole Home screen.

export interface HomeRails {
  nearYou: ListingSummary[];
  priceDrops: ListingSummary[];
  escrowEligible: ListingSummary[];
}

/** Home rails. `coords` is the buyer's own fix; without it there is no
 *  proximity to search on, and "Near you" stays empty by design — a rail that
 *  fills with the newest listings from anywhere in the country is a lie about
 *  distance, which is the one thing this rail claims. */
export async function getHomeRails(coords?: { lat: number; lng: number } | null, radiusKm = DEFAULT_RADIUS_KM): Promise<HomeRails> {
  if (MKT_USE_MOCK) return M.mockHomeRails();
  const safe = async (p: SearchParams): Promise<ListingSummary[]> => {
    try {
      return arr((await searchListings(p)).results);
    } catch {
      return [];
    }
  };
  const [nearYou, escrowEligible] = await Promise.all([
    coords
      ? safe({ ...coords, radiusKm, sort: 'nearby', limit: 12 })
      : Promise.resolve<ListingSummary[]>([]),
    safe({ escrowEligibleOnly: true, sort: 'trusted_first', limit: 12 }),
  ]);
  return { nearYou, priceDrops: [], escrowEligible };
}

export async function getCategories(): Promise<Category[]> {
  if (MKT_USE_MOCK) return M.mockCategories();
  return arr(await mktGet<Category[]>('/categories'));
}

export async function getCategory(id: string): Promise<Category> {
  if (MKT_USE_MOCK) return M.mockGetCategory(id);
  return mktGet<Category>(`/categories/${id}`);
}

export async function getSellerProfile(id: string): Promise<SellerProfile> {
  if (MKT_USE_MOCK) return M.mockSellerProfile(id);
  return mktGet<SellerProfile>(`/sellers/${id}/profile`);
}

export async function getSellerListings(id: string): Promise<ListingSummary[]> {
  if (MKT_USE_MOCK) return M.mockSellerListings(id);
  return arr(await mktGet<ListingSummary[]>(`/sellers/${id}/listings`));
}

export async function getSellerReviews(id: string): Promise<Review[]> {
  if (MKT_USE_MOCK) return M.mockSellerReviews(id);
  return arr(await mktGet<Review[]>(`/sellers/${id}/reviews`));
}

// Live source: GET /saved-items (added by the Trust/Account build — see
// BUILD-STATUS §"Saved-items live enrichment"). The backend returns each
// SavedItem shape ({ listing: summary, savedPriceKobo, savedAt }) the Saved
// Items screen renders, so the "price changed" badge can compare saved vs.
// current price. Rows whose listing has since been removed (no join) are
// dropped rather than rendered as a blank card.

/** Wire shape of one GET /saved-items row (already deep-camelCased by client). */
interface SavedItemRow {
  savedPriceKobo: number;
  createdAt: string;
  listing?: Listing;
}

export async function getSavedItems(): Promise<SavedItem[]> {
  if (MKT_USE_MOCK) return M.mockSavedItems();
  const rows = arr(await mktGet<SavedItemRow[]>('/saved-items'));
  return rows
    .filter((r): r is SavedItemRow & { listing: Listing } => Boolean(r.listing))
    .map((r) => ({
      listing: M.toSummary(r.listing),
      savedPriceKobo: r.savedPriceKobo,
      savedAt: r.createdAt,
    }));
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  if (MKT_USE_MOCK) return M.mockListSavedSearches();
  return arr(await mktGet<SavedSearch[]>('/saved-searches'));
}

export async function createSavedSearch(query: string | undefined, filters: Record<string, unknown>): Promise<SavedSearch> {
  if (MKT_USE_MOCK) return M.mockCreateSavedSearch(query, filters);
  return mktPost<SavedSearch>('/saved-searches', { query, filters, alertEnabled: true });
}

export async function deleteSavedSearch(id: string): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) return M.mockDeleteSavedSearch(id);
  return mktDelete<{ ok: boolean }>(`/saved-searches/${id}`);
}

export async function toggleSavedSearch(id: string, alertEnabled: boolean, frequency?: 'instant' | 'daily' | 'off'): Promise<SavedSearch> {
  if (MKT_USE_MOCK) return M.mockToggleSavedSearch(id, alertEnabled, frequency);
  return mktPatch<SavedSearch>(`/saved-searches/${id}`, { alertEnabled, alertFrequency: frequency });
}
