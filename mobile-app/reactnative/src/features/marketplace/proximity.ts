// Proximity discovery for the marketplace: how far a buyer is willing to go, and
// how a measured distance is worded. Distances are measured on the server —
// PostGIS in the search fallback, an arcDistance script in Elasticsearch —
// against the seller's recorded position, which is never sent to the client.
// This file only formats them and fixes the radius choices.

/** The radius chips offered on Home and Results. 25 mirrors the ES geo decay
 *  scale, so the two search backends agree on what "near" defaults to. */
export const RADIUS_CHOICES_KM = [5, 10, 25, 50, 100];
export const DEFAULT_RADIUS_KM = 25;

/** `${x.toFixed(1)} km` — the house distance format (see MeetupSafeSpots) — with
 *  walking distances in metres instead of "0.4 km". Null when there is no
 *  distance to show, because "0.0 km" would claim the seller is next door. */
export function formatDistanceKm(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return `${Math.max(1, Math.round(km * 1000))} m`;
  return `${km.toFixed(1)} km`;
}
