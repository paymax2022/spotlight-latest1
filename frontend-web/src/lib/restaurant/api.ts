'use client';

import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';
import type {
  DeliveryQuote,
  Order,
  OrderRating,
  PlaceOrderRequest,
  RateOrderRequest,
  RestaurantDetail,
  RestaurantPage,
  RestaurantPaystackIntent,
  RestaurantPaystackStatus,
} from '@/src/types/restaurant';

export class RestaurantApiError extends Error {}

function buildIdempotencyKey(scope: string, seed: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `RESTAURANT-${scope}-${Date.now()}-${seed.replace(/\W/g, '').slice(-6)}-${random}`;
}

// Shared response envelope: every route in this module returns either the
// bare Go JSON on success, or `{ success: false, error }` on failure (the
// Next proxy forwards Go's status/body verbatim; Next's own gate failures —
// feature flag off, unauthenticated — use the same `{success:false,error}`
// shape via errorResponse/handleApiError). A 401 redirects to login instead
// of surfacing an error, matching every other module in this app.
async function parse<T>(response: Response, redirectPath: string): Promise<T | null> {
  if (isUnauthorized(response)) {
    redirectToLogin(redirectPath);
    return null;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new RestaurantApiError(String(payload?.error || 'Restaurant request failed.'));
  }
  return payload as T;
}

export async function listRestaurants(params: {
  q?: string;
  cuisine?: string;
  sort?: 'newest' | 'rating' | 'name' | 'eta' | 'distance' | 'likes';
  promo?: boolean;
  featured?: boolean;
  near_lat?: number;
  near_lng?: number;
  min_price?: number;
  max_price?: number;
  limit?: number;
  offset?: number;
}): Promise<RestaurantPage | null> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  const response = await authFetch(`/api/v1/restaurant${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  return parse<RestaurantPage>(response, '/restaurant');
}

export async function getRestaurant(id: string): Promise<RestaurantDetail | null> {
  const response = await authFetch(`/api/v1/restaurant/${id}`, { cache: 'no-store' });
  return parse<RestaurantDetail>(response, `/restaurant/${id}`);
}

export async function toggleLike(id: string, liked: boolean): Promise<{ liked: boolean } | null> {
  const response = await authFetch(`/api/v1/restaurant/${id}/like`, { method: liked ? 'DELETE' : 'POST' });
  return parse<{ liked: boolean }>(response, `/restaurant/${id}`);
}

export async function quoteDelivery(id: string, lat: number, lng: number): Promise<DeliveryQuote | null> {
  const response = await authFetch(`/api/v1/restaurant/${id}/delivery-quote`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  }, { json: true });
  return parse<DeliveryQuote>(response, `/restaurant/${id}`);
}

export async function placeOrder(restaurantId: string, body: PlaceOrderRequest): Promise<Order | null> {
  const response = await authFetch(`/api/v1/restaurant/${restaurantId}/orders`, {
    method: 'POST',
    headers: { 'Idempotency-Key': buildIdempotencyKey('order', restaurantId) },
    body: JSON.stringify(body),
  }, { json: true });
  return parse<Order>(response, `/restaurant/${restaurantId}`);
}

// The paystackcheckout Go package is a separate subsystem from the rest of
// this module — it wraps its payload in `{ data: ... }` and its errors as
// `{ error: "code", message: "human text" }`, not this app's usual
// `{ success: false, error }` shape. Handled separately from `parse()`.
async function parseDataEnvelope<T>(response: Response, redirectPath: string): Promise<T | null> {
  if (isUnauthorized(response)) {
    redirectToLogin(redirectPath);
    return null;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RestaurantApiError(String(payload?.message || payload?.error || 'Restaurant request failed.'));
  }
  return (payload?.data ?? null) as T;
}

export async function initiatePaystackOrder(restaurantId: string, body: PlaceOrderRequest & { email?: string; callback_url?: string }): Promise<RestaurantPaystackIntent | null> {
  const response = await authFetch(`/api/v1/restaurant/${restaurantId}/orders/paystack/initiate`, {
    method: 'POST',
    headers: { 'Idempotency-Key': buildIdempotencyKey('paystack', restaurantId) },
    body: JSON.stringify(body),
  }, { json: true });
  return parseDataEnvelope<RestaurantPaystackIntent>(response, `/restaurant/${restaurantId}`);
}

export async function getPaystackOrderStatus(reference: string): Promise<RestaurantPaystackStatus | null> {
  const response = await authFetch(`/api/v1/restaurant/orders/paystack/${reference}/status`, { cache: 'no-store' });
  return parseDataEnvelope<RestaurantPaystackStatus>(response, '/restaurant/orders');
}

export async function listMyOrders(): Promise<Order[]> {
  const response = await authFetch('/api/v1/restaurant/orders?role=customer', { cache: 'no-store' });
  const payload = await parse<{ orders: Order[] | null }>(response, '/restaurant/orders');
  return payload?.orders ?? [];
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const response = await authFetch(`/api/v1/restaurant/orders/${orderId}`, { cache: 'no-store' });
  return parse<Order>(response, `/restaurant/orders/${orderId}`);
}

export async function cancelOrder(restaurantId: string, orderId: string): Promise<void> {
  const response = await authFetch(`/api/v1/restaurant/${restaurantId}/orders/${orderId}`, { method: 'DELETE' });
  await parse<{ ok: boolean }>(response, `/restaurant/orders/${orderId}`);
}

export async function rateOrder(orderId: string, body: RateOrderRequest): Promise<OrderRating | null> {
  const response = await authFetch(`/api/v1/restaurant/orders/${orderId}/rate`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, { json: true });
  return parse<OrderRating>(response, `/restaurant/orders/${orderId}`);
}
