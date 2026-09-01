// ── Restaurant & Delivery — which packs belong to the restaurant on screen ────
//
// The cart is multi-restaurant. A restaurant page shows "Takeaway packs", and it
// has to decide which of the cart's packs are ITS packs.
//
// This used to be decided on the CART-level restaurantId — a single field that
// holds whichever restaurant was added FIRST and never changes. On every other
// restaurant's page it was false, so no pack was ever shown there, including one
// the user had just created. "Add pack" looked dead while the cart quietly grew
// an empty pack per click.
//
// The pack now carries its own restaurant, the same way a CartLine always has.
// Kept here rather than inline in the screen so the rule is testable on its own.

import type { CartPackage } from './types';

/**
 * The packs belonging to `restaurantId`.
 *
 * `cartRestaurantId` is the legacy cart-level field, used only for packs that
 * predate packs carrying a restaurant: those have no restaurant of their own, so
 * the original first-restaurant-wins rule is what decides them. For such a cart
 * this returns exactly what the old rule returned.
 */
export function packsForRestaurant(
  packages: CartPackage[],
  restaurantId: string | null | undefined,
  cartRestaurantId: string | null | undefined,
): CartPackage[] {
  const legacyMine = !!restaurantId && cartRestaurantId === restaurantId;
  return packages.filter((p) => (p.restaurantId ? p.restaurantId === restaurantId : legacyMine));
}
