// FOOD-UAT-C-006 / C-009 helpers (pure, no React Native imports so they can be
// unit-tested under node:test).
//
// A restored cart outlives the menu it was built from. On hydrate we compare each
// line against the restaurant's CURRENT menu: a changed base price is re-applied
// (the server still re-prices authoritatively at placement), and a line whose dish is
// gone or unavailable is flagged `stale` so checkout/the user can act on it.

import type { CartLine, CartPackage, MenuCategory } from './types';

export type StaleReason = 'price_changed' | 'unavailable' | 'removed';

export interface StaleLine {
  lineKey: string;
  itemId: string;
  name: string;
  reason: StaleReason;
  /** Previous / current per-unit price (kobo), for `price_changed`. */
  fromKobo?: number;
  toKobo?: number;
}

/** User-scoped storage key (C-009): one cart per signed-in account, never shared. */
export function cartStorageKey(userId: string | null | undefined): string {
  return `food-cart-storage::${userId && userId.length > 0 ? userId : 'anon'}`;
}

const lineKey = (l: Pick<CartLine, 'itemId' | 'modifierIds'>): string =>
  l.modifierIds && l.modifierIds.length > 0 ? `${l.itemId}#${[...l.modifierIds].sort().join(',')}` : l.itemId;

const modifiersDelta = (l: CartLine): number =>
  (l.modifiers ?? []).reduce((n, m) => n + Math.max(0, Math.trunc(m.priceDeltaKobo)), 0);

/**
 * Compare `packages` to the current menus (restaurantId -> categories). A restaurant
 * whose menu could not be fetched is simply absent from `menus` and its lines are left
 * untouched (never flag on a network failure).
 */
export function revalidateCartLines(
  packages: CartPackage[],
  menus: Record<string, MenuCategory[]>,
): { packages: CartPackage[]; stale: StaleLine[] } {
  const stale: StaleLine[] = [];
  const index: Record<string, Map<string, { priceKobo: number; available: boolean }>> = {};
  for (const [rid, cats] of Object.entries(menus)) {
    const m = new Map<string, { priceKobo: number; available: boolean }>();
    for (const c of cats) for (const it of c.items) m.set(it.id, { priceKobo: it.priceKobo, available: it.available !== false });
    index[rid] = m;
  }

  const next = packages.map((pkg) => ({
    ...pkg,
    lines: pkg.lines.map((l) => {
      const rid = l.restaurantId ?? pkg.restaurantId ?? '';
      const menu = index[rid];
      if (!menu) return l;
      const cur = menu.get(l.itemId);
      if (!cur) {
        stale.push({ lineKey: lineKey(l), itemId: l.itemId, name: l.name, reason: 'removed' });
        return l;
      }
      if (!cur.available) {
        stale.push({ lineKey: lineKey(l), itemId: l.itemId, name: l.name, reason: 'unavailable' });
        return l;
      }
      const expected = cur.priceKobo + modifiersDelta(l);
      if (expected !== l.priceKobo) {
        stale.push({ lineKey: lineKey(l), itemId: l.itemId, name: l.name, reason: 'price_changed', fromKobo: l.priceKobo, toKobo: expected });
        return { ...l, priceKobo: expected };
      }
      return l;
    }),
  }));
  return { packages: next, stale };
}

/** One-line toast copy for a stale set. */
export function staleToastMessage(stale: StaleLine[]): string {
  const priced = stale.filter((s) => s.reason === 'price_changed').length;
  const gone = stale.length - priced;
  const parts: string[] = [];
  if (priced) parts.push(`${priced} item${priced === 1 ? '' : 's'} changed price`);
  if (gone) parts.push(`${gone} item${gone === 1 ? ' is' : 's are'} no longer available`);
  return parts.join(' and ');
}
