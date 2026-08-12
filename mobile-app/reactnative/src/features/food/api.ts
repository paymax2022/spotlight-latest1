// ── Restaurant & Delivery — API wrapper ──────────────────────────────────────
// Typed data layer the food screens code against. Mirrors parcel.api.ts:
// mock-flagged, shared axios `api` client, BASE = '/api/v1/restaurant',
// Idempotency-Key on money mutations. Flip EXPO_PUBLIC_FOOD_USE_MOCK=false (or
// EXPO_PUBLIC_RESTAURANT_USE_MOCK) once the Go endpoints are reachable.
//
// IRON RULES: all money is integer kobo; placing an order carries an
// Idempotency-Key; price breakdowns come from the SERVER — never computed here.

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
import { computeDeliveryFeeMock, type DeliveryQuote } from './deliveryFee';
export type { DeliveryQuote, DeliveryFeeBreakdown } from './deliveryFee';

export const USE_MOCK =
  (process.env.EXPO_PUBLIC_FOOD_USE_MOCK ??
    process.env.EXPO_PUBLIC_RESTAURANT_USE_MOCK ??
    'true').toLowerCase() !== 'false';

const BASE = '/api/v1/restaurant';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

/**
 * Backfill the order's dispatch fields from the backend's snake_case payload.
 * The API otherwise returns the camelCase Order shape; this only normalizes the
 * newer auto-dispatch fields (`dispatch_status`, `delivery_code`, `rider_id`).
 */
function mapOrder(raw: Order): Order {
  const r = raw as Order & Record<string, unknown>;
  return {
    ...raw,
    dispatchStatus:
      (r.dispatchStatus ?? (r['dispatch_status'] as Order['dispatchStatus'])) ?? undefined,
    deliveryCode: (r.deliveryCode ?? (r['delivery_code'] as string | null)) ?? null,
    riderId: (r.riderId ?? (r['rider_id'] as string | null)) ?? null,
  };
}

// ─── Discovery ────────────────────────────────────────────────────────────────
export async function listRestaurants(): Promise<Restaurant[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_RESTAURANTS;
  }
  // The Go discovery handler answers `{"restaurants": [...]}` (handler_delivery.go
  // ListRestaurants) and the Next proxy forwards the body VERBATIM, so `unwrap`
  // — which only peels a `data` envelope — hands back that OBJECT rather than an
  // array. Every caller then does .filter/.map on it and throws. Peel the
  // `restaurants` key here, tolerating a bare array in case the handler is ever
  // flattened.
  const raw = unwrap<Restaurant[] | { restaurants?: Restaurant[] }>(await api.get(`${BASE}`));
  return Array.isArray(raw) ? raw : raw?.restaurants ?? [];
}

export async function getRestaurant(id: string): Promise<RestaurantDetail> {
  if (USE_MOCK) {
    await delay(280);
    return mockRestaurantDetail(id);
  }
  return unwrap<RestaurantDetail>(await api.get(`${BASE}/${encodeURIComponent(id)}`));
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
  return unwrap<Order[]>(await api.get(`${BASE}/orders`, { params: { role } })).map(mapOrder);
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
