import { useEffect, useRef, useState } from 'react';
import { useTripTracking, type TripPosition } from './useTripTracking';
import type { LatLng, TripPhase } from '../types/mobility.types';

// Live tracking is disabled in mock mode (no real backend WebSocket); screens
// fall back to polling. Mirrors the USE_MOCK gate used across the mobility APIs.
const USE_MOCK =
  (process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

export interface TripRealtimeState {
  /** Latest live driver position, or null until the first frame arrives. */
  driver: LatLng | null;
  /** Raw position frame (heading, speed, snapped polyline, ts). */
  position: TripPosition | null;
  /** [lng,lat] route decoded from the latest snapped polyline, if any. */
  route: [number, number][] | null;
  /** True while the live WebSocket is connected. */
  live: boolean;
  /** True when realtime is active (not mock, has a trip) — screens may relax polling. */
  realtimeEnabled: boolean;
}

/** Decode an OSRM/Google encoded polyline (precision 5) into [lng,lat] pairs. */
function decodePolyline(str: string, precision = 5): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out: [number, number][] = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 1;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

// Trip phases where a driver/courier is actively moving and we want live tracking.
const TRACKABLE_PHASES: TripPhase[] = ['driver_assigned', 'driver_arriving', 'pin_verified', 'in_progress'];

export interface UseTripRealtimeOptions {
  /** Current trip phase — realtime only subscribes while the driver is en route. */
  phase?: TripPhase;
}

/**
 * useTripRealtime layers live driver-position + status updates on top of the
 * polled trip. It subscribes to the backend trip-tracking WebSocket (via
 * useTripTracking, which the driver app feeds by POSTing GPS) so the map marker
 * and status move live instead of only on the 4s poll. Polling stays in place as
 * the fallback whenever the socket is unavailable (cold start, reconnect, or the
 * EXPO_PUBLIC_MOBILITY_USE_MOCK flag, under which no live socket is opened).
 */
export function useTripRealtime(tripId?: string, options?: UseTripRealtimeOptions): TripRealtimeState {
  const phase = options?.phase;
  const trackable = !phase || TRACKABLE_PHASES.includes(phase);
  const realtimeEnabled = !USE_MOCK && Boolean(tripId) && trackable;

  // Only open the socket when realtime is enabled; otherwise pass undefined so the
  // underlying hook stays idle and the screen relies on polling.
  const { position, connected } = useTripTracking(realtimeEnabled ? tripId : undefined);

  // Cache the last route so a position frame without a fresh snapped polyline
  // keeps the previously drawn path instead of flickering empty.
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const lastPolyline = useRef<string | undefined>(undefined);

  useEffect(() => {
    const poly = position?.snappedPolyline;
    if (poly && poly !== lastPolyline.current) {
      lastPolyline.current = poly;
      setRoute(decodePolyline(poly));
    }
  }, [position?.snappedPolyline]);

  const driver: LatLng | null = position ? { lat: position.lat, lng: position.lng } : null;

  return {
    driver,
    position,
    route,
    live: realtimeEnabled && connected,
    realtimeEnabled,
  };
}
