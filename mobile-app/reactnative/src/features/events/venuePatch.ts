// Maps an address-autocomplete selection onto the event form's venue fields.
// Pure on purpose: no imports, so it runs under node:test without the app.

export interface VenueSelection {
  label: string;
  lat: number;
  lng: number;
  placeId?: string | null;
}

export interface VenuePatch {
  venue: string;
  venue_lat: number | null;
  venue_lng: number | null;
  venue_place_id: string | null;
}

/** A null selection clears all four fields so a stale pin never survives. */
export function venuePatchFromSelection(sel: VenueSelection | null): VenuePatch {
  if (!sel) return { venue: '', venue_lat: null, venue_lng: null, venue_place_id: null };
  return {
    venue: sel.label,
    venue_lat: sel.lat,
    venue_lng: sel.lng,
    venue_place_id: sel.placeId ?? null,
  };
}
