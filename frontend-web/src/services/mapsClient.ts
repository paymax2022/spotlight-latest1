'use client';

// Typed client for the backend MapService proxy. The browser calls ONLY these
// endpoints — never a maps provider directly — so provider keys stay server-side.
//
// Every result carries `provider` + `source`. `source` is the licensing stack;
// the renderer (MapView) refuses to draw a Google-sourced point on the OpenStack
// basemap, mirroring the server-side license-coherence guard.

import { env } from '@/config/env';
import { createClient } from '@/lib/supabase/client';

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

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    /* unauthenticated — backend will reject protected calls */
  }
  return headers;
}

async function post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${env.mapsBaseUrl}${path}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`maps ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${env.mapsBaseUrl}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`maps ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const mapsClient = {
  getBasemap: (surface = 'default') =>
    get<MapStyleConfig>(`/basemap?surface=${encodeURIComponent(surface)}`),

  autocomplete: (query: string, opts?: { sessionToken?: string; surface?: string; near?: MapPoint }) =>
    post<{ suggestions: MapSuggestion[] }>('/autocomplete', {
      query,
      session_token: opts?.sessionToken,
      surface: opts?.surface,
      near: opts?.near,
    }).then((r) => r.suggestions),

  geocode: (address: string, surface?: string) =>
    post<MapGeoResult>('/geocode', { address, surface }),

  reverse: (lat: number, lng: number, surface?: string) =>
    post<MapGeoResult>('/reverse', { lat, lng, surface }),

  route: (origin: MapPoint, dest: MapPoint, profile?: string) =>
    post<MapRoute>('/route', { origin, dest, profile }),

  matchToRoad: (trace: MapPoint[]) => post<MapPolyline>('/match', { trace }),

  nearby: (entityType: string, point: MapPoint, radiusM: number, limit = 50) =>
    post<{ results: MapOwnEntity[] }>('/nearby', {
      entity_type: entityType,
      point,
      radius_m: radiusM,
      limit,
    }).then((r) => r.results),

  inZone: (point: MapPoint, zoneId: string) =>
    post<{ in_zone: boolean }>('/in-zone', { point, zone_id: zoneId }).then((r) => r.in_zone),

  upsertLocation: (entityId: string, entityType: string, lat: number, lng: number, plusCode?: string) =>
    post<{ ok: boolean; plus_code: string }>(
      '/locations',
      { entity_id: entityId, entity_type: entityType, lat, lng, plus_code: plusCode },
      { 'Idempotency-Key': idempotencyKey() },
    ),
};
