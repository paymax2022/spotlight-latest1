// Canonical raw {lat, lng} device capture — no reverse geocode, no address, just
// the numbers a distance query needs. `useCurrentLocation` in this folder does
// the heavier address resolution for the address picker; food and pharmacy each
// still carry a local copy of this hook with domain-specific error copy.
//
// expo-location is loaded lazily and defensively: it may be absent in Expo Go or
// a JS-only build that has not been rebuilt yet. `available: false` lets a screen
// hide its distance affordance instead of crashing.

import { useCallback, useState } from 'react';

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

export interface DeviceCoords {
  lat: number;
  lng: number;
}

export interface UseDeviceCoords {
  coords: DeviceCoords | null;
  /** Ask for foreground permission (if needed) and read the current position.
   *  Resolves to the coords, or null when permission was denied or the fix failed. */
  request: () => Promise<DeviceCoords | null>;
  /** Forget the position — a seller who shared it by mistake can unshare it. */
  clear: () => void;
  loading: boolean;
  /** User-facing reason `coords` is null AFTER a request. Not set merely because
   *  request() has not run yet, so a screen never shows an error before asking. */
  error: string | null;
  /** False when expo-location isn't installed/linked — hide distance UI entirely. */
  available: boolean;
}

export function useDeviceCoords(): UseDeviceCoords {
  const [coords, setCoords] = useState<DeviceCoords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<DeviceCoords | null> => {
    if (!LOCATION_AVAILABLE) {
      setError('Location is unavailable on this build.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Enable it in Settings to see distances.');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 3,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      return next;
    } catch {
      setError("Couldn't get your location. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setError(null);
  }, []);

  return { coords, request, clear, loading, error, available: LOCATION_AVAILABLE };
}
