// The Go DTO and the `Restaurant` interface the screens are written against are
// NOT the same shape, and the live path used to cast one to the other. Because a
// cast is compile-time only, `tags` arrived `undefined` and `RestaurantCard` died
// on `item.tags.map` the moment the list actually loaded — TypeScript could not
// catch it, since the interface declares `tags` required and so claims the field
// is always there.
// What the server actually sends (backend/internal/restaurant/model.go):
//   id, owner_id, name, description, address, logo_url, is_open, rating,
//   cuisine, distance_meters, created_at, min_order_kobo, packaging_fee_kobo,
//   prep_time_minutes, geo_lat, geo_lng
// Absent from it entirely: `tags`, `etaLabel`, and the icon triple. Those are
// PRESENTATION fields that only ever existed in mock.ts, which is why swapping
// the mock for the live fetch broke the card. They are derived here from real
// server data (cuisine, prep_time_minutes) rather than invented per-render.
// undefined, whatever the payload does. That is the point — the screens do
// `.map`, `.some` and `.toFixed` on these values without guarding, and one
// missing field crashes the whole tree through the error boundary.
// Deliberately dependency-free (types only) so it is unit-testable under
// `node --test` without pulling in the RN runtime.

import type { CuisineRef, MenuSection, Restaurant, RestaurantDetail, MenuCategory, MenuItem, LatLng, Order, OrderItem, ModifierGroup } from './types';

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

function mapCuisineRefs(input: unknown): CuisineRef[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((c) => { const r = asRaw(c); return { id: str(r.id), slug: str(r.slug), name: str(r.name) }; })
    .filter((c) => c.id);
}

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
    cuisineRefs: mapCuisineRefs(pick(raw, 'cuisines')),

    // does send. Empty (never undefined) when it sends none — the search filter
    // calls .some() on this directly.
    tags: visual.label ? [visual.label] : [],

    rating: num(pick(raw, 'rating')),
    etaLabel: etaLabelFrom(num(pick(raw, 'prepTimeMinutes', 'prep_time_minutes'))),

    minOrderKobo: kobo(pick(raw, 'minOrderKobo', 'min_order_kobo')),
    packagingFeeKobo: kobo(pick(raw, 'packagingFeeKobo', 'packaging_fee_kobo')),

    // deliveryFeeKobo is deliberately NOT set. It is absent from the discovery
    // comes from the delivery-quote endpoint. Emitting 0 here made an unknown
    // fee look like free delivery on both the store page and checkout — leaving
    // it undefined forces callers to treat it as unknown.

    // The server sends `has_promo` — a boolean saying an offer is live right now
    // — not the offer's terms: a discount is validated and priced server-side at
    // PlaceOrder, and this is only the discovery badge. So the label is generic
    // rather than a percentage the app would be inventing.
    promo: pick(raw, 'hasPromo', 'has_promo') === true ? 'Offer' : null,

    icon: visual.icon,
    iconColor: visual.color,
    iconBg: tint(visual.color),

    // false is still honoured. Defaulting the other way would stamp "Closed"
    // across a working storefront on any payload change.
    isOpen: bool(pick(raw, 'isOpen', 'is_open'), true),

    address: str(pick(raw, 'address')),
    location,

    likeCount: num(pick(raw, 'likeCount', 'like_count')),
    liked: bool(pick(raw, 'liked'), false),
    isFeatured: bool(pick(raw, 'isFeatured', 'is_featured'), false),
  };
}

export function mapRestaurants(input: unknown): Restaurant[] {
  const rows = Array.isArray(input) ? input : asRaw(input).restaurants;
  return Array.isArray(rows) ? rows.map(mapRestaurant) : [];
}

