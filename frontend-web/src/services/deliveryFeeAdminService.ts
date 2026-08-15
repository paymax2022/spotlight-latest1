import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  DeliveryFeeConfig,
  GetDeliveryConfigResponse,
  PutDeliveryConfigBody,
} from '@/types/deliveryFeeAdmin';

// The Go restaurant admin routes hang off the /api prefix (same convention as
// nutritionAdminService): env.apiBaseUrl ends with /api/v1 and admin routes live
// under /api/restaurant/admin/...
function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Mock by default; flip with NEXT_PUBLIC_DELIVERY_FEE_ADMIN_USE_MOCK=false once
// the live Go admin endpoints (/api/restaurant/admin/delivery-config) are
// deployed. Matches the nutrition/mobility admin-service convention.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_DELIVERY_FEE_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Money helpers (integer kobo ↔ naira) ─────────────────────────────────────

// Kobo → naira (numeric, e.g. 80000 → 800).
export function koboToNaira(kobo: number): number {
  return (Number(kobo) || 0) / 100;
}

// Naira → integer kobo (e.g. 800 → 80000). Rounds to the nearest kobo.
export function nairaToKobo(naira: number): number {
  return Math.round((Number(naira) || 0) * 100);
}

// Kobo → display string, e.g. 80000 → "₦800.00".
export function nairaLabel(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Default-config fixture ───────────────────────────────────────────────────
// Realistic platform defaults (the hard-coded fallback used when no override
// exists). Money fields are integer kobo.
export const DEFAULT_DELIVERY_CONFIG: DeliveryFeeConfig = {
  base_fee_kobo: 80000, // ₦800
  free_distance_km: 2,
  per_km_kobo: 15000, // ₦150 / km after free km
  free_minutes: 25,
  per_minute_kobo: 5000, // ₦50 / min after free min
  demand_multiplier: 1.0,
  night_fee_kobo: 0,
  night_start_hour: 22,
  night_end_hour: 5,
  weather_fee_kobo: 0,
  handling_fee_kobo: 0,
  promo_discount_kobo: 0,
  avg_speed_kmph: 20,
  road_factor: 1.3,
  min_fee_kobo: 80000, // ₦800 floor
  max_fee_kobo: 0, // no cap
  active: true,
};

// Per-restaurant override fixture (used so the restaurant_id load path renders
// distinct values in mock mode).
const RESTAURANT_OVERRIDE_FIXTURE: DeliveryFeeConfig = {
  ...DEFAULT_DELIVERY_CONFIG,
  base_fee_kobo: 100000, // ₦1,000
  per_km_kobo: 18000, // ₦180 / km
  demand_multiplier: 1.25, // standing surge
  night_fee_kobo: 30000, // ₦300 night surcharge
  handling_fee_kobo: 15000, // ₦150 handling
  min_fee_kobo: 100000, // ₦1,000 floor
  max_fee_kobo: 500000, // ₦5,000 cap
};

// ── Reads ─────────────────────────────────────────────────────────────────

// GET /restaurant/admin/delivery-config?restaurant_id=
// Pass a restaurant_id to load that restaurant's override; omit to load the
// global default config.
export async function getDeliveryConfig(
  restaurantId?: string | null,
): Promise<GetDeliveryConfigResponse> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 200));
    if (restaurantId && restaurantId.trim()) {
      return { scope: 'restaurant', config: { ...RESTAURANT_OVERRIDE_FIXTURE } };
    }
    return { scope: 'global', config: { ...DEFAULT_DELIVERY_CONFIG } };
  }
  const params = new URLSearchParams();
  if (restaurantId && restaurantId.trim()) params.set('restaurant_id', restaurantId.trim());
  const qs = params.toString();
  const res = await fetch(
    `${adminApiBase()}/restaurant/admin/delivery-config${qs ? `?${qs}` : ''}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Delivery config fetch failed: ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as Partial<GetDeliveryConfigResponse>;
  return {
    scope: data.scope ?? 'default',
    config: { ...DEFAULT_DELIVERY_CONFIG, ...(data.config ?? {}) },
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

// PUT /restaurant/admin/delivery-config
// restaurant_id null/omitted → save the global default; a string → save that
// restaurant's override.
export async function saveDeliveryConfig(
  body: PutDeliveryConfigBody,
): Promise<GetDeliveryConfigResponse> {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, 350));
    const { restaurant_id, ...config } = body;
    return {
      scope: restaurant_id && String(restaurant_id).trim() ? 'restaurant' : 'global',
      config: config as DeliveryFeeConfig,
    };
  }
  const res = await fetch(`${adminApiBase()}/restaurant/admin/delivery-config`, {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'Idempotency-Key': operationKey(
        'delivery-fee:config-update',
        String((body as { restaurant_id?: string | null }).restaurant_id ?? 'global'),
      ),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Delivery config save failed: ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as Partial<GetDeliveryConfigResponse>;
  return {
    scope: data.scope ?? (body.restaurant_id ? 'restaurant' : 'global'),
    config: { ...body, ...(data.config ?? {}) } as DeliveryFeeConfig,
  };
}

// ── Fee formula (shared by backend semantics + live preview) ─────────────────

export interface FeeBreakdown {
  base: number;
  extraDistance: number;
  extraTime: number;
  preMultiplier: number; // base + extraDistance + extraTime
  afterMultiplier: number; // round(preMultiplier * demand_multiplier)
  night: number;
  weather: number;
  handling: number;
  promo: number;
  rawFee: number; // before clamp
  fee: number; // after clamp
  clamped: 'min' | 'max' | null;
  etaMinutes: number; // derived ETA used for the time component
}

// Derive ETA (minutes) from a straight-line distance using the road factor and
// average speed: roadDistance = distance * road_factor; minutes = roadDistance /
// speed * 60.
export function deriveEtaMinutes(distanceKm: number, cfg: DeliveryFeeConfig): number {
  const speed = cfg.avg_speed_kmph > 0 ? cfg.avg_speed_kmph : 1;
  const roadKm = Math.max(0, distanceKm) * (cfg.road_factor >= 1 ? cfg.road_factor : 1);
  return (roadKm / speed) * 60;
}

// Whether a given hour (0-23) falls in the night window [start, end), wrapping
// past midnight when start > end (e.g. 22 → 5).
export function isNightHour(hour: number, cfg: DeliveryFeeConfig): boolean {
  const { night_start_hour: s, night_end_hour: e } = cfg;
  if (s === e) return false;
  if (s < e) return hour >= s && hour < e;
  return hour >= s || hour < e; // wraps midnight
}

// Compute the full fee breakdown. distanceKm is the straight-line distance;
// hour (0-23) decides the night surcharge. Mirrors the backend formula exactly.
export function computeFee(
  distanceKm: number,
  hour: number,
  cfg: DeliveryFeeConfig,
): FeeBreakdown {
  const etaMinutes = deriveEtaMinutes(distanceKm, cfg);

  const extraDistance =
    Math.max(0, distanceKm - cfg.free_distance_km) * cfg.per_km_kobo;
  const extraTime = Math.max(0, etaMinutes - cfg.free_minutes) * cfg.per_minute_kobo;

  const preMultiplier = cfg.base_fee_kobo + extraDistance + extraTime;
  const afterMultiplier = Math.round(preMultiplier * cfg.demand_multiplier);

  const night = isNightHour(hour, cfg) ? cfg.night_fee_kobo : 0;
  const weather = cfg.weather_fee_kobo;
  const handling = cfg.handling_fee_kobo;
  const promo = cfg.promo_discount_kobo;

  const rawFee = afterMultiplier + night + weather + handling - promo;

  let fee = rawFee;
  let clamped: 'min' | 'max' | null = null;
  if (fee < cfg.min_fee_kobo) {
    fee = cfg.min_fee_kobo;
    clamped = 'min';
  }
  if (cfg.max_fee_kobo > 0 && fee > cfg.max_fee_kobo) {
    fee = cfg.max_fee_kobo;
    clamped = 'max';
  }

  return {
    base: cfg.base_fee_kobo,
    extraDistance,
    extraTime,
    preMultiplier,
    afterMultiplier,
    night,
    weather,
    handling,
    promo,
    rawFee,
    fee,
    clamped,
    etaMinutes,
  };
}
