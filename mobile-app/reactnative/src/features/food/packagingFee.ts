// ── Restaurant & Delivery — takeaway packaging, priced or unknown ─────────────
//
// Packaging is MANDATORY and server-charged: PlaceOrder reads packaging_fee_kobo
// off the restaurant row and adds one fee per pack. The checkout estimate has to
// mirror that, and it can only do so once the restaurant has loaded.
//
// Checkout used to read `restaurant?.packagingFeeKobo ?? 0`, so any time the
// restaurant had not loaded — still fetching, or a 404/500 — the line rendered
// "Takeaway packaging (3 packs)  ₦0.00" and the estimated total was short by the
// real amount, which the server then charged. Every restaurant in the dev
// database charges ₦200 a pack, so this was never actually free.
//
// Same rule delivery already follows in resolveDeliveryFee: a price nobody has
// quoted is UNKNOWN, and unknown must never be rendered as ₦0.

import type { CartPackage } from './types';

/** How packaging should be shown, and what to add to the estimate. */
export interface PackagingFeeView {
  /** Kobo to include in the estimated total. 0 only when `known` is false. */
  feeKobo: number;
  /** True when the per-pack price came from the restaurant. */
  known: boolean;
  /** Packs being charged for, regardless of whether the price is known. */
  packCount: number;
}

/**
 * Price the cart's packs.
 *
 * `perPackKobo` is the restaurant's packaging_fee_kobo; pass null/undefined when
 * the restaurant has not loaded. A restaurant that genuinely charges nothing
 * reports 0, which is KNOWN and different from "not loaded".
 */
export function resolvePackagingFee(
  packages: CartPackage[],
  perPackKobo: number | null | undefined,
): PackagingFeeView {
  const packCount = packages.filter((p) => p.lines.length > 0).length;
  if (typeof perPackKobo !== 'number' || !Number.isFinite(perPackKobo)) {
    return { feeKobo: 0, known: false, packCount };
  }
  // Mirrors cartPackagingKobo: one pack fee per non-empty package. Inlined so
  // this module stays free of the store (and of React Native), and can be tested.
  return { feeKobo: packCount * Math.trunc(perPackKobo), known: true, packCount };
}
