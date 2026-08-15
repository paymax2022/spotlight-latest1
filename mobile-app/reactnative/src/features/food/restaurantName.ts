// ── Restaurant & Delivery — naming a cart section ────────────────────────────
//
// Checkout groups the cart's packages by restaurantId, but the store keeps only
// ONE `restaurantName` (the first restaurant added), so every other group
// rendered as "Restaurant 2", "Restaurant 3"… — a positional placeholder shown
// to a customer about to pay, next to real food and real prices.
//
// Lives outside cartStore.ts because that module pulls in zustand, react-native
// and AsyncStorage, none of which resolve under `node --test`. Types-only here,
// same reasoning as normalize.ts.

import type { CartLine } from './types';

/**
 * Name for one restaurant section of the cart.
 *
 * Resolution order:
 *   1. the name captured on a line when the item was added — the only source
 *      that stays correct for a restaurant discovery no longer lists (closed,
 *      or delisted since the item went into the cart);
 *   2. a live lookup by id, covering carts hydrated from storage or the server
 *      whose lines predate the per-line field;
 *   3. the positional placeholder, only when nothing can identify it.
 *
 * Blank and whitespace-only names count as absent, so an empty string on a line
 * cannot beat a real name the lookup could have supplied.
 */
export function resolveRestaurantName(
  lines: readonly CartLine[],
  rid: string,
  index: number,
  lookupName?: (id: string) => string | undefined,
): string {
  for (const l of lines) {
    const n = l.restaurantName?.trim();
    if (n) return n;
  }
  const looked = lookupName?.(rid)?.trim();
  if (looked) return looked;
  return `Restaurant ${index + 1}`;
}
