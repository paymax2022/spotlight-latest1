// Pure venue helper (events-social). No imports: the event detail screen asks
// this whether the venue can be drawn on a map. A pin needs two real numbers;
// null, undefined, NaN and +/-Infinity in either field mean no map.

export type VenueMapState = 'pin' | 'none';

export function venueMapState(e: { venue_lat?: number | null; venue_lng?: number | null }): VenueMapState {
  const { venue_lat: lat, venue_lng: lng } = e;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return ok(lat) && ok(lng) ? 'pin' : 'none';
}
