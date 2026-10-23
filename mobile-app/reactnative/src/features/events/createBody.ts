// The POST /events request body (organiser create). Pure on purpose: no imports,
// so it runs under node:test without the API client.
//
// Venue coordinates are sent only when a place was picked, i.e. both lat and lng
// are numbers; they are never sent as nulls, and a blank place id is left out.
// The backend stores them only when FEATURE_EVENTS_SOCIAL is on.

export interface CreateEventBodyInput {
  title: string;
  description: string;
  venue: string;
  category: string;
  starts_at: string;
  ends_at: string;
  fee_bps?: number;
  venue_lat?: number | null;
  venue_lng?: number | null;
  venue_place_id?: string | null;
}

export function createEventBody(input: CreateEventBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title, description: input.description, venue: input.venue,
    category: input.category, starts_at: input.starts_at, ends_at: input.ends_at,
    fee_bps: input.fee_bps ?? 500,
  };
  if (typeof input.venue_lat === 'number' && typeof input.venue_lng === 'number') {
    body.venue_lat = input.venue_lat;
    body.venue_lng = input.venue_lng;
    const placeId = input.venue_place_id?.trim();
    if (placeId) body.venue_place_id = placeId;
  }
  return body;
}
