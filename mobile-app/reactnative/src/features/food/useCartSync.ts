// Cart sync hook — persists cart to localStorage/AsyncStorage + syncs with server
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useCartStore } from './cartStore';
import { saveCartToServer, loadCartFromServer, getRestaurant } from './api';
import { cartStorageKey, revalidateCartLines, staleToastMessage, type StaleLine } from './cartRevalidate';
import { useAuthStore } from '@/store/authStore';
import { useToastStore } from '@/store/toastStore';

// FOOD-UAT-C-009: the persisted cart is scoped to the signed-in user so a shared
// device never shows (or submits) a previous account's cart. The pre-fix key was
// global and is purged on first load rather than migrated — attributing it to
// whoever signs in next is exactly the leak.
const LEGACY_STORAGE_KEY = 'food-cart-storage';
const currentKey = () => cartStorageKey(useAuthStore.getState().user?.id);

/** FOOD-UAT-C-006: lines flagged stale by the last hydrate revalidation, by line key. */
export const useStaleCartLines = create<{ stale: Record<string, StaleLine>; set: (s: StaleLine[]) => void }>((set) => ({
  stale: {},
  set: (lines) => set({ stale: Object.fromEntries(lines.map((l) => [l.lineKey, l])) }),
}));

/** Re-fetch each restaurant's current menu and re-price / flag the restored lines. */
async function revalidateRestoredCart() {
  const { packages } = useCartStore.getState();
  const ids = Array.from(new Set(packages.flatMap((p) => p.lines.map((l) => l.restaurantId ?? p.restaurantId ?? '')).filter(Boolean)));
  if (ids.length === 0) return;
  const menus: Record<string, Awaited<ReturnType<typeof getRestaurant>>['menu']> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        menus[id] = (await getRestaurant(id)).menu;
      } catch {
        /* unreachable / deleted restaurant: leave its lines alone (cartPrune owns deletions) */
      }
    }),
  );
  const result = revalidateCartLines(useCartStore.getState().packages, menus);
  useStaleCartLines.getState().set(result.stale);
  if (result.stale.length === 0) return;
  useCartStore.setState({ packages: result.packages });
  useToastStore.getState().show({ variant: 'info', title: 'Your cart was updated', message: staleToastMessage(result.stale) });
}

// Platform-specific storage helpers
const storage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
    } else {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
  },
};

/**
 * Clear cart from all storage (local + server). Call after order is placed.
 */
export async function clearPersistedCart() {
  await storage.removeItem(currentKey());
  // Clear from server too (API endpoint will be called when implemented)
  useCartStore.setState({ restaurantId: null, restaurantName: null, packages: [], activePackageId: null });
}

/**
 * Persist cart to localStorage/AsyncStorage + sync with server.
 * - On mount: load from localStorage/AsyncStorage, then try server
 * - On cart change: debounce and save both locally and to server
 */
export function useCartSync() {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialLoadDoneRef = useRef(false);
  const lastSavedRef = useRef<string>('');
  // Re-hydrate whenever the signed-in account changes (login / logout / switch).
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const loadedForRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (loadedForRef.current === userId) return;
    const switchedAccount = loadedForRef.current !== undefined;
    loadedForRef.current = userId;
    initialLoadDoneRef.current = true;
    lastSavedRef.current = '';
    if (switchedAccount) {
      // Never carry the previous account's in-memory cart across a sign-in.
      useCartStore.setState({ restaurantId: null, restaurantName: null, packages: [], activePackageId: null });
      useStaleCartLines.getState().set([]);
    }

    (async () => {
      try {
        void storage.removeItem(LEGACY_STORAGE_KEY).catch(() => undefined);
        const key = cartStorageKey(userId);
        // Try local storage first
        const localCart = await storage.getItem(key);
        if (loadedForRef.current !== userId) return; // account changed mid-load
        if (localCart) {
          const parsed = JSON.parse(localCart);
          lastSavedRef.current = localCart;
          useCartStore.setState(parsed);
          await revalidateRestoredCart(); // C-006
          return; // Use local cart if available
        }

        // Try server if no local cart (only meaningful for a signed-in user)
        if (!userId) return;
        const serverCart = await loadCartFromServer();
        if (loadedForRef.current !== userId) return;
        if (serverCart) {
          lastSavedRef.current = JSON.stringify(serverCart);
          useCartStore.setState(serverCart);
          await revalidateRestoredCart(); // C-006
        }
      } catch (err) {
        console.warn('Cart sync load failed:', err);
      }
    })();
  }, [userId]);

  // Watch store directly and debounce saves (avoid selector reference issues)
  useEffect(() => {
    if (!initialLoadDoneRef.current) return;

    const unsubscribe = useCartStore.subscribe((state) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      saveTimeoutRef.current = setTimeout(() => {
        const cartSnapshot = {
          restaurantId: state.restaurantId,
          restaurantName: state.restaurantName,
          packages: state.packages,
          activePackageId: state.activePackageId,
        };
        const cartJson = JSON.stringify(cartSnapshot);

        // Skip if nothing changed
        if (cartJson === lastSavedRef.current) return;
        lastSavedRef.current = cartJson;

        // Save to local storage
        storage.setItem(currentKey(), cartJson).catch((err) => {
          console.warn('Local cart save failed:', err);
        });

        saveCartToServer(cartSnapshot).catch((err) => {
          console.warn('Server cart save failed:', err);
        });
      }, 1000);
    });

    return () => {
      unsubscribe();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);
}
