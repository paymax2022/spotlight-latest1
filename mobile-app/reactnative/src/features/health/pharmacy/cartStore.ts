// Lightweight zustand store so the catalog / product / cart / checkout screens
// share one cart without threading objects through router params. Money in kobo.

import { create } from 'zustand';
import type { Cart, CartLine, PharmacyProduct } from './types';

const DELIVERY_FEE_KOBO = 120000; // default; the chosen pharmacy can override.

function recompute(lines: CartLine[], deliveryFeeKobo: number): Cart {
  const subtotalKobo = lines.reduce((s, l) => s + l.priceKobo * l.qty, 0);
  return {
    lines,
    subtotalKobo,
    deliveryFeeKobo: lines.length ? deliveryFeeKobo : 0,
    // Goods only — deliberately NOT subtotal + delivery. CreateOrder prices the order
    // at Σ(price × qty) and holds exactly that; the courier's fare is a separate
    // transport money event it never touches. A total that added the fee promised a
    // hold larger than the money actually moved.
    totalKobo: subtotalKobo,
    requiresRx: lines.some((l) => l.rxRequired),
    // Set by the first line added; the store refuses a second pharmacy's product.
    pharmacyId: lines[0]?.pharmacyId ?? '',
    pharmacyName: lines[0]?.pharmacyName ?? '',
  };
}

interface CartState {
  lines: CartLine[];
  deliveryFeeKobo: number;
  /** Selected pharmacy + Rx attached at checkout time. */
  pharmacyId?: string;
  rxId?: string;
  cart: () => Cart;
  count: () => number;
  /** Adds to the cart. Returns false when the product belongs to a different
   *  pharmacy than the cart's — one order is one pharmacy, so a mixed cart could
   *  never be placed (see add()). */
  add: (product: PharmacyProduct, qty?: number) => boolean;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  setPharmacy: (pharmacyId: string, deliveryFeeKobo: number) => void;
  setRx: (rxId?: string) => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  lines: [],
  deliveryFeeKobo: DELIVERY_FEE_KOBO,
  pharmacyId: undefined,
  rxId: undefined,

  cart: () => recompute(get().lines, get().deliveryFeeKobo),
  count: () => get().lines.reduce((s, l) => s + l.qty, 0),

  add: (product, qty = 1) => {
    const st = get();
    // Only products carrying a pharmacy_provider_id may enter the cart. CreateOrder
    // prices every line with `WHERE id=$1 AND pharmacy_provider_id=$2`, so an
    // unattributed item (e.g. a symptom-search SKU, which the server returns without
    // pharmacy attribution) can never be matched to the order's pharmacy — adding it
    // would build a cart that is guaranteed to fail at payment.
    if (!product.pharmacyId) return false;
    const owner = st.lines[0]?.pharmacyId;
    if (owner && owner !== product.pharmacyId) return false;
    set(() => {
      const existing = st.lines.find((l) => l.productId === product.id);
      const lines = existing
        ? st.lines.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + qty } : l))
        : [
            ...st.lines,
            {
              productId: product.id,
              pharmacyId: product.pharmacyId,
              pharmacyName: product.pharmacyName,
              name: product.name,
              form: product.form,
              priceKobo: product.priceKobo,
              qty,
              rxRequired: product.rxRequired,
              imageColor: product.imageColor,
            },
          ];
      return { lines, pharmacyId: product.pharmacyId || st.pharmacyId };
    });
    return true;
  },

  setQty: (productId, qty) =>
    set((st) => ({
      lines: qty <= 0 ? st.lines.filter((l) => l.productId !== productId) : st.lines.map((l) => (l.productId === productId ? { ...l, qty } : l)),
    })),

  remove: (productId) => set((st) => ({ lines: st.lines.filter((l) => l.productId !== productId) })),

  clear: () => set({ lines: [], pharmacyId: undefined, rxId: undefined }),

  setPharmacy: (pharmacyId, deliveryFeeKobo) => set({ pharmacyId, deliveryFeeKobo }),
  setRx: (rxId) => set({ rxId }),
}));

/** Idempotency-Key for money mutations (HL-9 / NL-9) — timestamp + random. */
export function newIdempotencyKey(prefix = 'phx'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
