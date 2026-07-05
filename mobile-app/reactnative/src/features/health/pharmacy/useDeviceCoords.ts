// ── Raw device coordinates for pharmacy discovery ────────────────────────────
// Distance-ranked pharmacy discovery (GET /pharmacy/pharmacies?lat=&lng=) only
// needs the device's raw lat/lng — not a reverse-geocoded address, which is
// what `useCurrentLocation` (src/features/location) resolves for the address
// picker. This hook mirrors that hook's degrade-don't-die pattern (expo-location
// lazily required; `available: false` when it isn't linked, so the UI can hide
// distance sort instead of crashing) without the extra network round-trip.

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
  /** Ask for foreground permission and read the current position. */
  request: () => Promise<DeviceCoords | null>;
  requesting: boolean;
  /** Set when permission was denied or the position couldn't be read. */
  error: string | null;
  /** False when expo-location isn't installed/linked — hide distance sort. */
  available: boolean;
}

export function useDeviceCoords(): UseDeviceCoords {
  const [coords, setCoords] = useState<DeviceCoords | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<DeviceCoords | null> => {
    if (!LOCATION_AVAILABLE) {
      setError('Location is unavailable on this build.');
      return null;
    }
    setRequesting(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied — showing pharmacies by rating instead.');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 3,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      return next;
    } catch {
      setError('Could not get your location — showing pharmacies by rating instead.');
      return null;
    } finally {
      setRequesting(false);
    }
  }, []);

  return { coords, request, requesting, error, available: LOCATION_AVAILABLE };
}
