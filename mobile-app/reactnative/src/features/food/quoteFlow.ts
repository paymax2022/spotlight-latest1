// FOOD-UAT-C-007 / C-011: pure helpers for the quote-based pay-sheet and promo
// preview. No React / RN imports so they run under node:test.

import type { OrderQuote, PromoPreview } from './types';

export interface QuoteRow {
  key: string;
  label: string;
  /** Signed kobo: negative for a discount. */
  kobo: number;
  strong?: boolean;
}

/**
 * The rows the summary renders for a SERVER quote. Zero-valued optional charges
 * (service fee, surge, promo) are omitted; subtotal, delivery, packaging and the
 * total always show, so nothing the buyer pays is hidden.
 */
export function quoteRows(q: OrderQuote): QuoteRow[] {
  const rows: QuoteRow[] = [{ key: 'subtotal', label: 'Subtotal', kobo: q.subtotalKobo }];
  if (q.serviceFeeKobo > 0) rows.push({ key: 'service', label: 'Service fee', kobo: q.serviceFeeKobo });
  rows.push({ key: 'delivery', label: 'Delivery fee', kobo: q.deliveryFeeKobo });
  if (q.surgeKobo > 0) {
    rows.push({ key: 'surge', label: `Surge (${(q.surgeBp / 100).toFixed(q.surgeBp % 100 === 0 ? 0 : 1)}%)`, kobo: q.surgeKobo });
  }
  rows.push({ key: 'packaging', label: 'Takeaway packaging', kobo: q.packagingKobo });
  if (q.promoDiscountKobo > 0) rows.push({ key: 'promo', label: 'Promo discount', kobo: -q.promoDiscountKobo });
  if (q.tipKobo > 0) rows.push({ key: 'tip', label: 'Tip', kobo: q.tipKobo });
  rows.push({ key: 'total', label: 'Total', kobo: q.totalKobo, strong: true });
  return rows;
}

/** True once the quote's `expires_at` has passed (an unparsable date counts as expired). */
export function isQuoteExpired(q: Pick<OrderQuote, 'expiresAt'>, now = Date.now()): boolean {
  const t = Date.parse(q.expiresAt);
  return !Number.isFinite(t) || t <= now;
}

/**
 * Did PlaceOrder refuse because the price moved since the quote? Matches the
 * stable code `price_changed` (any case, `PRICE_CHANGED`), or the same words in
 * the message of a 409/412/422 so a backend that only sends text still works.
 */
export function isPriceChangedError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: number; response?: { status?: number; data?: { code?: unknown; error?: unknown } }; message?: unknown } | null;
  if (!e) return false;
  const code = String(e.response?.data?.code ?? e.code ?? '').toLowerCase();
  if (code === 'price_changed' || code === 'price-changed') return true;
  const status = e.response?.status ?? e.status;
  const msg = String(e.response?.data?.error ?? e.message ?? '').toLowerCase();
  return (status === 409 || status === 412 || status === 422) && /price[ _-]?changed|total (no longer|has) (match|changed)/.test(msg);
}

/** Inline text for a promo preview; null when valid (the discount line shows instead). */
export function promoErrorMessage(p: Pick<PromoPreview, 'valid' | 'reason'>): string | null {
  if (p.valid) return null;
  switch (p.reason) {
    case 'expired':
      return 'This code has expired.';
    case 'not_started':
      return "This code isn't active yet.";
    case 'not_eligible':
      return "This code can't be used on this order.";
    case 'invalid':
    default:
      return 'This code is not valid.';
  }
}

/** Stable signature of the cart lines + inputs a quote depends on (react-query key / stale check). */
export function pricingSignature(input: {
  restaurantId: string;
  items: { itemId: string; qty: number; restaurantId?: string; modifierIds?: string[] }[];
  packageCount?: number;
  lat?: number | null;
  lng?: number | null;
  promoCode?: string;
}): string {
  const lines = input.items
    .map((i) => `${i.restaurantId ?? ''}:${i.itemId}:${i.qty}:${[...(i.modifierIds ?? [])].sort().join('+')}`)
    .sort()
    .join('|');
  return [input.restaurantId, lines, input.packageCount ?? 0, input.lat ?? '', input.lng ?? '', (input.promoCode ?? '').trim().toUpperCase()].join('#');
}