/**
 * Peel the order-list envelope, tolerating both shapes and an empty one.
 *
 * GET /api/v1/restaurant/orders answers `{"orders": [...]}` — and when a merchant
 * has none, `{"orders": null}` with HTTP 200. `unwrap` only peels a `data`
 * envelope, so it handed the OBJECT to `.map()`; on null that threw a TypeError,
 * the query rejected, and the merchant queue rendered "Couldn't load orders" for
 * what was simply a restaurant with no orders yet. Same shape as the
 * ListRestaurants envelope above, which had already been fixed this way.
 */
/**
 * One order line. Go answers `menu_item_id`/`quantity`/`price_kobo`
 * (internal/restaurant/model.go OrderItem); the screens read `itemId`/`qty`/
 * `priceKobo`. Nothing reconciled the two, so `it.priceKobo * it.qty` was
 * `undefined * undefined` and every line rendered "₦NaN".
 *
 * `priceKobo` is the BASE unit price. The wire also carries a per-line
 * `subtotal_kobo` = (price_kobo + modifiers_kobo) × quantity. The response does
 * emit `modifiers_kobo`, but it is always 0 today because `order_items` has no
 * such column for it to be read from, so price × qty and the line subtotal
 * agree. If modifiers are ever persisted, a screen computing
 * price × qty would understate the line and should switch to the server's
 * subtotal rather than adding modifiers here — the field is named for the base
 * price and should keep meaning that.
 */
export function mapOrderItem(input: unknown): OrderItem {
  const raw = asRaw(input);
  return {
    itemId: str(pick(raw, 'itemId', 'menu_item_id', 'menuItemId', 'id')),
    name: str(pick(raw, 'name')),
    qty: num(pick(raw, 'qty', 'quantity')),
    priceKobo: kobo(pick(raw, 'priceKobo', 'price_kobo')),
  };
}

/**
 * The order envelope, same mismatch a level up: `total_kobo`, `delivery_kobo`,
 * `delivery_address`, `created_at` on the wire against `totalKobo`,
 * `deliveryFeeKobo`, `deliveryAddress`, `createdAt` in the screens. The visible
 * symptom was "₦NaN" for every total and an empty "Delivering to:", on an order
 * whose row held the right numbers the whole time.
 *
 * Note the delivery fee is `delivery_kobo` on the wire but `deliveryFeeKobo`
 * here — not just a case change, so it is listed explicitly.
 *
 * Unknown fields are spread through untouched: this runs on every order the app
 * loads (11 call sites), and dropping a field the server adds later would break
 * a screen silently. Optional fields are only overridden when the wire actually
 * carries them, so an absent `delivered_at` stays absent rather than becoming
 * an empty string.
 */
export function mapOrder(input: unknown): Order {
  const raw = asRaw(input);
  const items = pick(raw, 'items');
  const deliveredAt = pick(raw, 'deliveredAt', 'delivered_at');
  const dispatchStatus = pick(raw, 'dispatchStatus', 'dispatch_status');
  const deliveryCode = pick(raw, 'deliveryCode', 'delivery_code');
  const pickupCode = pick(raw, 'pickupCode', 'pickup_code');
  const riderId = pick(raw, 'riderId', 'rider_id');
  const orderType = pick(raw, 'orderType', 'order_type');
  const tableNumber = pick(raw, 'tableNumber', 'table_number');
  const scheduledFor = pick(raw, 'scheduledFor', 'scheduled_for');
  const arrivedAt = pick(raw, 'arrivedAt', 'arrived_at');
  // /api/finance/restaurant/orders/:id). Defaulting it to '' would be worse
  // than leaving it alone: app/food/orders/[orderId]/rate.tsx reads
  // `order?.restaurantName ?? 'the restaurant'`, and ?? does not catch an empty
  // string, so the prompt would read "How was the food from ?".
  const restaurantName = pick(raw, 'restaurantName', 'restaurant_name');

  return {
    ...(input as Order),
    restaurantId: str(pick(raw, 'restaurantId', 'restaurant_id')),
    ...(restaurantName !== undefined ? { restaurantName: str(restaurantName) } : {}),
    items: Array.isArray(items) ? items.map(mapOrderItem) : [],
    subtotalKobo: kobo(pick(raw, 'subtotalKobo', 'subtotal_kobo')),
    deliveryFeeKobo: kobo(pick(raw, 'deliveryFeeKobo', 'delivery_fee_kobo', 'delivery_kobo')),
    serviceFeeKobo: kobo(pick(raw, 'serviceFeeKobo', 'service_fee_kobo')),
    packagingFeeKobo: kobo(pick(raw, 'packagingFeeKobo', 'packaging_fee_kobo')),
    totalKobo: kobo(pick(raw, 'totalKobo', 'total_kobo')),
    deliveryAddress: str(pick(raw, 'deliveryAddress', 'delivery_address')),
    createdAt: str(pick(raw, 'createdAt', 'created_at')),
    ...(deliveredAt !== undefined ? { deliveredAt: str(deliveredAt) } : {}),
    dispatchStatus: (dispatchStatus as Order['dispatchStatus']) ?? undefined,
    deliveryCode: (deliveryCode as string | null) ?? null,
    pickupCode: (pickupCode as string | null) ?? null,
    riderId: (riderId as string | null) ?? null,
    orderType: (orderType as Order['orderType']) ?? 'delivery',
    tableNumber: (tableNumber as string | null) ?? null,
    scheduledFor: (scheduledFor as string | null) ?? null,
    arrivedAt: (arrivedAt as string | null) ?? null,
  };
}

