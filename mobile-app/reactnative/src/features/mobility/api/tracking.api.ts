// Real-time trip tracking client. The driver app POSTs GPS samples; riders
// receive snapped positions over a WebSocket on their authenticated user channel.
import { api } from '@/api/client';
import { MAPS_BASE } from './maps.api';

// Mobility base is a sibling of the maps base on the same Go backend.
export const MOBILITY_BASE = MAPS_BASE.replace(/\/maps$/, '/mobility');

// ws(s):// URL for the trip WebSocket (auth via Authorization header on handshake).
export function tripWsUrl(): string {
  return MOBILITY_BASE.replace(/^http/, 'ws') + '/ws';
}

// Driver-only: stream one GPS sample for a trip.
export async function postDriverPosition(
  tripId: string,
  lat: number,
  lng: number,
  heading?: number,
  speedMps?: number,
): Promise<void> {
  await api.post(`${MOBILITY_BASE}/trips/${encodeURIComponent(tripId)}/track`, {
    lat,
    lng,
    heading,
    speed_mps: speedMps,
  });
}
