// Cart sync hook — persists cart to localStorage/AsyncStorage + syncs with server
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCartStore } from './cartStore';
import { saveCartToServer, loadCartFromServer } from './api';

const STORAGE_KEY = 'food-cart-storage';

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
  await storage.removeItem(STORAGE_KEY);
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

  // Load cart on mount (once)
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    (async () => {
      try {
        // Try local storage first
        const localCart = await storage.getItem(STORAGE_KEY);
        if (localCart) {
          const parsed = JSON.parse(localCart);
          lastSavedRef.current = localCart;
          useCartStore.setState(parsed);
          return; // Use local cart if available
        }

        // Try server if no local cart
        const serverCart = await loadCartFromServer();
        if (serverCart) {
          lastSavedRef.current = JSON.stringify(serverCart);
          useCartStore.setState(serverCart);
        }
      } catch (err) {
        console.warn('Cart sync load failed:', err);
      }
    })();
  }, []);

  // Watch store directly and debounce saves (avoid selector reference issues)
  useEffect(() => {
    if (!initialLoadDoneRef.current) return;

    const unsubscribe = useCartStore.subscribe((state) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      // Debounce: save after 1 second of no changes
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
        storage.setItem(STORAGE_KEY, cartJson).catch((err) => {
          console.warn('Local cart save failed:', err);
        });

        // Save to server (async, don't await)
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
