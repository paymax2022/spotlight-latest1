// ── Restaurant & Delivery — live-payload normalizer ──────────────────────────
//
// The Go DTO and the `Restaurant` interface the screens are written against are
// NOT the same shape, and the live path used to cast one to the other. Because a
// cast is compile-time only, `tags` arrived `undefined` and `RestaurantCard` died
// on `item.tags.map` the moment the list actually loaded — TypeScript could not
// catch it, since the interface declares `tags` required and so claims the field
// is always there.
//
// What the server actually sends (backend/internal/restaurant/model.go):
//
//   id, owner_id, name, description, address, logo_url, is_open, rating,
//   cuisine, distance_meters, created_at, min_order_kobo, packaging_fee_kobo,
//   prep_time_minutes, geo_lat, geo_lng
//
// Absent from it entirely: `tags`, `etaLabel`, and the icon triple. Those are
// PRESENTATION fields that only ever existed in mock.ts, which is why swapping
// the mock for the live fetch broke the card. They are derived here from real
// server data (cuisine, prep_time_minutes) rather than invented per-render.
//
// Every function is total: a required field on `Restaurant` is never left
// undefined, whatever the payload does. That is the point — the screens do
// `.map`, `.some` and `.toFixed` on these values without guarding, and one
// missing field crashes the whole tree through the error boundary.
//
// Deliberately dependency-free (types only) so it is unit-testable under
// `node --test` without pulling in the RN runtime.

import type { Restaurant, RestaurantDetail, MenuCategory, MenuItem, LatLng } from './types';

type Raw = Record<string, unknown>;

const asRaw = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});

/** First present value among `keys`, so camelCase and snake_case both resolve. */
function pick(raw: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Money, as integer kobo. A non-integer here means the server broke the kobo
 * contract; truncate rather than propagate a float into anything that later
 * adds it up. These particular values are display-only (see deliveryFeeKobo
 * below), so this cannot alter a charged amount.
 */
const kobo = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;

// ── Presentation derived from server data ────────────────────────────────────

/** Visual identity per cuisine, matching the palette the mock established. */
const CUISINE_VISUAL: Record<string, { icon: string; color: string; label: string }> = {
  local:   { icon: 'UtensilsCrossed', color: '#EF4444', label: 'Local' },
  fast:    { icon: 'Drumstick',       color: '#F97316', label: 'Fast Food' },
  chinese: { icon: 'Soup',            color: '#48B8AC', label: 'Chinese' },
  grills:  { icon: 'Flame',           color: '#EAB308', label: 'Grills' },
  healthy: { icon: 'Salad',           color: '#16A34A', label: 'Healthy' },
};

const FALLBACK_VISUAL = { icon: 'Utensils', color: '#6B7280', label: '' };

/** '#RRGGBB' → 'rgba(r,g,b,alpha)', the tint convention the cards use. */
function tint(hex: string, alpha = 0.08): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(107,114,128,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * ETA copy from the kitchen's prep time. The window is prep → prep+10 to cover
 * the ride, matching the "20–30 min" form the mock used. Rendered as an em-dash
 * when the server has no prep time — better an honest blank than a made-up ETA
 * the kitchen never promised.
 */
function etaLabelFrom(prepMinutes: number): string {
  if (!Number.isFinite(prepMinutes) || prepMinutes <= 0) return '—';
  const p = Math.trunc(prepMinutes);
  return `${p}–${p + 10} min`;
}

// ── Restaurant ───────────────────────────────────────────────────────────────

export function mapRestaurant(input: unknown): Restaurant {
  const raw = asRaw(input);

  const cuisine = str(pick(raw, 'cuisine')).trim().toLowerCase();
  const visual = CUISINE_VISUAL[cuisine] ?? FALLBACK_VISUAL;

  const lat = pick(raw, 'geoLat', 'geo_lat', 'lat');
  const lng = pick(raw, 'geoLng', 'geo_lng', 'lng');
  const location: LatLng | null =
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : null;

  return {
    id: str(pick(raw, 'id')),
    name: str(pick(raw, 'name')),
    cuisine,

    // The server has no tag list; the cuisine is the one real classification it
    // does send. Empty (never undefined) when it sends none — the search filter
    // calls .some() on this directly.
    tags: visual.label ? [visual.label] : [],

    rating: num(pick(raw, 'rating')),
    etaLabel: etaLabelFrom(num(pick(raw, 'prepTimeMinutes', 'prep_time_minutes'))),

    minOrderKobo: kobo(pick(raw, 'minOrderKobo', 'min_order_kobo')),
    packagingFeeKobo: kobo(pick(raw, 'packagingFeeKobo', 'packaging_fee_kobo')),

    // NOT part of the discovery DTO. The authoritative delivery fee is
    // distance-based and comes from the quote endpoint at checkout, so no food
    // screen reads this field. Zero here is a placeholder, never a quoted price.
    deliveryFeeKobo: 0,

    promo: null,

    icon: visual.icon,
    iconColor: visual.color,
    iconBg: tint(visual.color),

    // Discovery serves ListOpenRestaurants, so absence means open; an explicit
    // false is still honoured. Defaulting the other way would stamp "Closed"
    // across a working storefront on any payload change.
    isOpen: bool(pick(raw, 'isOpen', 'is_open'), true),

    address: str(pick(raw, 'address')),
    location,
  };
}

export function mapRestaurants(input: unknown): Restaurant[] {
  const rows = Array.isArray(input) ? input : asRaw(input).restaurants;
  return Array.isArray(rows) ? rows.map(mapRestaurant) : [];
}

// ── Menu ─────────────────────────────────────────────────────────────────────

export function mapMenuItem(input: unknown): MenuItem {
  const raw = asRaw(input);
  return {
    id: str(pick(raw, 'id')),
    name: str(pick(raw, 'name')),
    description: str(pick(raw, 'description')) || undefined,
    priceKobo: kobo(pick(raw, 'priceKobo', 'price_kobo')),

    // `is_available` on the wire. Defaulting to unavailable on a malformed row
    // is the safe direction: it hides an item rather than letting someone order
    // something the kitchen has turned off.
    available: bool(pick(raw, 'available', 'is_available'), false),

    // No food_type on the wire yet; `undefined` means 'regular' per the type,
    // which is the packing rule already applied elsewhere.
    foodType: undefined,
  };
}

export function mapMenuCategory(input: unknown): MenuCategory {
  const raw = asRaw(input);
  const items = pick(raw, 'items');
  return {
    id: str(pick(raw, 'id')),
    name: str(pick(raw, 'name')),
    items: Array.isArray(items) ? items.map(mapMenuItem) : [],
  };
}

/**
 * Detail is doubly mismatched: Go answers `{restaurant: {...}, categories: [...]}`
 * while the screens expect a FLAT Restaurant carrying `menu`. Flatten and rename
 * here; tolerate an already-flat body in case the handler is ever changed.
 */
export function mapRestaurantDetail(input: unknown): RestaurantDetail {
  const raw = asRaw(input);
  const nested = pick(raw, 'restaurant');
  const categories = pick(raw, 'categories', 'menu');

  return {
    ...mapRestaurant(nested ?? raw),
    menu: Array.isArray(categories) ? categories.map(mapMenuCategory) : [],
  };
}
