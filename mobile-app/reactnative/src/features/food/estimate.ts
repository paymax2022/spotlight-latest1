// ── Restaurant & Delivery — what the checkout estimate is allowed to contain ──
//
// Every component here must come from the SERVER. The estimate exists to tell a
// customer what they are about to be charged, so a number the client invented is
// not a conservative guess — it is a wrong price on a payment screen.
//
// This was not hypothetical. Checkout added `Math.round(subtotal * 0.05)` as a
// "Service fee". The server charges service fee from the restaurant's own
// service_fee_bp, which is 0 for every restaurant in the database, and does not
// expose that rate to the client at all. So the client added ₦560 to a real
// ₦12,801.40 order, and the customer topped their wallet up to the inflated
// figure five seconds before paying — the invented line drove a funding decision,
// not just a display.
//
// Removed rather than corrected to 0: hardcoding the current value would break
// again the moment any restaurant sets a non-zero rate, and in the dangerous
// direction (charged MORE than quoted). If the platform ever charges this fee,
// the restaurant DTO must carry the rate and it gets added back from there.

/** The pieces of an estimate, each a server-derived integer kobo amount. */
export interface EstimateParts {
  /** Sum of line prices — the client's own cart, so exact. */
  subtotalKobo: number;
  /** From POST /restaurant/:id/delivery-quote. 0 when not yet quoted. */
  deliveryKobo: number;
  /** Pack count × the restaurant's packaging_fee_kobo. 0 when not yet known. */
  packagingKobo: number;
}

/**
 * The estimated total.
 *
 * Deliberately a plain sum with a fixed, named set of inputs: the value is that
 * adding a component means changing this signature, which is where the question
 * "does the server actually charge this?" has to be answered.
 */
export function estimateTotalKobo(parts: EstimateParts): number {
  const { subtotalKobo, deliveryKobo, packagingKobo } = parts;
  return [subtotalKobo, deliveryKobo, packagingKobo]
    .map((n) => (Number.isFinite(n) ? Math.trunc(n) : 0))
    .reduce((a, b) => a + b, 0);
}
