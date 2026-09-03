// ── Restaurant & Delivery — API wrapper ──────────────────────────────────────
// Typed data layer the food screens code against. Mirrors parcel.api.ts:
// mock-flagged, shared axios `api` client, BASE = '/api/v1/restaurant',
// Idempotency-Key on money mutations. Flip EXPO_PUBLIC_FOOD_USE_MOCK=false (or
// EXPO_PUBLIC_RESTAURANT_USE_MOCK) once the Go endpoints are reachable.
//
// IRON RULES: all money is integer kobo; placing an order carries an
// Idempotency-Key; price breakdowns come from the SERVER — never computed here.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  Restaurant,
  RestaurantDetail,
  Order,
  OrderStatus,
  OrderRole,
  ChatMessage,
  RiderOffer,
  PlaceOrderRequest,
  RateOrderRequest,
  LatLng,
} from './types';
import {
  MOCK_RESTAURANTS,
  mockRestaurantDetail,
  makeOrder,
  advanceMockOrder,
  mockStore,
  mockMessages,
  pushMockMessage,
  mockOrdersByRole,
  mockRiderOffers,
  mockAcceptOffer,
  mockSetStatus,
  mockCancel,
  mockConfirmPickup,
  mockConfirmHandoff,
  mockRedispatch,
} from './mock';
import { mapRestaurants, mapRestaurantDetail, mapOrderList, mapOrder } from './normalize';
import { computeDeliveryFeeMock, type DeliveryQuote } from './deliveryFee';
export type { DeliveryQuote, DeliveryFeeBreakdown } from './deliveryFee';

export const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_FOOD_USE_MOCK ?? process.env.EXPO_PUBLIC_RESTAURANT_USE_MOCK, true);

const BASE = '/api/v1/restaurant';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

/**
 * Backfill the order's dispatch fields from the backend's snake_case payload.
 * The API otherwise returns the camelCase Order shape; this only normalizes the
 * newer auto-dispatch fields (`dispatch_status`, `delivery_code`, `rider_id`).
 */

// ─── Discovery ────────────────────────────────────────────────────────────────

/** One page of discovery results, with the totals needed to keep paging. */
export interface RestaurantPage {
  items: Restaurant[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Server-side filters. `cuisine: 'all'` and an empty query mean "no filter". */
export interface RestaurantQuery {
  q?: string;
  cuisine?: string;
  /**
   * 'eta' sorts by kitchen prep time — the Nearby view's fallback when the
   * device has no location. 'distance' sorts by real proximity to `nearLat`/
   * `nearLng`; without both of those the server degrades it to the same 'eta'
   * proxy, so passing 'distance' alone is always safe.
   */
  sort?: 'newest' | 'rating' | 'name' | 'eta' | 'distance';
  /** Keep only restaurants running a live offer (the Offers view). */
  promo?: boolean;
  /** Device coordinates for `sort: 'distance'`. Ignored by every other sort. */
  nearLat?: number;
  nearLng?: number;
  limit?: number;
  offset?: number;
}

export const RESTAURANT_PAGE_SIZE = 20;

/**
 * One page of open restaurants.
 *
 * This used to fetch the ENTIRE list — 2,016 open rows against the live DB — and
 * every screen filtered it in memory. The list view rendered a card per row, so
 * a single browse cost ~48k DOM nodes on web and a payload that had to be fully
 * parsed before anything was drawn.
 *
 * Search and cuisine are now sent to the server WITH the page. They have to move
 * together: filtering a page locally would quietly hide every match that fell on
 * a later page, which is worse than slow.
 */
export async function listRestaurants(params: RestaurantQuery = {}): Promise<RestaurantPage> {
  const limit = params.limit ?? RESTAURANT_PAGE_SIZE;
  const offset = params.offset ?? 0;

  if (USE_MOCK) {
    await delay();
    // Mirror the server's filter semantics so the mock and live paths page
    // identically — a mock that ignored the filters would page a different list.
    const q = (params.q ?? '').trim().toLowerCase();
    const cuisine = (params.cuisine ?? '').trim().toLowerCase();
    const all = MOCK_RESTAURANTS.filter((r) => {
      if (cuisine && cuisine !== 'all' && r.cuisine.toLowerCase() !== cuisine) return false;
      if (params.promo && !r.promo) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q));
    });
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, limit, offset, hasMore: offset + items.length < all.length };
  }

  // The Go discovery handler answers `{"restaurants": [...], "total", "limit",
  // "offset", "has_more"}` (handler_delivery.go ListRestaurants) and the Next
  // proxy forwards the body VERBATIM, so `unwrap` — which only peels a `data`
  // envelope — hands back that OBJECT rather than an array. mapRestaurants peels
  // the `restaurants` key, tolerating a bare array in case the handler is ever
  // flattened.
  //
  // It also NORMALIZES each row. The rows were previously cast straight to
  // `Restaurant`, but the server sends neither `tags` nor `etaLabel` nor the icon
  // triple — those only existed in mock.ts. A cast is compile-time only, so the
  // fields simply arrived undefined and RestaurantCard crashed on
  // `item.tags.map` as soon as the list loaded for real.
  const body = unwrap<Record<string, unknown>>(
    await api.get(`${BASE}`, {
      params: {
        q: params.q || undefined,
        cuisine: params.cuisine || undefined,
        sort: params.sort,
        promo: params.promo ? '1' : undefined,
        near_lat: params.nearLat,
        near_lng: params.nearLng,
        limit,
        offset,
      },
    }),
  );
  const items = mapRestaurants(body);
  // Fall back to the page itself when an older backend answers without totals,
  // rather than reporting 0 results next to a full list.
  const total = typeof body?.total === 'number' ? body.total : offset + items.length;
  return {
    items,
    total,
    limit,
    offset,
    hasMore: typeof body?.has_more === 'boolean' ? body.has_more : offset + items.length < total,
  };
}

