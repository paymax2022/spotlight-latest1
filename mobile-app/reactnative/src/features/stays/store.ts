// ── Paymax Stays — Search & booking-draft store ──────────────────────────────
// Lightweight zustand store (matches realtor/searchStore) so the search/results/
// filter screens AND the multi-step booking flow share one source of truth
// without threading complex objects through router params.

import { create } from 'zustand';
import type {
  BookingDraft,
  GuestConfig,
  LeadGuest,
  Occupant,
  PaymentMethod,
  PrebookResult,
  SearchQuery,
  StaysFilter,
} from './types';

function defaultDates(): { checkIn: string; checkOut: string } {
  const inD = new Date();
  inD.setDate(inD.getDate() + 7);
  const outD = new Date(inD);
  outD.setDate(outD.getDate() + 2);
  return { checkIn: inD.toISOString().slice(0, 10), checkOut: outD.toISOString().slice(0, 10) };
}

const DEFAULT_GUESTS: GuestConfig = { adults: 2, children: 0, childrenAges: [], rooms: 1 };
const DEFAULT_QUERY: SearchQuery = { destination: '', ...defaultDates(), guests: DEFAULT_GUESTS };
const DEFAULT_FILTER: StaysFilter = { sort: 'top_picks' };

interface StaysState {
  // Search.
  query: SearchQuery;
  filter: StaysFilter;
  setQuery: (patch: Partial<SearchQuery>) => void;
  setGuests: (patch: Partial<GuestConfig>) => void;
  setFilter: (patch: Partial<StaysFilter>) => void;
  resetFilter: () => void;
  activeFilterCount: () => number;

  // Booking flow.
  draft: BookingDraft | null;
  addOnKeys: string[];
  promoCode: string | undefined;
  useLoyalty: boolean;
  leadGuest: LeadGuest | null;
  occupants: Occupant[];
  paymentMethod: PaymentMethod;
  prebook: PrebookResult | null;
  setDraft: (draft: BookingDraft) => void;
  toggleAddOn: (key: string) => void;
  setPromo: (code: string | undefined) => void;
  setUseLoyalty: (v: boolean) => void;
  setLeadGuest: (g: LeadGuest) => void;
  setOccupants: (o: Occupant[]) => void;
  setPaymentMethod: (m: PaymentMethod) => void;
  setPrebook: (p: PrebookResult | null) => void;
  resetBooking: () => void;
}

export const useStaysStore = create<StaysState>((set, get) => ({
  query: { ...DEFAULT_QUERY },
  filter: { ...DEFAULT_FILTER },
  setQuery: (patch) => set((s) => ({ query: { ...s.query, ...patch } })),
  setGuests: (patch) => set((s) => ({ query: { ...s.query, guests: { ...s.query.guests, ...patch } } })),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: { ...DEFAULT_FILTER } }),
  activeFilterCount: () => {
    const f = get().filter;
    let n = 0;
    if (f.minPriceKobo != null || f.maxPriceKobo != null) n++;
    if (f.minScore != null) n++;
    if (f.stars?.length) n++;
    if (f.propertyTypes?.length) n++;
    if (f.amenities?.length) n++;
    if (f.freeCancellation) n++;
    if (f.dealsOnly) n++;
    if (f.boardBasis) n++;
    return n;
  },

  draft: null,
  addOnKeys: [],
  promoCode: undefined,
  useLoyalty: false,
  leadGuest: null,
  occupants: [],
  paymentMethod: 'wallet',
  prebook: null,
  setDraft: (draft) => set({ draft }),
  toggleAddOn: (key) =>
    set((s) => ({
      addOnKeys: s.addOnKeys.includes(key)
        ? s.addOnKeys.filter((k) => k !== key)
        : [...s.addOnKeys, key],
    })),
  setPromo: (code) => set({ promoCode: code }),
  setUseLoyalty: (v) => set({ useLoyalty: v }),
  setLeadGuest: (g) => set({ leadGuest: g }),
  setOccupants: (o) => set({ occupants: o }),
  setPaymentMethod: (m) => set({ paymentMethod: m }),
  setPrebook: (p) => set({ prebook: p }),
  resetBooking: () =>
    set({
      draft: null,
      addOnKeys: [],
      promoCode: undefined,
      useLoyalty: false,
      leadGuest: null,
      occupants: [],
      paymentMethod: 'wallet',
      prebook: null,
    }),
}));