export function mapOrderList(input: unknown): unknown[] {
  const rows = Array.isArray(input) ? input : asRaw(input).orders;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Modifier groups on a menu item. Accepts `modifier_groups` / `modifierGroups` /
 * `modifiers` (each group carrying `modifiers` or `options`). Malformed groups
 * and options with no id are dropped; no usable group yields undefined so a
 * plain item stays plain.
 */
export function mapModifierGroups(input: unknown): ModifierGroup[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const groups: ModifierGroup[] = [];
  for (const g of input) {
    const raw = asRaw(g);
    const id = str(pick(raw, 'id'));
    const opts = pick(raw, 'options', 'modifiers');
    if (!id || !Array.isArray(opts)) continue;
    const options = opts
      .map((o) => {
        const r = asRaw(o);
        return {
          id: str(pick(r, 'id')),
          name: str(pick(r, 'name')),
          priceDeltaKobo: Math.max(0, kobo(pick(r, 'priceDeltaKobo', 'price_delta_kobo'))),
          available: bool(pick(r, 'available', 'is_available'), true),
        };
      })
      .filter((o) => o.id);
    if (options.length === 0) continue;
    const required = bool(pick(raw, 'required'), false);
    groups.push({
      id,
      name: str(pick(raw, 'name')),
      required,
      minSelect: Math.max(0, Math.trunc(num(pick(raw, 'minSelect', 'min_select')))),
      maxSelect: Math.max(1, Math.trunc(num(pick(raw, 'maxSelect', 'max_select'))) || 1),
      options,
    });
  }
  return groups.length > 0 ? groups : undefined;
}

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

    // which is the packing rule already applied elsewhere.
    foodType: undefined,

    prepMinutes: num(pick(raw, 'prepMinutes', 'prep_minutes')) > 0 ? num(pick(raw, 'prepMinutes', 'prep_minutes')) : undefined,

    modifierGroups: mapModifierGroups(pick(raw, 'modifierGroups', 'modifier_groups', 'modifiers')),
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

export function mapMenuSection(input: unknown): MenuSection {
  const raw = asRaw(input);
  const items = pick(raw, 'items');
  const id = raw.id;
  return {
    id: typeof id === 'string' && id ? id : null,
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
  const sections = pick(raw, 'sections');

  return {
    ...mapRestaurant(nested ?? raw),
    menu: Array.isArray(categories) ? categories.map(mapMenuCategory) : [],
    sections: Array.isArray(sections) ? sections.map(mapMenuSection) : undefined,
  };
}
