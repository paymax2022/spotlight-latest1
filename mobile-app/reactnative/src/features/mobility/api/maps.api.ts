// Mobile client for the backend MapService proxy. Reuses the shared axios `api`
// instance (which injects the Supabase Bearer token), but targets absolute maps
// URLs so it hits the Go backend's /api/finance/maps endpoints.
//
// The app calls ONLY these endpoints — never a maps provider directly — so no
// provider key ever ships in the app. Every result carries `provider` + `source`;
// the renderer refuses to draw a Google-sourced point on the OpenStack basemap.

import { api } from '@/api/client';

// Point this at the Go backend. Defaults by stripping a trailing /api/v1 from the
// shared API base and appending the maps path.
const RAW_API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8080';
export const MAPS_BASE =
  process.env.EXPO_PUBLIC_MAPS_BASE_URL ||
  RAW_API_BASE.replace(/\/api\/v1\/?$/, '') + '/api/finance/maps';

export type MapSource = 'openstack' | 'google' | 'mapbox' | 'own';

export interface MapPoint {
  lat: number;
  lng: number;
  source?: MapSource;
}

export interface MapGeoResult {
  lat: number;
  lng: number;
  address: string;
  plus_code: string;
  provider: string;
  source: MapSource;
  cacheable: boolean;
}

export interface MapSuggestion {
  label: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  has_coords?: boolean;
  provider: string;
  source: MapSource;
}

export interface MapStyleConfig {
  style_url: string;
  attribution: string;
  provider: string;
  source: MapSource;
}

export interface MapRoute {
  distance_m: number;
  duration_s: number;
  polyline: string;
  provider: string;
  source: MapSource;
  degraded?: boolean;
}

export interface MapPolyline {
  points?: MapPoint[];
  encoded?: string;
  provider: string;
  source: MapSource;
}

export interface MapOwnEntity {
  entity_id: string;
  entity_type: string;
  lat: number;
  lng: number;
  plus_code?: string;
  distance_m: number;
}

export async function getBasemap(surface = 'default'): Promise<MapStyleConfig> {
  const { data } = await api.get(`${MAPS_BASE}/basemap`, { params: { surface } });
  return data;
}

export async function autocomplete(
  query: string,
  opts?: { sessionToken?: string; surface?: string; near?: MapPoint },
): Promise<MapSuggestion[]> {
  const { data } = await api.post(`${MAPS_BASE}/autocomplete`, {
    query,
    session_token: opts?.sessionToken,
    surface: opts?.surface,
    near: opts?.near,
  });
  return data.suggestions ?? [];
}

export async function geocode(address: string, surface?: string): Promise<MapGeoResult> {
  const { data } = await api.post(`${MAPS_BASE}/geocode`, { address, surface });
  return data;
}

export async function reverse(lat: number, lng: number, surface?: string): Promise<MapGeoResult> {
  const { data } = await api.post(`${MAPS_BASE}/reverse`, { lat, lng, surface });
  return data;
}

export async function route(origin: MapPoint, dest: MapPoint, profile?: string): Promise<MapRoute> {
  const { data } = await api.post(`${MAPS_BASE}/route`, { origin, dest, profile });
  return data;
}

export async function matchToRoad(trace: MapPoint[]): Promise<MapPolyline> {
  const { data } = await api.post(`${MAPS_BASE}/match`, { trace });
  return data;
}

export async function nearby(
  entityType: string,
  point: MapPoint,
  radiusM: number,
  limit = 50,
): Promise<MapOwnEntity[]> {
  const { data } = await api.post(`${MAPS_BASE}/nearby`, {
    entity_type: entityType,
    point,
    radius_m: radiusM,
    limit,
  });
  return data.results ?? [];
}

export async function inZone(point: MapPoint, zoneId: string): Promise<boolean> {
  const { data } = await api.post(`${MAPS_BASE}/in-zone`, { point, zone_id: zoneId });
  return !!data.in_zone;
}

export async function upsertLocation(
  entityId: string,
  entityType: string,
  lat: number,
  lng: number,
  plusCode?: string,
): Promise<{ ok: boolean; plus_code: string }> {
  const idem =
    typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : String(Date.now());
  const { data } = await api.post(
    `${MAPS_BASE}/locations`,
    { entity_id: entityId, entity_type: entityType, lat, lng, plus_code: plusCode },
    { headers: { 'Idempotency-Key': idem } },
  );
  return data;
}

export const mapsApi = {
  getBasemap,
  autocomplete,
  geocode,
  reverse,
  route,
  matchToRoad,
  nearby,
  inZone,
  upsertLocation,
};
