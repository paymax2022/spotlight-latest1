// ── Restaurant & Delivery — dropping kitchens the cart can no longer order from ─
//
// A cart persists locally AND on the server, so it long outlives the menu it was
// built from. When a restaurant is deleted, its lines sit in checkout looking
// ordinary: they have a name, a price, and they add to the total — but PlaceOrder
// reads the restaurant row for pricing and open-hours, so the order can never be
// placed, and the delivery fee for that kitchen can never be quoted.
//
// This removes them. Kept pure and separate from the store so the decision can be
// tested without React Native, and so the store action stays a one-liner.

import type { CartLine, CartPackage } from './types';

/** The cart fields this touches — a subset of the store's state. */
export interface PrunableCart {
  restaurantId: string | null;
  restaurantName: string | null;
  packages: CartPackage[];
  activePackageId: string | null;
}

/** What was dropped, so the screen can say so instead of silently shrinking. */
export interface PruneResult extends PrunableCart {
  /** Ids actually removed (only those that had something in the cart). */
  removedIds: string[];
  /** Their display names where the cart captured one, for the notice. */
  removedNames: string[];
  /**
   * PORTIONS removed, across all packs — the sum of qty, not a count of lines.
   * "items" means summed quantity everywhere else in this cart (cartItemCount),
   * so a line holding 2 portions must not be reported as "1 item".
   */
  removedItemCount: number;
  /** True when the cart-level restaurant pointer had to be re-derived. */
  repointed: boolean;
}

const lineRestaurant = (l: CartLine): string => l.restaurantId ?? '';

/**
 * Remove every trace of `goneIds` from the cart.
 *
 * Removes: their lines; any pack emptied as a result; and any empty pack that
 * belongs to them (`pack.restaurantId`). Leaves untouched: packs belonging to a
 * surviving kitchen, and legacy packs with no restaurant of their own — those
 * predate packs carrying one and cannot be attributed, so they are not evidence
 * of anything and must not be swept up.
 *
 * Re-derives the cart-level restaurant when the removed kitchen WAS it. That
 * field is "first restaurant added, never updated", so leaving it pointing at a
 * deleted kitchen would keep the delivery quote and PlaceOrder aimed at a row
 * that no longer exists — the whole failure this is meant to end.
 */
export function pruneCart(cart: PrunableCart, goneIds: Iterable<string>): PruneResult {
  const gone = new Set([...goneIds].filter(Boolean));
  if (gone.size === 0) return { ...cart, removedIds: [], removedNames: [], removedItemCount: 0, repointed: false };

  const removedIds = new Set<string>();
  const removedNames = new Map<string, string>();
  let removedItemCount = 0;

  const packages: CartPackage[] = [];
  for (const pack of cart.packages) {
    const keptLines = pack.lines.filter((l) => {
      if (!gone.has(lineRestaurant(l))) return true;
      removedIds.add(lineRestaurant(l));
      const nm = l.restaurantName?.trim();
      if (nm) removedNames.set(lineRestaurant(l), nm);
      removedItemCount += l.qty;
      return false;
    });

    const packBelongsToGone = !!pack.restaurantId && gone.has(pack.restaurantId);
    if (packBelongsToGone) removedIds.add(pack.restaurantId as string);

    // An emptied pack is a pack that existed only to hold the removed food.
    const emptiedByThis = pack.lines.length > 0 && keptLines.length === 0;
    if (emptiedByThis || (packBelongsToGone && keptLines.length === 0)) continue;

    packages.push(keptLines.length === pack.lines.length ? pack : { ...pack, lines: keptLines });
  }

  // The cart-level pointer, re-derived only when the kitchen it named is gone.
  //
  // Re-pointing is SILENT HOUSEKEEPING and deliberately does not add to
  // removedIds. This pointer is "first restaurant added, never updated", so it
  // routinely names a kitchen whose food left the cart long ago — announcing
  // "X is no longer available, so 0 items were removed" for one of those tells
  // the customer something was taken out of a cart that never contained it.
  // Only lines and packs actually removed above count as a removal.
  let restaurantId = cart.restaurantId;
  let restaurantName = cart.restaurantName;
  if (restaurantId && gone.has(restaurantId)) {
    // Only if no line already named it: the line's captured name is the one
    // rendered in the cart's section header, so it is the name the customer will
    // recognise in the notice.
    if (restaurantName?.trim() && !removedNames.has(restaurantId)) {
      removedNames.set(restaurantId, restaurantName.trim());
    }
    const survivor = packages.flatMap((p) => p.lines).find((l) => l.restaurantId);
    restaurantId = survivor?.restaurantId ?? null;
    restaurantName = survivor?.restaurantName ?? null;
  }

  const activePackageId = packages.some((p) => p.id === cart.activePackageId) ? cart.activePackageId : null;

  return {
    restaurantId,
    restaurantName,
    packages,
    activePackageId,
    removedIds: [...removedIds],
    removedNames: [...removedIds].map((id) => removedNames.get(id) ?? 'A restaurant'),
    repointed: cart.restaurantId !== restaurantId,
    removedItemCount,
  };
}
