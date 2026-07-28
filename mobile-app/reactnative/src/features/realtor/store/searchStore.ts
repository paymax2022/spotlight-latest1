// ── Spotlight Realtor — Search filter store ──────────────────────────────────
// Lightweight zustand store (matches src/store/authStore.ts usage) so the search
// results screen and the filter modal share one source of filter truth without
// threading complex objects through router params.

import { create } from 'zustand';
import type { ListingFilter } from '../types/realtor.types';

interface SearchState {
  filter: ListingFilter;
  setFilter: (patch: Partial<ListingFilter>) => void;
  replaceFilter: (filter: ListingFilter) => void;
  reset: () => void;
  /** Count of active (non-default) filters — drives the "Filters (n)" badge. */
  activeCount: () => number;
}

const DEFAULT: ListingFilter = { sort: 'newest' };

export const useSearchStore = create<SearchState>((set, get) => ({
  filter: { ...DEFAULT },
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  replaceFilter: (filter) => set({ filter }),
  reset: () => set({ filter: { ...DEFAULT } }),
  activeCount: () => {
    const f = get().filter;
    let n = 0;
    if (f.mode) n++;
    if (f.propertyType) n++;
    if (f.minPrice != null || f.maxPrice != null) n++;
    if (f.area) n++;
    if (f.minBedrooms != null) n++;
    if (f.minBathrooms != null) n++;
    if (f.furnishing) n++;
    if (f.amenities?.length) n++;
    if (f.verifiedOnly) n++;
    if (f.escrowOnly) n++;
    return n;
  },
}));
