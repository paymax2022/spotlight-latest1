// ── Paymax Health — Pharmacy cart store ──────────────────────────────────────
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
    totalKobo: subtotalKobo + (lines.length ? deliveryFeeKobo : 0),
    requiresRx: lines.some((l) => l.rxRequired),
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
  add: (product: PharmacyProduct, qty?: number) => void;
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

  add: (product, qty = 1) =>
    set((st) => {
      const existing = st.lines.find((l) => l.productId === product.id);
      const lines = existing
        ? st.lines.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + qty } : l))
        : [
            ...st.lines,
            {
              productId: product.id,
              name: product.name,
              form: product.form,
              priceKobo: product.priceKobo,
              qty,
              rxRequired: product.rxRequired,
              imageColor: product.imageColor,
            },
          ];
      return { lines };
    }),

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
