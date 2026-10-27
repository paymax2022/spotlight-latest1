// One resolver for every consumer address-capture surface (food delivery, parcel
// pickup/drop-off). It goes through the backend MapService proxy — the provider-
// agnostic stack now standardized on Google (autocomplete + geocoding + reverse),
// which keeps the provider key server-side and returns Plus Codes for Nigeria
// delivery accuracy. When the proxy is unreachable (local dev / demo builds), it
// degrades to a deterministic OFFLINE geocoder so the field never goes dead.
// Everything below returns ONE normalized shape (`AddressHit`) so the UI never
// has to know which provider answered. A hit may arrive WITHOUT coordinates
// (Google text suggestions); call `resolveCoordinate` before relying on lat/lng.

import * as proxy from '@/features/mobility/api/maps.api';
import { MAPS_PROXY_DISABLED } from '@/features/mobility/api/maps.api';

export type AddressSource = 'proxy' | 'mapbox' | 'mock';

/** Whether the backend maps proxy should be attempted at all. When disabled via
 *  EXPO_PUBLIC_MAPS_BASE_URL=off, the resolver is offline-only (no network). */
function proxyEnabled(): boolean {
  return !MAPS_PROXY_DISABLED;
}

/** A normalized address result, provider-agnostic. */
export interface AddressHit {
  /** Stable id for list keys. */
  id: string;
  /** Full human-readable address (the label shown in the field). */
  label: string;
  /** Short primary line (name/road) for emphasis in a suggestion row. */
  primary: string;
  /** Remainder of the address shown as the secondary line. */
  secondary: string;
  /** Coordinate — may be undefined for text-only suggestions until resolved. */
  lat?: number;
  lng?: number;
  /** Plus Code (open location code) when the source provided one. */
  plusCode?: string;
  /** Which stack answered, for diagnostics/attribution. */
  source: AddressSource;
  /**
   * True when the coordinate was MADE UP rather than found: the offline geocoder
   * invents a plausible point near the bias so a form can still be filled in a demo
   * build. Nothing may treat such a hit as the location of a real building — a
   * delivery fee computed from one is a guess, and a restaurant pinned on one is in
   * the wrong street. Consumers use this to insist on a confirmed map pin instead.
   */
  estimated?: boolean;
}

/** A fully-resolved address — guaranteed to carry a coordinate. */
export interface ResolvedAddress {
  label: string;
  lat: number;
  lng: number;
  plusCode?: string;
  source: AddressSource;
  /** True when the coordinate came from a confirmed map pin / reverse geocode. */
  precise: boolean;
  /** True when the coordinate was invented by the offline geocoder — see AddressHit. */
  estimated?: boolean;
}

interface LookupOpts {
  near?: { lat: number; lng: number };
  /** Consumer surface drives proxy provider routing ('checkout' | 'delivery'). */
  surface?: 'checkout' | 'delivery';
  /** Per-keystroke session token (proxy autocomplete billing/coherence). */
  sessionToken?: string;
  signal?: AbortSignal;
  limit?: number;
}

// a round-trip + timeout before falling back to the offline geocoder.
const PROXY_COOLDOWN_MS = 60_000;
let proxyDownUntil = 0;

function proxyLikelyUp(): boolean {
  return Date.now() >= proxyDownUntil;
}
function markProxyDown(): void {
  proxyDownUntil = Date.now() + PROXY_COOLDOWN_MS;
}
function markProxyUp(): void {
  proxyDownUntil = 0;
}

// Mapbox Geocoding API v5 fallback. Sits between the backend MapService proxy
// (preferred, Google-backed, provider key stays server-side) and the offline
// deterministic geocoder (dev-only safety net). Enabled when
// EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is set — the token is a pk.* public key safe
// to embed in a client build; it is NOT a server secret. Used when the proxy
// is down or returns zero suggestions, so the merchant-manage address field
// still works in environments where the Go /api/finance/maps proxy isn't
// reachable (e.g. the restaurant onboarding path when the backend container
// predates the maps module).
const MAPBOX_TOKEN = (process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '').trim();
const MAPBOX_COOLDOWN_MS = 60_000;
let mapboxDownUntil = 0;

function mapboxEnabled(): boolean {
  return MAPBOX_TOKEN !== '';
}
function mapboxLikelyUp(): boolean {
  return Date.now() >= mapboxDownUntil;
}
function markMapboxDown(): void {
  mapboxDownUntil = Date.now() + MAPBOX_COOLDOWN_MS;
}
function markMapboxUp(): void {
  mapboxDownUntil = 0;
}