export async function getRestaurant(id: string): Promise<RestaurantDetail> {
  if (USE_MOCK) {
    await delay(280);
    return mockRestaurantDetail(id);
  }
  // Same normalization, plus a shape change: Go answers
  // `{restaurant: {...}, categories: [...]}` while every screen here expects a
  // FLAT Restaurant carrying `menu`. The old cast left name/rating undefined and
  // `menu` missing outright, so the store page crashed the same way the list did.
  return mapRestaurantDetail(unwrap<unknown>(await api.get(`${BASE}/${encodeURIComponent(id)}`)));
}

// ─── Delivery quote ─────────────────────────────────────────────────────────
/**
 * Distance/time-based delivery-fee quote for a picked drop-off coordinate.
 * The price breakdown is SERVER-authoritative on placeOrder; this only powers
 * the pre-payment estimate. MOCK path mirrors the Go formula exactly via
 * computeDeliveryFeeMock (see deliveryFee.ts). Live path:
 * POST `${BASE}/:id/delivery-quote` { lat, lng }.
 */
export async function getDeliveryQuote(
  restaurantId: string,
  coords: { lat: number; lng: number },
): Promise<DeliveryQuote> {
  if (USE_MOCK) {
    await delay(220);
    const r = MOCK_RESTAURANTS.find((x) => x.id === restaurantId);
    // No restaurant location on record → fall back to the flat fee server-side.
    if (!r?.location) {
      return { delivery_fee_kobo: r?.deliveryFeeKobo ?? 0, flat_fallback: true };
    }
    const breakdown = computeDeliveryFeeMock(r.location, coords);
    return { delivery_fee_kobo: breakdown.total_kobo, flat_fallback: false, breakdown };
  }
  const res = await api.post(
    `${BASE}/${encodeURIComponent(restaurantId)}/delivery-quote`,
    { lat: coords.lat, lng: coords.lng },
  );
  return unwrap<DeliveryQuote>(res);
}

// ─── Orders ───────────────────────────────────────────────────────────────────
export async function getOrder(orderId: string): Promise<Order> {
  if (USE_MOCK) {
    await delay(220);
    return advanceMockOrder(orderId);
  }
  return mapOrder(unwrap<Order>(await api.get(`${BASE}/orders/${encodeURIComponent(orderId)}`)));
}

export async function listOrders(role: OrderRole): Promise<Order[]> {
  if (USE_MOCK) {
    await delay();
    return mockOrdersByRole(role);
  }
  // mapOrderList peels the `orders` envelope and turns a null — which is what a
  // merchant with no orders gets, alongside HTTP 200 — into an empty list, so the
  // screen shows its "No orders yet" state instead of an error.
  const res = await api.get(`${BASE}/orders`, { params: { role } });
  return mapOrderList(unwrap<unknown>(res)).map((o) => mapOrder(o as Order));
}

