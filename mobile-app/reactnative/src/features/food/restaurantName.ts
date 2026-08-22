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

import type { CartLine, CartPackage } from './types';

/** Group id used when a package's lines carry no restaurant at all. */
export const UNKNOWN_RESTAURANT_ID = 'unknown';

/**
 * The cart's packages grouped by restaurant, in insertion order.
 *
 * Lifted out of checkout's JSX so the screen can work out which ids still need
 * a name lookup BEFORE rendering. Empty packages are skipped: they are a
 * user-visible container the cart lets you create ahead of filling it, and an
 * empty one must not open a restaurant section of its own.
 */
export function groupPackagesByRestaurant(
  packages: readonly CartPackage[],
  fallbackRestaurantId?: string | null,
): { rid: string; packages: CartPackage[] }[] {
  const byRestaurant = new Map<string, CartPackage[]>();
  for (const pkg of packages) {
    if (pkg.lines.length === 0) continue;
    const rid = pkg.lines[0]?.restaurantId || fallbackRestaurantId || UNKNOWN_RESTAURANT_ID;
    const group = byRestaurant.get(rid);
    if (group) group.push(pkg);
    else byRestaurant.set(rid, [pkg]);
  }
  return Array.from(byRestaurant.entries()).map(([rid, ps]) => ({ rid, packages: ps }));
}

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