interface MapboxFeature {
  id?: string;
  place_name?: string;
  text?: string;
  center?: [number, number]; // [lng, lat]
  context?: Array<{ text?: string }>;
}

async function mapboxSearch(query: string, near?: { lat: number; lng: number }, signal?: AbortSignal): Promise<AddressHit[]> {
  const base = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    country: 'ng',
    types: 'address,place,poi,neighborhood,locality',
    limit: '5',
    autocomplete: 'true',
    language: 'en',
  });
  if (near) params.set('proximity', `${near.lng},${near.lat}`);
  const url = `${base}/${encodeURIComponent(query)}.json?${params.toString()}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`mapbox ${res.status}`);
  const body = (await res.json()) as { features?: MapboxFeature[] };
  return (body.features ?? []).map((f, idx): AddressHit => {
    const label = f.place_name ?? f.text ?? '';
    const { primary, secondary } = splitLabel(label);
    const hasCenter = Array.isArray(f.center) && f.center.length === 2;
    return {
      id: f.id ?? `mapbox:${idx}:${label}`,
      label,
      primary,
      secondary,
      lat: hasCenter ? f.center![1] : undefined,
      lng: hasCenter ? f.center![0] : undefined,
      source: 'mapbox',
    };
  }).filter((h) => h.label !== '');
}

/** True when AT LEAST ONE backend exists for address lookup. */
export function addressLookupEnabled(): boolean {
  return (proxyEnabled() && proxyLikelyUp())
    || (mapboxEnabled() && mapboxLikelyUp())
    || offlineEnabled();
}

function splitLabel(label: string): { primary: string; secondary: string } {
  const i = label.indexOf(',');
  if (i <= 0) return { primary: label.trim(), secondary: '' };
  return { primary: label.slice(0, i).trim(), secondary: label.slice(i + 1).trim() };
}

function fromProxy(s: proxy.MapSuggestion, idx: number): AddressHit {
  const { primary, secondary } = splitLabel(s.label);
  const hasCoords = s.has_coords && typeof s.lat === 'number' && typeof s.lng === 'number';
  return {
    id: s.place_id ?? `proxy:${idx}:${s.label}`,
    label: s.label,
    primary,
    secondary,
    lat: hasCoords ? s.lat : undefined,
    lng: hasCoords ? s.lng : undefined,
    source: 'proxy',
  };
}

function aborted(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError';
}

// Last-resort, zero-dependency address resolution for environments where neither
// the maps proxy (Google) is available (local dev, demo and
// preview builds). Without it, a dead geocoder leaks the provider's raw error
// (e.g. `{"error":"Unable to geocode"}`) into the delivery field. With it, every
// query yields selectable suggestions WITH coordinates, so address capture never
// errors and the distance-based delivery fee can still compute. Deterministic:
// the same typed text always maps to the same coordinate.
// when a real provider is expected).
const OFFLINE_DISABLED = process.env.EXPO_PUBLIC_ADDRESS_OFFLINE === 'false';

function offlineEnabled(): boolean {
  return !OFFLINE_DISABLED;
}

interface OfflinePlace {
  name: string;
  area: string;
  lat: number;
  lng: number;
}

// Curated, commonly-used Nigerian delivery areas (the consumer surfaces are
// Nigeria-only). Coordinates are area centroids — good enough for a dev/demo
// distance estimate; the proxy (Google) provides precise coords in production.
const OFFLINE_PLACES: OfflinePlace[] = [
  { name: 'Victoria Island', area: 'Lagos', lat: 6.4281, lng: 3.4216 },
  { name: 'Lekki Phase 1', area: 'Lagos', lat: 6.4474, lng: 3.4699 },
  { name: 'Ikoyi', area: 'Lagos', lat: 6.4520, lng: 3.4350 },
  { name: 'Ikeja', area: 'Lagos', lat: 6.6018, lng: 3.3515 },
  { name: 'Ikeja GRA', area: 'Lagos', lat: 6.5790, lng: 3.3600 },
  { name: 'Yaba', area: 'Lagos', lat: 6.5095, lng: 3.3711 },
  { name: 'Surulere', area: 'Lagos', lat: 6.4969, lng: 3.3481 },
  { name: 'Maryland', area: 'Lagos', lat: 6.5719, lng: 3.3667 },
  { name: 'Gbagada', area: 'Lagos', lat: 6.5510, lng: 3.3870 },
  { name: 'Ajah', area: 'Lagos', lat: 6.4698, lng: 3.5852 },
  { name: 'Apapa', area: 'Lagos', lat: 6.4490, lng: 3.3590 },
  { name: 'Festac Town', area: 'Lagos', lat: 6.4650, lng: 3.2870 },
  { name: 'Magodo', area: 'Lagos', lat: 6.6160, lng: 3.3760 },
  { name: 'Oshodi', area: 'Lagos', lat: 6.5550, lng: 3.3480 },
  { name: 'Wuse 2', area: 'Abuja', lat: 9.0820, lng: 7.4760 },
  { name: 'Garki', area: 'Abuja', lat: 9.0330, lng: 7.4890 },
  { name: 'Maitama', area: 'Abuja', lat: 9.0870, lng: 7.4920 },
  { name: 'GRA', area: 'Port Harcourt', lat: 4.8156, lng: 7.0498 },
];

const LAGOS_DEFAULT = { lat: 6.4541, lng: 3.3947 };

// Stable 0..1 hash of a string → deterministic synthetic offsets.
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Synthesize a coordinate for free-typed text: a deterministic 1.2–6.2 km offset
// from the bias point so the distance fee is plausible and stable per address.
function syntheticCoord(text: string, near: { lat: number; lng: number }): { lat: number; lng: number } {
  const km = 1.2 + hash01(text) * 5;
  const bearing = hash01(`${text}·`) * 2 * Math.PI;
  const dLat = (km / 111) * Math.cos(bearing);
  const dLng = (km / (111 * Math.cos((near.lat * Math.PI) / 180))) * Math.sin(bearing);
  return { lat: near.lat + dLat, lng: near.lng + dLng };
}

function offlineSearch(query: string, near?: { lat: number; lng: number }): AddressHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const anchor = near ?? LAGOS_DEFAULT;
  // 1) Known areas matching the query, nearest to the bias point first.
  const matches: AddressHit[] = OFFLINE_PLACES.map((p) => ({
    p,
    d: (p.lat - anchor.lat) ** 2 + (p.lng - anchor.lng) ** 2,
  }))
    .filter(({ p }) => `${p.name} ${p.area}`.toLowerCase().includes(q))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ p }) => ({
      id: `offline:${p.name}`,
      label: `${p.name}, ${p.area}`,
      primary: p.name,
      secondary: p.area,
      lat: p.lat,
      lng: p.lng,
      source: 'mock' as const,
    }));
  // 2) Always offer the exact typed text as a usable drop-off so the user can
  //    proceed even when it isn't a known area.
  const typedLabel = titleCase(query);
  const isDupe = matches.some((m) => m.primary.toLowerCase() === typedLabel.toLowerCase());
  if (isDupe) return matches;
  const c = syntheticCoord(query, anchor);
  return [
    ...matches,
    {
      id: `offline:typed:${q}`,
      label: typedLabel,
      primary: typedLabel,
      secondary: 'Use this delivery address',
      lat: c.lat,
      lng: c.lng,
      source: 'mock',
      // The point is invented from the text, not looked up. Honest flag, because a
      // caller that saves it as the location of a real building would be wrong.
      estimated: true,
    },
  ];
}

function offlineReverse(lat: number, lng: number): ResolvedAddress {
  // Label with the nearest known area but keep the exact coordinate (it's precise).
  let best = OFFLINE_PLACES[0];
  let bestD = Infinity;
  for (const p of OFFLINE_PLACES) {
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { label: `Near ${best.name}, ${best.area}`, lat, lng, source: 'mock', precise: true };
}

/**
 * Autocomplete an address query via the backend MapService proxy (Google), with
 * an offline fallback. Returns [] (never throws) so the UI degrades to a plain
 * text field. Abort via `opts.signal` to cancel stale keystrokes.
 */
export async function searchAddress(query: string, opts: LookupOpts = {}): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  if (proxyEnabled() && proxyLikelyUp()) {
    try {
      const suggestions = await proxy.autocomplete(q, {
        sessionToken: opts.sessionToken,
        surface: opts.surface ?? 'checkout',
        near: opts.near,
        signal: opts.signal,
      });
      markProxyUp();
      if (suggestions.length > 0) return suggestions.map(fromProxy);
    } catch (e) {
      if (aborted(e)) return [];
      markProxyDown();
    }
  }
  // Mid-tier fallback — Mapbox Geocoding v5. Used when the backend MapService
  // proxy is unreachable or returned an empty list. Avoids the deterministic
  // offline fallback below (which produces synthetic coordinates) when a real
  // provider token is available.
  if (mapboxEnabled() && mapboxLikelyUp()) {
    try {
      const suggestions = await mapboxSearch(q, opts.near, opts.signal);
      markMapboxUp();
      if (suggestions.length > 0) return suggestions;
    } catch (e) {
      if (aborted(e)) return [];
      markMapboxDown();
    }
  }
  // Proxy + Mapbox both unavailable/empty — degrade to the offline geocoder so
  // the field stays usable (and never surfaces a raw provider error) in
  // dev/demo builds.
  if (offlineEnabled()) return offlineSearch(q, opts.near);
  return [];
}

/**
 * Ensure a hit has a coordinate. Text-only suggestions (Google Autocomplete via
 * the proxy carry no coordinate) are geocoded via the proxy (Google Geocoding);
 * hits that already carry coordinates pass straight through.
 */
export async function resolveCoordinate(
  hit: AddressHit,
  opts: Pick<LookupOpts, 'surface' | 'signal'> = {},
): Promise<ResolvedAddress | null> {
  if (typeof hit.lat === 'number' && typeof hit.lng === 'number') {
    return {
      label: hit.label, lat: hit.lat, lng: hit.lng, plusCode: hit.plusCode,
      source: hit.source, precise: false, estimated: hit.estimated,
    };
  }
  // Text-only suggestion → geocode it via the proxy (Google).
  if (proxyEnabled() && proxyLikelyUp()) {
    try {
      const g = await proxy.geocode(hit.label, opts.surface ?? 'default');
      markProxyUp();
      return { label: hit.label, lat: g.lat, lng: g.lng, plusCode: g.plus_code, source: 'proxy', precise: false };
    } catch (e) {
      if (aborted(e)) return null;
      markProxyDown();
    }
  }
  // Mapbox mid-tier geocode fallback — same provider as the suggestion list, so
  // a proxy-sourced text hit (no coords) still resolves to a real coordinate
  // instead of being faked by the offline geocoder below.
  if (mapboxEnabled() && mapboxLikelyUp()) {
    try {
      const [first] = await mapboxSearch(hit.label, undefined, opts.signal);
      markMapboxUp();
      if (first && typeof first.lat === 'number' && typeof first.lng === 'number') {
        return { label: hit.label, lat: first.lat, lng: first.lng, source: 'mapbox', precise: false };
      }
    } catch (e) {
      if (aborted(e)) return null;
      markMapboxDown();
    }
  }
  // Offline fallback: synthesize a deterministic coordinate from the label so a
  // text-only suggestion still resolves (and the delivery fee can compute).
  if (offlineEnabled()) {
    const [hit2] = offlineSearch(hit.label);
    if (hit2 && typeof hit2.lat === 'number' && typeof hit2.lng === 'number') {
      return {
        label: hit.label, lat: hit2.lat, lng: hit2.lng, source: 'mock',
        precise: false, estimated: hit2.estimated,
      };
    }
  }
  return null;
}

/**
 * Reverse-geocode a coordinate to a human address + Plus Code. Used after a map
 * pin drag/tap and by the "use my current location" flow. Never throws.
 */
export async function reverseLookup(
  lat: number,
  lng: number,
  opts: Pick<LookupOpts, 'signal'> = {},
): Promise<ResolvedAddress | null> {
  if (proxyEnabled() && proxyLikelyUp()) {
    try {
      const r = await proxy.reverse(lat, lng, 'default');
      markProxyUp();
      return { label: r.address, lat: r.lat, lng: r.lng, plusCode: r.plus_code, source: 'proxy', precise: true };
    } catch (e) {
      if (aborted(e)) return null;
      markProxyDown();
    }
  }
  // No reverse provider — hand back the precise coordinate with a best-effort
  // label (nearest known area offline, else the raw coordinate).
  if (offlineEnabled()) return offlineReverse(lat, lng);
  return { label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng, source: 'mock', precise: true };
}

/**
 * Compose the courier-facing address string, appending the Plus Code when one was
 * captured. This rides inside the existing `address` field of the order/parcel
 * payload — no API contract change — so the courier receives the precise open
 * location code even though the wire schema only carries free text + coordinate.
 */
export function withPlusCode(label: string, plusCode?: string): string {
  const code = plusCode?.trim();
  if (!code) return label;
  if (label.includes(code)) return label;
  return `${label} · Plus Code ${code}`;
}