/** Place an order — money mutation → Idempotency-Key. Totals come from server. */
export async function placeOrder(req: PlaceOrderRequest): Promise<Order> {
  if (USE_MOCK) {
    await delay(900);
    const detail = mockRestaurantDetail(req.restaurantId);
    const flat = detail.menu.flatMap((c) => c.items);
    const items = req.items.map((line) => {
      const item = flat.find((m) => m.id === line.itemId);
      return {
        itemId: line.itemId,
        name: item?.name ?? 'Item',
        qty: line.qty,
        priceKobo: item?.priceKobo ?? 0,
      };
    });
    // Multi-restaurant: use the first item's restaurant_id if present, else fall back to req.restaurantId.
    const primaryRestId = req.items.find((i) => i.restaurantId)?.restaurantId || req.restaurantId;
    return makeOrder({
      restaurantId: primaryRestId,
      items,
      deliveryAddress: req.deliveryAddress,
      deliveryLocation: req.deliveryLocation ?? null,
    }, { packageCount: req.packageCount });
  }
  return mapOrder(
    unwrap<Order>(
      await api.post(
        `${BASE}/${encodeURIComponent(req.restaurantId)}/orders`,
        {
          items: req.items.map((i) => ({
            item_id: i.itemId,
            qty: i.qty,
            restaurant_id: i.restaurantId, // multi-restaurant support
          })),
          // Takeaway packaging is billed per physical package (the container).
          package_count: req.packageCount,
          packages: req.packages?.map((p) => ({ items: p.items.map((i) => ({ item_id: i.itemId, qty: i.qty })) })),
          delivery_address: req.deliveryAddress,
          delivery_location: req.deliveryLocation,
        },
        idemHeader(req.idempotencyKey),
      ),
    ),
  );
}

export async function setOrderStatus(
  restaurantId: string,
  orderId: string,
  status: OrderStatus,
): Promise<Order> {
  if (USE_MOCK) {
    await delay(420);
    return mockSetStatus(orderId, status);
  }
  return mapOrder(
    unwrap<Order>(
      await api.patch(
        `${BASE}/${encodeURIComponent(restaurantId)}/orders/${encodeURIComponent(orderId)}/status`,
        { status },
      ),
    ),
  );
}

/**
 * Owner re-dispatch — re-trigger the auto-dispatch search for a 'ready' order
 * that hasn't been picked up by a rider yet. POST `${BASE}/orders/:id/dispatch`.
 */
