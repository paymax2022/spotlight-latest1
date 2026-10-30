// Pure helper: places pins on the schematic map by their REAL coordinates,
// scaled to the bounding box of the points (with a margin). Points without
// coordinates are dropped rather than given an invented position.

export interface GeoPoint {
  id: string;
  label: string;
  lat?: number;
  lng?: number;
  active?: boolean;
}

export interface MapPin {
  id: string;
  label: string;
  x: number;
  y: number;
  active?: boolean;
}

const MARGIN = 0.15;

export function projectPins(points: GeoPoint[]): MapPin[] {
  const geo = points.filter(
    (p): p is GeoPoint & { lat: number; lng: number } =>
      typeof p.lat === 'number' && typeof p.lng === 'number' && (p.lat !== 0 || p.lng !== 0),
  );
  if (geo.length === 0) return [];
  const lats = geo.map((p) => p.lat);
  const lngs = geo.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const span = (lo: number, hi: number, v: number) => (hi === lo ? 0.5 : MARGIN + ((v - lo) / (hi - lo)) * (1 - 2 * MARGIN));
  return geo.map((p) => ({
    id: p.id,
    label: p.label,
    x: span(minLng, maxLng, p.lng),
    // latitude grows northwards, screen y grows downwards
    y: 1 - span(minLat, maxLat, p.lat),
    active: p.active,
  }));
}
