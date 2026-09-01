// ── Device coordinates for "near me" restaurant sorting ──────────────────────
// Raw {lat, lng} only — no reverse-geocode, unlike useCurrentLocation (the
// address-picker's "use my location" button), which resolves a full address
// and is heavier than a discovery screen sort needs.
//
// expo-location is loaded lazily and defensively, same reason as
// useCurrentLocation: it may be absent in Expo Go or a JS-only build that
// hasn't been rebuilt yet. `available: false` lets the UI just skip distance
// sort instead of crashing.

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

export interface Coords {
  lat: number;
  lng: number;
}

export interface UseDeviceCoords {
  coords: Coords | null;
  /** Request permission (if needed) and read the device's current position. */
  request: () => Promise<Coords | null>;
  loading: boolean;
  /** User-facing reason `coords` is null after a request — permission denied,
   *  no hardware, etc. Not set just because request() hasn't run yet. */
  error: string | null;
  /** False when expo-location isn't installed/linked — hide the "Nearby" affordance. */
  available: boolean;
}

export function useDeviceCoords(): UseDeviceCoords {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<Coords | null> => {
    if (!LOCATION_AVAILABLE) {
      setError('Location is unavailable on this build.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Enable it in Settings to sort by distance.');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 3,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      return next;
    } catch {
      setError('Could not get your location. Showing restaurants by kitchen speed instead.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { coords, request, loading, error, available: LOCATION_AVAILABLE };
}
