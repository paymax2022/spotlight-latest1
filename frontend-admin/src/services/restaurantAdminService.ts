// ── Admin — Restaurant & Delivery service ───────────────────────────────────
// Read-only monitoring console. Talks to the Go backend (Gin) under
// /api/finance/restaurant. Mock-flagged for dev: flip with
// NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false to hit the live endpoints.
//
// NOTE: The backend does not (yet) expose an admin-wide order list. It exposes
// `GET /restaurant` (list restaurants) and a role-scoped `GET /restaurant/orders`.
// For admin monitoring we list restaurants, then aggregate orders. If a global
// order feed becomes available, point listOrders() at it and drop the per-
// restaurant fan-out below.

import { env } from '@/config/env';
import type { Order, OrderStatus, Restaurant } from '@/types/restaurantAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function base(): string {
  // env.apiBaseUrl already ends with /api/v1; the restaurant module is mounted
  // under /api/finance/restaurant. We strip the trailing /api/v1 segment so the
  // module path is reachable regardless of how apiBaseUrl is configured.
  const root = env.apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${root}/api/finance/restaurant`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, { ...init, headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}

// ─── Mock datasets ────────────────────────────────────────────────────────────

const MOCK_RESTAURANTS: Restaurant[] = [
  { id: 'r1', owner_id: 'u-7001', name: 'Mama Put Express', cuisine: 'Nigerian', address: '12 Awolowo Rd, Ikoyi', phone: '+2348010000001', is_open: true, rating: 4.6, rating_count: 318, created_at: new Date(Date.now() - 86400000 * 40).toISOString() },
  { id: 'r2', owner_id: 'u-7002', name: 'Suya Spot GRA', cuisine: 'Grill', address: '5 Gana St, Maitama', phone: '+2348010000002', is_open: true, rating: 4.3, rating_count: 142, created_at: new Date(Date.now() - 86400000 * 22).toISOString() },
  { id: 'r3', owner_id: 'u-7003', name: 'Pasta & Co', cuisine: 'Italian', address: '8 Admiralty Way, Lekki', phone: '+2348010000003', is_open: false, rating: 4.1, rating_count: 56, created_at: new Date(Date.now() - 86400000 * 9).toISOString() },
];

const MOCK_ORDERS: Order[] = [
  { id: 'o1', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', customer_id: 'u-1842', rider_id: 'rd-12', status: 'delivered', items: [{ item_id: 'i1', name: 'Jollof + Chicken', unit_price_kobo: 350_000, quantity: 2 }], subtotal_kobo: 700_000, delivery_fee_kobo: 120_000, service_fee_kobo: 35_000, total_kobo: 855_000, delivery_address: '3 Glover Rd, Ikoyi', created_at: new Date(Date.now() - 7200000).toISOString(), updated_at: new Date(Date.now() - 5400000).toISOString() },
  { id: 'o2', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', customer_id: 'u-2210', rider_id: null, status: 'preparing', items: [{ item_id: 'i2', name: 'Beef Suya (large)', unit_price_kobo: 250_000, quantity: 3 }], subtotal_kobo: 750_000, delivery_fee_kobo: 150_000, service_fee_kobo: 37_500, total_kobo: 937_500, delivery_address: '20 Aguiyi Ironsi, Maitama', created_at: new Date(Date.now() - 1800000).toISOString(), updated_at: new Date(Date.now() - 600000).toISOString() },
  { id: 'o3', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', customer_id: 'u-3098', rider_id: 'rd-8', status: 'picked_up', items: [{ item_id: 'i3', name: 'Egusi + Pounded Yam', unit_price_kobo: 420_000, quantity: 1 }], subtotal_kobo: 420_000, delivery_fee_kobo: 130_000, service_fee_kobo: 21_000, total_kobo: 571_000, delivery_address: '14 Bourdillon, Ikoyi', created_at: new Date(Date.now() - 2400000).toISOString(), updated_at: new Date(Date.now() - 300000).toISOString() },
  { id: 'o4', restaurant_id: 'r3', restaurant_name: 'Pasta & Co', customer_id: 'u-4412', rider_id: null, status: 'cancelled', items: [{ item_id: 'i4', name: 'Carbonara', unit_price_kobo: 550_000, quantity: 1 }], subtotal_kobo: 550_000, delivery_fee_kobo: 140_000, service_fee_kobo: 27_500, total_kobo: 717_500, delivery_address: '8 Admiralty Way, Lekki', created_at: new Date(Date.now() - 9600000).toISOString(), updated_at: new Date(Date.now() - 9000000).toISOString() },
  { id: 'o5', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', customer_id: 'u-5521', rider_id: null, status: 'no_rider', items: [{ item_id: 'i5', name: 'Chicken Suya', unit_price_kobo: 300_000, quantity: 2 }], subtotal_kobo: 600_000, delivery_fee_kobo: 160_000, service_fee_kobo: 30_000, total_kobo: 790_000, delivery_address: '2 IBB Way, Maitama', created_at: new Date(Date.now() - 3000000).toISOString(), updated_at: new Date(Date.now() - 2700000).toISOString() },
];

// ─── API ──────────────────────────────────────────────────────────────────────

export async function listRestaurants(): Promise<Restaurant[]> {
  if (USE_MOCK) { await delay(); return MOCK_RESTAURANTS; }
  return req<Restaurant[]>('/');
}

// Admin order monitoring. There is no admin-wide order feed on the backend yet,
// so when not mocking we fan out across restaurants using the role-scoped
// `GET /restaurant/orders?role=restaurant` view per restaurant. Replace with a
// single global endpoint when one exists.
export async function listOrders(status?: OrderStatus | ''): Promise<Order[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_ORDERS.filter((o) => o.status === status) : MOCK_ORDERS;
  }
  const qs = new URLSearchParams({ role: 'restaurant' });
  if (status) qs.set('status', status);
  return req<Order[]>(`/orders?${qs.toString()}`);
}
