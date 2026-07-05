// ── "Use my current location" ────────────────────────────────────────────────
// One-tap GPS capture for the address picker: ask permission, read the device
// position, then reverse-geocode it (via the hybrid resolver) into a real
// address + Plus Code.
//
// expo-location is loaded lazily and defensively: it may be absent in Expo Go or
// a JS-only build that hasn't been rebuilt yet. When it's unavailable the hook
// reports `available: false` so the UI can simply hide the button instead of
// crashing — exactly the same degrade-don't-die pattern MapView uses for the
// native MapLibre module.

import { useCallback, useState } from 'react';
import { reverseLookup, type ResolvedAddress } from '@/lib/addressLookup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Location: any = null;
let LOCATION_AVAILABLE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Location = require('expo-location');
  LOCATION_AVAILABLE = !!Location?.requestForegroundPermissionsAsync;
} catch {
  LOCATION_AVAILABLE = false;
}

export interface UseCurrentLocation {
  /** Resolve the device's current location to an address, or null on failure. */
  getCurrent: () => Promise<ResolvedAddress | null>;
  loading: boolean;
  error: string | null;
  /** False when expo-location isn't installed/linked — hide the button. */
  available: boolean;
}

export function useCurrentLocation(): UseCurrentLocation {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCurrent = useCallback(async (): Promise<ResolvedAddress | null> => {
    if (!LOCATION_AVAILABLE) {
      setError('Location is unavailable on this build.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Enable it in Settings to use this.');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 3,
      });
      const { latitude, longitude } = pos.coords;
      const resolved = await reverseLookup(latitude, longitude);
      if (!resolved) {
        setError('Could not resolve your location. Try searching instead.');
        return null;
      }
      return resolved;
    } catch {
      setError('Could not get your location. Try searching instead.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { getCurrent, loading, error, available: LOCATION_AVAILABLE };
}