export async function redispatch(orderId: string): Promise<Order> {
  if (USE_MOCK) {
    await delay(420);
    return mockRedispatch(orderId);
  }
  return mapOrder(
    unwrap<Order>(await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/dispatch`, {})),
  );
}

export async function cancelOrder(restaurantId: string, orderId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(400);
    mockCancel(orderId);
    return;
  }
  await api.delete(
    `${BASE}/${encodeURIComponent(restaurantId)}/orders/${encodeURIComponent(orderId)}`,
  );
}

// ─── Ratings ──────────────────────────────────────────────────────────────────
export async function rateOrder(orderId: string, req: RateOrderRequest): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const o = mockStore.orders[orderId];
    if (o) o.rated = true;
    return;
  }
  await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/rate`, {
    restaurant_stars: req.restaurantStars,
    rider_stars: req.riderStars,
    comment: req.comment,
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export async function getMessages(orderId: string): Promise<ChatMessage[]> {
  if (USE_MOCK) {
    await delay(200);
    return mockMessages(orderId);
  }
  const raw = unwrap<
    {
      id: string;
      order_id: string;
      sender_role: ChatMessage['senderRole'];
      sender_name?: string;
      body: string;
      attachment_url?: string | null;
      created_at: string;
    }[]
  >(await api.get(`${BASE}/orders/${encodeURIComponent(orderId)}/messages`));
  return raw.map((m) => ({
    id: m.id,
    orderId: m.order_id,
    senderRole: m.sender_role,
    senderName: m.sender_name,
    body: m.body,
    attachmentUrl: m.attachment_url ?? null,
    createdAt: m.created_at,
  }));
}

export async function sendMessage(
  orderId: string,
  body: string,
  senderRole: ChatMessage['senderRole'] = 'customer',
  attachmentUrl?: string | null,
): Promise<ChatMessage> {
  if (USE_MOCK) {
    await delay(160);
    return pushMockMessage(orderId, senderRole, body, attachmentUrl);
  }
  const m = unwrap<{
    id: string;
    order_id: string;
    sender_role: ChatMessage['senderRole'];
    sender_name?: string;
    body: string;
    attachment_url?: string | null;
    created_at: string;
  }>(
    await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/messages`, {
      body,
      attachmentUrl,
    }),
  );
  return {
    id: m.id,
    orderId: m.order_id,
    senderRole: m.sender_role,
    senderName: m.sender_name,
    body: m.body,
    attachmentUrl: m.attachment_url ?? null,
    createdAt: m.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RIDER endpoints
// ═══════════════════════════════════════════════════════════════════════════════
export async function getRiderOffers(): Promise<RiderOffer[]> {
  if (USE_MOCK) {
    await delay(300);
    return mockRiderOffers();
  }
  const raw = unwrap<
    {
      order_id: string;
      restaurant_name: string;
      restaurant_location?: LatLng | null;
      delivery_address: string;
      delivery_location?: LatLng | null;
      payout_kobo: number;
      distance_meters?: number;
      item_count: number;
    }[]
  >(await api.get(`${BASE}/rider/offers`));
  return raw.map((o) => ({
    orderId: o.order_id,
    restaurantName: o.restaurant_name,
    restaurantLocation: o.restaurant_location ?? null,
    deliveryAddress: o.delivery_address,
    deliveryLocation: o.delivery_location ?? null,
    payoutKobo: o.payout_kobo,
    distanceMeters: o.distance_meters,
    itemCount: o.item_count,
  }));
}

export async function getRiderActive(): Promise<Order | null> {
  if (USE_MOCK) {
    await delay(260);
    const active = mockOrdersByRole('rider').find(
      (o) => o.status === 'assigned' || o.status === 'picked_up',
    );
    return active ? advanceMockOrder(active.id) : null;
  }
  const data = unwrap<Order | null>(await api.get(`${BASE}/rider/active`));
  return data ? mapOrder(data) : null;
}

export async function assignRider(orderId: string, idempotencyKey: string): Promise<Order> {
  if (USE_MOCK) {
    await delay(500);
    return mockAcceptOffer(orderId);
  }
  return mapOrder(
    unwrap<Order>(
      await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/assign`, {}, idemHeader(idempotencyKey)),
    ),
  );
}

export async function acceptOffer(orderId: string, idempotencyKey: string): Promise<Order> {
  if (USE_MOCK) {
    await delay(500);
    return mockAcceptOffer(orderId);
  }
  return mapOrder(
    unwrap<Order>(
      await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/accept`, {}, idemHeader(idempotencyKey)),
    ),
  );
}

/** Rider confirms pickup at the restaurant. POST `${BASE}/orders/:id/pickup`. */
export async function confirmPickup(orderId: string): Promise<Order> {
  if (USE_MOCK) {
    await delay(420);
    return mockConfirmPickup(orderId);
  }
  return mapOrder(unwrap<Order>(await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/pickup`, {})));
}

/**
 * Rider confirms handoff with the customer's delivery code — settles the order.
 * POST `${BASE}/orders/:id/handoff` { code }. An invalid code throws.
 */
export async function confirmHandoff(orderId: string, code: string): Promise<Order> {
  if (USE_MOCK) {
    await delay(500);
    return mockConfirmHandoff(orderId, code);
  }
  return mapOrder(
    unwrap<Order>(await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/handoff`, { code })),
  );
}

export async function postRiderLocation(orderId: string, loc: LatLng): Promise<void> {
  if (USE_MOCK) {
    await delay(120);
    const o = mockStore.orders[orderId];
    if (o?.rider) o.rider = { ...o.rider, location: loc };
    return;
  }
  await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/location`, {
    lat: loc.lat,
    lng: loc.lng,
  });
}

// ─── Cart Persistence ──────────────────────────────────────────────────────────

export interface SavedCart {
  restaurantId: string | null;
  restaurantName: string | null;
  packages: any[];
  activePackageId: string | null;
}

/** Save cart to server for cross-device persistence. */
export async function saveCartToServer(cart: SavedCart): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    return; // mock always succeeds
  }
  try {
    await api.post('/api/v1/food/cart', cart);
  } catch (err) {
    console.warn('Failed to save cart to server:', err);
    // Silently fail — local storage is the primary persistence
  }
}

/** Load cart from server (for cross-device sync). */
export async function loadCartFromServer(): Promise<SavedCart | null> {
  if (USE_MOCK) {
    await delay(200);
    return null; // no cart on mock
  }
  try {
    const res = await api.get('/api/v1/food/cart');
    return res.data?.data || null;
  } catch (err) {
    console.warn('Failed to load cart from server:', err);
    return null; // fallback to local storage
  }
}
