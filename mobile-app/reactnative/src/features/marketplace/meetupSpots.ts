// Pure (no React Native imports) normaliser for the meetup safe-spots list.
//
// The live GET /meetup/safe-spots returns { id, name, kind, address, state, lga, lat,
// lng, verified } — `kind` (police_station | bank_branch | mall | public_landmark),
// no `category`, and no distance. The Meetup sheet was written against the mock's
// { category, distanceKm } shape, so against the real backend `s.distanceKm.toFixed(1)`
// threw on undefined and opening "Arrange meetup" crashed the app. Everything the sheet
// renders now goes through here, so a field the server does not send can never throw.

export type SafeSpotCategory = 'police' | 'bank' | 'mall' | 'public';

export interface SafeSpot {
  id: string;
  name: string;
  category: SafeSpotCategory;
  address: string;
  /** Straight-line km from `near`, or null when we cannot know it. */
  distanceKm: number | null;
  verified: boolean;
}

const KIND_TO_CATEGORY: Record<string, SafeSpotCategory> = {
  police_station: 'police',
  bank_branch: 'bank',
  mall: 'mall',
  public_landmark: 'public',
};
const CATEGORIES = new Set<string>(['police', 'bank', 'mall', 'public']);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Turns whatever the API (or mock) returned into a list the sheet can render. Never
 * throws: a non-array body is an empty list, and an entry with no id or name is
 * skipped. Spots with a known distance sort nearest-first and come before the rest;
 * the rest keep the server's order.
 */
export function normalizeSafeSpots(raw: unknown, near?: { lat: number; lng: number } | null): SafeSpot[] {
  if (!Array.isArray(raw)) return [];
  const out: SafeSpot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name) continue;

    const category: SafeSpotCategory =
      typeof r.category === 'string' && CATEGORIES.has(r.category)
        ? (r.category as SafeSpotCategory)
        : (typeof r.kind === 'string' ? KIND_TO_CATEGORY[r.kind] : undefined) ?? 'public';

    let distanceKm: number | null = null;
    if (isFiniteNumber(r.distanceKm)) distanceKm = r.distanceKm;
    else if (near && isFiniteNumber(r.lat) && isFiniteNumber(r.lng)) {
      distanceKm = haversineKm(near, { lat: r.lat, lng: r.lng });
    }

    out.push({
      id: r.id,
      name: r.name,
      category,
      address: typeof r.address === 'string' ? r.address : '',
      distanceKm,
      verified: r.verified === true,
    });
  }
  // Stable: known distances first (nearest first), unknown keep server order.
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const da = a.s.distanceKm;
      const db = b.s.distanceKm;
      if (da != null && db != null) return da - db || a.i - b.i;
      if (da != null) return -1;
      if (db != null) return 1;
      return a.i - b.i;
    })
    .map((x) => x.s);
}
