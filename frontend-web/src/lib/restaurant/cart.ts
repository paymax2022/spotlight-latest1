'use client';

import { authFetch } from '@/src/lib/auth/flow';
import type { Cart } from '@/src/types/restaurant';

const STORAGE_KEY = 'spotlight.food.cart.v1';

export function loadLocalCart(): Cart | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.lines)) return null;
    return parsed as Cart;
  } catch {
    return null;
  }
}

export function saveLocalCart(cart: Cart | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!cart || cart.lines.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    }
  } catch {
    // Storage can throw in private-browsing/quota-exceeded cases — the cart
    // still works for this page load via in-memory state, it just won't
    // persist across a reload. Not worth surfacing to the user.
  }
}

export function cartTotalKobo(cart: Cart | null): number {
  if (!cart) return 0;
  return cart.lines.reduce((sum, line) => sum + line.price_kobo * line.quantity, 0);
}

export function cartItemCount(cart: Cart | null): number {
  if (!cart) return 0;
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}

// Best-effort cross-device sync via /api/v1/food/cart. Never throws — cart
// mutations must keep working locally even if this call fails (e.g. the
// restaurant feature flag is off, or the request drops).
export async function syncCartToServer(cart: Cart | null): Promise<void> {
  try {
    if (!cart || cart.lines.length === 0) {
      await authFetch('/api/v1/food/cart', { method: 'DELETE' });
      return;
    }
    await authFetch('/api/v1/food/cart', {
      method: 'POST',
      body: JSON.stringify({
        restaurantId: cart.restaurant_id,
        restaurantName: cart.restaurant_name,
        packages: [{ items: cart.lines }],
        activePackageId: null,
      }),
    }, { json: true });
  } catch {
    // Best-effort — see comment above.
  }
}

type ServerCartPackage = { items?: Array<{ menu_item_id?: string; item_id?: string; name?: string; price_kobo?: number; quantity?: number; qty?: number }> };
type ServerCartResponse = {
  data: null | {
    restaurantId?: string | null;
    restaurantName?: string | null;
    packages?: ServerCartPackage[];
  };
};

export async function fetchServerCart(): Promise<Cart | null> {
  try {
    const response = await authFetch('/api/v1/food/cart', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json()) as ServerCartResponse;
    const data = payload?.data;
    if (!data || !data.restaurantId) return null;
    const lines = (data.packages ?? []).flatMap((pkg) => pkg.items ?? []).map((item) => ({
      menu_item_id: String(item.menu_item_id ?? item.item_id ?? ''),
      name: String(item.name ?? ''),
      price_kobo: Number(item.price_kobo ?? 0),
      quantity: Number(item.quantity ?? item.qty ?? 0),
    })).filter((line) => line.menu_item_id && line.quantity > 0);
    if (!lines.length) return null;
    return {
      restaurant_id: data.restaurantId,
      restaurant_name: data.restaurantName ?? '',
      lines,
    };
  } catch {
    return null;
  }
}
