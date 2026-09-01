// ── Restaurant & Delivery — Cart store (takeaway-package model) ───────────────
// The TAKEAWAY PACKAGE is the "mother" container. The user adds a package, then
// puts food into it; an order is the set of packages and the food in each. Rules:
//   • At most MAX_SAME_FOOD_PER_PACKAGE (2) portions of the SAME food per package
//     — a 3rd portion needs another package.
//   • The user can add extra packages; packaging fee is charged per package.
// Multi-restaurant: each item includes its restaurantId; no reset on restaurant switch.
// Money stays integer kobo; the SERVER computes the authoritative total.

import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartLine, CartPackage, MenuItem } from './types';
import { pruneCart, type PruneResult } from './cartPrune';

export const MAX_SAME_FOOD_PER_PACKAGE = 2;

let pkgSeq = 0;
const newPkgId = () => `pkg_${Date.now().toString(36)}_${(pkgSeq++).toString(36)}`;

/** Result of an add attempt so the UI can react/explain. */
export interface AddItemResult {
  ok: boolean;
  // Only returned when autoOverflow is OFF (e.g. editing a specific pack at checkout):
  // 'max_per_pack'   — a 3rd portion of the same non-protein main was attempted.
  // 'different_menu' — a 2nd distinct non-protein main was attempted in one pack.
  reason?: 'max_per_pack' | 'different_menu';
  /** The conflicting main already in the pack (for 'different_menu' messaging). */
  conflictName?: string;
  /** The package the item ended up in. */
  packageId?: string;
  /** True when a regular item overflowed into a brand-new pack (autoOverflow). */
  overflowed?: boolean;
  /** 1-based index of packageId among non-empty packs (for an "added to Pack N" hint). */
  packageIndex?: number;
}

/** Can this pack accept one more of a REGULAR item X? (proteins always can.) */
function packAcceptsRegular(pkg: CartPackage, itemId: string): boolean {
  const x = pkg.lines.find((l) => l.itemId === itemId);
  if (x) return x.qty < MAX_SAME_FOOD_PER_PACKAGE; // room for the same main
  return !pkg.lines.some((l) => !l.isProtein); // no other main present → can be this pack's main
}

interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  packages: CartPackage[];
  activePackageId: string | null;

  /**
   * Add an empty takeaway package and make it active. Returns its id.
   *
   * Takes the restaurant it is being added FOR. Without it an empty pack could
   * not be attributed to anything, so a screen showing "this restaurant's packs"
   * had to fall back to the cart-level restaurantId — which holds whichever
   * restaurant was added FIRST. Adding a pack from any other restaurant's page
   * then created it and immediately filtered it out of view, so the button
   * looked dead while quietly growing the cart.
   */
  addPackage: (restaurantId?: string, restaurantName?: string) => string;
  removePackage: (packageId: string) => void;
  setActivePackage: (packageId: string) => void;

  /**
   * Add one portion of `item` into a package (the given one, else the active one,
   * else a freshly created package). Enforces the packing rules. When
   * `opts.autoOverflow` is set (menu adds), a regular item that doesn't fit the
   * target pack automatically opens a NEW pack and lands there (shopping
   * continues); without it (explicit per-pack edits), a non-fit is rejected.
   */
  addItem: (
    restaurantId: string,
    restaurantName: string,
    item: MenuItem,
    packageId?: string,
    opts?: { autoOverflow?: boolean },
  ) => AddItemResult;
  decrementItem: (packageId: string, itemId: string) => void;
  removeItem: (packageId: string, itemId: string) => void;
  /**
   * Drop every trace of restaurants that no longer exist, returning what went.
   * The decision of WHICH ids are gone belongs to the caller (only a 404 counts
   * — see availability.ts); this just applies it. Reducer lives in cartPrune.ts
   * so it can be tested without React Native.
   */
  removeRestaurants: (goneIds: string[]) => PruneResult;
  clear: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  restaurantId: null,
  restaurantName: null,
  packages: [],
  activePackageId: null,

  addPackage: (restaurantId, restaurantName) => {
    const id = newPkgId();
    set((st) => ({
      packages: [...st.packages, { id, lines: [], restaurantId: restaurantId ?? null }],
      activePackageId: id,
      // Keep the legacy first-wins cart fields in step for callers that still
      // read them; they are only filled when empty, exactly as addItem does.
      restaurantId: st.restaurantId || restaurantId || null,
      restaurantName: st.restaurantName || restaurantName || null,
    }));
    return id;
  },

  removePackage: (packageId) =>
    set((st) => {
      const packages = st.packages.filter((p) => p.id !== packageId);
      if (packages.length === 0) {
        return { restaurantId: null, restaurantName: null, packages: [], activePackageId: null };
      }
      const activePackageId =
        st.activePackageId === packageId ? packages[packages.length - 1].id : st.activePackageId;
      return { ...st, packages, activePackageId };
    }),

  setActivePackage: (packageId) => set({ activePackageId: packageId }),

  addItem: (restaurantId, restaurantName, item, packageId, opts) => {
    const autoOverflow = opts?.autoOverflow === true;
    const isProtein = item.foodType === 'protein';
    // restaurantName is recorded per line, not just once on the store: the
    // top-level field keeps the FIRST restaurant only, so a multi-restaurant
    // cart could not name its other sections.
    const newLine = (): CartLine => ({ itemId: item.id, name: item.name, priceKobo: item.priceKobo, qty: 1, isProtein, restaurantId, restaurantName });
    let result: AddItemResult = { ok: true };

    set((st) => {
      // Multi-restaurant: no reset on restaurant switch; each line tracks its own restaurantId.
      let packages = st.packages.slice();
      const active = st.activePackageId;

      // Resolve the target package: explicit → active → last → create one.
      let targetId = packageId ?? active ?? packages[packages.length - 1]?.id ?? null;
      if (!targetId || !packages.some((p) => p.id === targetId)) {
        targetId = newPkgId();
        packages = [...packages, { id: targetId, lines: [], restaurantId }];
      }

      const target = packages.find((p) => p.id === targetId)!;
      const accepts = isProtein || packAcceptsRegular(target, item.id);

      const idxOf = (id: string) => {
        const i = packages.filter((p) => p.lines.length > 0).findIndex((p) => p.id === id);
        return i >= 0 ? i + 1 : undefined;
      };

      if (!accepts) {
        if (!autoOverflow) {
          // Explicit per-pack edit (e.g. checkout +): reject so the caller can explain/disable.
          const x = target.lines.find((l) => l.itemId === item.id);
          result = x
            ? { ok: false, reason: 'max_per_pack', packageId: targetId! }
            : { ok: false, reason: 'different_menu', conflictName: target.lines.find((l) => !l.isProtein)?.name, packageId: targetId! };
          return st; // unchanged
        }
        // Auto-overflow: the active pack is full for this regular item → open a NEW
        // pack with the selected item and make it active; shopping continues there.
        const overflowId = newPkgId();
        packages = [...packages, { id: overflowId, lines: [newLine()], restaurantId }];
        result = { ok: true, overflowed: true, packageId: overflowId, packageIndex: idxOf(overflowId) };
        return {
          restaurantId: st.restaurantId || restaurantId,
          restaurantName: st.restaurantName || restaurantName,
          packages,
          activePackageId: overflowId,
        };
      }

      // Target accepts: add or increment in place.
      packages = packages.map((p) => {
        if (p.id !== targetId) return p;
        const existing = p.lines.find((l) => l.itemId === item.id);
        return existing
          ? { ...p, lines: p.lines.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l)) }
          : { ...p, lines: [...p.lines, newLine()] };
      });
      result = { ok: true, packageId: targetId!, packageIndex: idxOf(targetId!) };
      // Multi-restaurant: keep the previous restaurantId/restaurantName if already set, or update if empty.
      return {
        restaurantId: st.restaurantId || restaurantId,
        restaurantName: st.restaurantName || restaurantName,
        packages,
        activePackageId: targetId,
      };
    });
    return result;
  },

  decrementItem: (packageId, itemId) =>
    set((st) => {
      const packages = st.packages.map((p) =>
        p.id === packageId
          ? {
              ...p,
              lines: p.lines.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0),
            }
          : p,
      );
      if (packages.every((p) => p.lines.length === 0)) {
        return { restaurantId: null, restaurantName: null, packages: [], activePackageId: null };
      }
      return { ...st, packages };
    }),

  removeItem: (packageId, itemId) =>
    set((st) => {
      const packages = st.packages.map((p) =>
        p.id === packageId ? { ...p, lines: p.lines.filter((l) => l.itemId !== itemId) } : p,
      );
      if (packages.every((p) => p.lines.length === 0)) {
        return { restaurantId: null, restaurantName: null, packages: [], activePackageId: null };
      }
      return { ...st, packages };
    }),

  removeRestaurants: (goneIds) => {
    const st = useCartStore.getState();
    const out = pruneCart(st, goneIds);
    // `repointed` matters as much as `removedIds` here. A dead cart-level
    // pointer with no food behind it removes NOTHING, so gating on removedIds
    // alone computed the re-derivation and then threw it away — leaving the
    // pointer aimed at a deleted kitchen, which is what kept the delivery fee
    // and packaging price from ever resolving.
    if (out.removedIds.length > 0 || out.repointed) {
      set({
        restaurantId: out.restaurantId,
        restaurantName: out.restaurantName,
        packages: out.packages,
        activePackageId: out.activePackageId,
      });
    }
    return out;
  },

  clear: () => set({ restaurantId: null, restaurantName: null, packages: [], activePackageId: null }),
}));

// ─── Derived selectors (operate on the package list) ──────────────────────────

/** Subtotal across every package (kobo). */
export function cartSubtotalKobo(packages: CartPackage[]): number {
  return packages.reduce((sum, p) => sum + p.lines.reduce((s, l) => s + l.priceKobo * l.qty, 0), 0);
}

/** Total food portions across all packages. */
export function cartItemCount(packages: CartPackage[]): number {
  return packages.reduce((n, p) => n + p.lines.reduce((s, l) => s + l.qty, 0), 0);
}

/** Number of NON-EMPTY takeaway packages — what packaging is billed on. */
export function cartPackageCount(packages: CartPackage[]): number {
  return packages.reduce((n, p) => n + (p.lines.length > 0 ? 1 : 0), 0);
}

/** Total mandatory packaging fee in kobo (one pack fee per non-empty package). */
export function cartPackagingKobo(packages: CartPackage[], packFeeKobo: number): number {
  return cartPackageCount(packages) * packFeeKobo;
}

/** Aggregate every package's lines by itemId (pricing/charge payload + nutrition). */
export function aggregateCartLines(packages: CartPackage[]): CartLine[] {
  const byId = new Map<string, CartLine>();
  for (const p of packages) {
    for (const l of p.lines) {
      const cur = byId.get(l.itemId);
      if (cur) cur.qty += l.qty;
      else byId.set(l.itemId, { ...l, restaurantId: l.restaurantId, restaurantName: l.restaurantName });
    }
  }
  return Array.from(byId.values());
}


/** Per-package payload (non-empty packages only) for the order request. */
export function cartPackagesPayload(packages: CartPackage[]): { items: { itemId: string; qty: number }[] }[] {
  return packages
    .filter((p) => p.lines.length > 0)
    .map((p) => ({ items: p.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) }));
}
