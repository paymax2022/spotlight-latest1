// ── Multi-outlet (multi-restaurant) selection ────────────────────────────────
//
// Spotlight is multi-restaurant on the server: `restaurants.owner_id` is 1:N, the
// owner queue joins on it (`ListOrders` role=restaurant spans every owned store),
// and 61 owners in the live data already run 2–3 outlets.
//
// The owner console was not. Manage Store read `stores.data?.[0]` — the FIRST
// store — so an owner with three outlets could see, price and edit the menu of
// exactly one of them, and had no way to reach the others. This module is the
// selection rule that fixes that, kept pure so it can be tested under
// `node --test`.
//
// The rule matters more than it looks: the console mutates real things (menu
// prices, packaging fee, open/closed). Picking the wrong outlet silently edits
// the wrong shop.

/** The minimum an outlet needs for selection; the full store type is a superset. */
export interface OutletLike {
  id: string;
  name: string;
  isOpen?: boolean;
}

export interface OutletSelection<T extends OutletLike> {
  /** The outlet the console should act on. Null only when the owner has none. */
  active: T | null;
  /** True when a switcher should be shown at all. */
  multi: boolean;
  /** Every outlet, in a stable display order. */
  outlets: T[];
}

/**
 * Decide which outlet the console acts on.
 *
 * Prefers the remembered choice, but only if the owner STILL owns it — an outlet
 * can be transferred, closed or removed between sessions, and a stale id must
 * never resolve to "no outlet" (a blank console) or, worse, silently fall through
 * to a different shop without the switcher reflecting it.
 *
 * Falls back to the first outlet in display order, so a fresh owner needs no
 * choice before working.
 */
export function resolveActiveOutlet<T extends OutletLike>(
  stores: readonly T[] | undefined,
  rememberedId?: string | null,
): OutletSelection<T> {
  const outlets = sortOutlets(stores ?? []);
  if (outlets.length === 0) return { active: null, multi: false, outlets };

  const remembered = rememberedId ? outlets.find((o) => o.id === rememberedId) : undefined;
  return {
    active: remembered ?? outlets[0],
    multi: outlets.length > 1,
    outlets,
  };
}

/**
 * Display order: open outlets first, then alphabetical.
 *
 * An owner working the console mid-service wants the trading shops at the top;
 * alphabetical alone buries a busy outlet behind a closed one.
 */
export function sortOutlets<T extends OutletLike>(stores: readonly T[]): T[] {
  return [...stores].sort((a, b) => {
    const openDiff = Number(b.isOpen ?? false) - Number(a.isOpen ?? false);
    if (openDiff !== 0) return openDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Whether an order belongs to a different outlet than the one on screen — used
 * to label rows in a queue that spans every outlet the owner runs.
 */
export function outletNameFor<T extends OutletLike>(
  outlets: readonly T[],
  restaurantId: string | undefined | null,
): string | null {
  if (!restaurantId) return null;
  return outlets.find((o) => o.id === restaurantId)?.name ?? null;
}
