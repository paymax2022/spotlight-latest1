// ── Paymax Health — Symptom search flow store ────────────────────────────────
// Tiny zustand store (mirrors cartStore) so the symptom screens (home → refine →
// results → escalation) share terms/refiners without serialising router params —
// NDPR: symptom terms are sensitive health data and should not leak into URLs.

import { create } from 'zustand';
import { Colors } from '@/constants/colors';
import type { SymptomRefiners, PharmacySkuOption } from '../api/symptomSearch.api';
import type { PharmacyProduct } from './types';

interface SymptomSearchState {
  terms: string[];
  refiners: SymptomRefiners;
  /**
   * Server-logged symptom-search event id for the CURRENT result set. Passed
   * through to order creation (`search_event_id`) so the order links back to the
   * symptom context. Cleared whenever terms change (a new search starts) and
   * after a successful order creation.
   */
  searchEventId: string | null;
  toggleTerm: (term: string) => void;
  addTerm: (term: string) => void;
  removeTerm: (term: string) => void;
  setRefiners: (refiners: SymptomRefiners) => void;
  setSearchEventId: (id: string | null) => void;
  reset: () => void;
}

const MAX_TERMS = 5; // contract: terms maxItems 5

export const useSymptomSearchStore = create<SymptomSearchState>((set) => ({
  terms: [],
  refiners: {},
  searchEventId: null,

  toggleTerm: (term) =>
    set((st) => ({
      terms: st.terms.includes(term)
        ? st.terms.filter((t) => t !== term)
        : st.terms.length >= MAX_TERMS
          ? st.terms
          : [...st.terms, term],
      searchEventId: null,
    })),

  addTerm: (term) =>
    set((st) => {
      const clean = term.trim();
      if (!clean || st.terms.includes(clean) || st.terms.length >= MAX_TERMS) return st;
      return { terms: [...st.terms, clean], searchEventId: null };
    }),

  removeTerm: (term) =>
    set((st) => ({ terms: st.terms.filter((t) => t !== term), searchEventId: null })),

  setRefiners: (refiners) => set({ refiners }),

  setSearchEventId: (id) => set({ searchEventId: id }),

  reset: () => set({ terms: [], refiners: {}, searchEventId: null }),
}));

/**
 * Adapt a symptom-search SKU to the catalog product shape so it rides the
 * EXISTING cart mechanism (cartStore.add) — no parallel cart, one checkout path.
 * PHARMACY_ONLY maps to rxRequired=false (it is not POM; the pharmacist check
 * happens via the order review case, not the Rx gate).
 */
export function skuToCartProduct(sku: PharmacySkuOption): PharmacyProduct {
  return {
    id: sku.product_id,
    // Symptom-search SKUs aren't pre-attributed to a pharmacy; the owning
    // pharmacy is chosen at checkout (pharmacy-select), so leave these blank.
    pharmacyId: '',
    pharmacyName: '',
    name: sku.name,
    brand: sku.brand,
    form: sku.pack_size,
    category: 'otc',
    priceKobo: sku.price_kobo,
    nafdacReg: sku.nafdac_reg_no,
    rxRequired: false,
    imageColor: sku.classification === 'PHARMACY_ONLY' ? Colors.iconBgBlue : Colors.iconBgTeal,
    description: '',
    inStock: sku.in_stock,
    rating: 0,
    reviewCount: 0,
    manufacturer: sku.brand,
  };
}
