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
import type {
  Order,
  OrderStatus,
  Restaurant,
  Rider,
  DispatchOrder,
  RestaurantApplication,
  OnboardingStatus,
  PayoutRun,
  PayoutLine,
  PayeeType,
  OrderDispute,
  DisputeStatus,
  ResolveDisputeRequest,
  RestaurantDetail,
  MenuCategory,
  MenuItem,
  UpdateRestaurantRequest,
  CreateMenuItemRequest,
  UpdateMenuItemRequest,
} from '@/types/restaurantAdmin';

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
  // No trailing slash: the Go route is registered as "" on the /restaurant group,
  // so `/` produced `/api/finance/restaurant/` and relied on Gin's
  // RedirectTrailingSlash 301 to land.
  //
  // The handler answers `{"restaurants": [...]}`; req() only peels a `data`
  // envelope, so without this the page received an object and .map'd over it.
  const raw = await req<Restaurant[] | { restaurants?: Restaurant[] }>('');
  return Array.isArray(raw) ? raw : raw?.restaurants ?? [];
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

// ═════════════════════════════════════════════════════════════════════════════
// OPS-CONSOLE EXTENSIONS
//
// Backend reality (see backend/internal/app/finance_routes.go §"Restaurant &
// Delivery routes"): the restaurant module mounts member/rider/owner routes on
// `/api/finance/restaurant/*` and a single admin surface `/api/restaurant/admin/
// delivery-config` (RBAC restaurant.admin.pricing). There is NOT yet a
// dedicated admin dispatch/onboarding/payouts/refunds surface. The functions
// below are MOCK-FIRST: they render the ops UI today and, when
// NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false, call the CONSUMED live routes
// that already exist (rider lifecycle, dispute resolve) and the TARGET admin
// routes an orchestrator should land. Each live path is annotated below.
//
// Consumed today (already live):
//   POST /api/finance/restaurant/orders/:orderId/assign    (manual rider offer)
//   POST /api/finance/restaurant/orders/:orderId/dispatch  (re-run auto-dispatch)
//   GET  /api/finance/restaurant/rider/active              (rider active order)
//   POST /api/finance/admin/disputes/:id/resolve           (adminNote + resolution)
//   GET  /api/finance/disputes                             (dispute list)
// Target admin routes (to add server-side; slugs proposed in the report):
//   GET  /api/restaurant/admin/riders           restaurant.admin.dispatch
//   GET  /api/restaurant/admin/dispatch/queue   restaurant.admin.dispatch
//   GET  /api/restaurant/admin/onboarding       restaurant.admin.onboarding
//   POST /api/restaurant/admin/onboarding/:id/approve|reject  restaurant.admin.onboarding
//   GET  /api/restaurant/admin/payouts          restaurant.admin.payouts
//   POST /api/restaurant/admin/payouts/:id/process  restaurant.admin.payouts
// ═════════════════════════════════════════════════════════════════════════════

// The restaurant module root is /api/finance/restaurant (used for the CONSUMED
// live rider-lifecycle + dispute routes). The proposed admin surface hangs off
// /api/restaurant/admin (same root as the live delivery-config console).
function adminBase(): string {
  const root = env.apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${root}/api/restaurant/admin`;
}
function financeBase(): string {
  const root = env.apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${root}/api/finance`;
}

async function reqAt<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}

// ── Store & menu management (restaurant.manage) ──────────────────────────────
//
// Backed by /api/restaurant/admin/restaurants/* — operator-scoped mirrors of the
// owner-only member routes. The member routes enforce ownership
// (Service.assertOwner) with no operator exemption, so the console MUST use these
// or every mutation 403s. See backend/internal/restaurant/handler_admin_store.go.

function storeBase(): string {
  return `${adminBase()}/restaurants`;
}

const MOCK_MENU: MenuCategory[] = [
  {
    id: 'c-1', restaurant_id: 'r1', name: 'Soups',
    items: [
      { id: 'i-1', category_id: 'c-1', restaurant_id: 'r1', name: 'Egusi Soup', description: 'Melon seed soup', price_kobo: 350_000, is_available: true, dietary_tags: [] },
      { id: 'i-2', category_id: 'c-1', restaurant_id: 'r1', name: 'Afang Soup', description: 'With periwinkle', price_kobo: 380_000, is_available: false, dietary_tags: [] },
    ],
  },
  {
    id: 'c-2', restaurant_id: 'r1', name: 'Rice',
    items: [
      { id: 'i-3', category_id: 'c-2', restaurant_id: 'r1', name: 'Jollof Rice', description: 'Smoky party jollof', price_kobo: 250_000, is_available: true, dietary_tags: [] },
    ],
  },
];

export async function getRestaurantDetail(id: string): Promise<RestaurantDetail> {
  if (USE_MOCK) {
    await delay();
    const r = MOCK_RESTAURANTS.find((x) => x.id === id) ?? MOCK_RESTAURANTS[0];
    return { restaurant: r, categories: MOCK_MENU };
  }
  return reqAt<RestaurantDetail>(`${storeBase()}/${encodeURIComponent(id)}`);
}

export async function updateRestaurant(id: string, patch: UpdateRestaurantRequest): Promise<Restaurant> {
  if (USE_MOCK) {
    await delay();
    const r = MOCK_RESTAURANTS.find((x) => x.id === id)!;
    Object.assign(r, patch);
    return r;
  }
  return reqAt<Restaurant>(`${storeBase()}/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}

/** Operator force-open / force-close. */
export async function setRestaurantAvailability(id: string, isOpen: boolean): Promise<Restaurant> {
  if (USE_MOCK) {
    await delay();
    const r = MOCK_RESTAURANTS.find((x) => x.id === id)!;
    r.is_open = isOpen;
    return r;
  }
  return reqAt<Restaurant>(`${storeBase()}/${encodeURIComponent(id)}/availability`, {
    method: 'PATCH', body: JSON.stringify({ is_open: isOpen }),
  });
}

export async function createMenuCategory(restaurantId: string, name: string): Promise<MenuCategory> {
  if (USE_MOCK) {
    await delay();
    const c: MenuCategory = { id: `c-${MOCK_MENU.length + 1}`, restaurant_id: restaurantId, name, items: [] };
    MOCK_MENU.push(c);
    return c;
  }
  return reqAt<MenuCategory>(`${storeBase()}/${encodeURIComponent(restaurantId)}/menu/categories`, {
    method: 'POST', body: JSON.stringify({ name }),
  });
}

export async function deleteMenuCategory(restaurantId: string, categoryId: string): Promise<void> {
  if (USE_MOCK) {
    await delay();
    const i = MOCK_MENU.findIndex((c) => c.id === categoryId);
    if (i >= 0) MOCK_MENU.splice(i, 1);
    return;
  }
  await reqAt<{ deleted: boolean }>(
    `${storeBase()}/${encodeURIComponent(restaurantId)}/menu/categories/${encodeURIComponent(categoryId)}`,
    { method: 'DELETE' },
  );
}

export async function createMenuItem(restaurantId: string, req: CreateMenuItemRequest): Promise<MenuItem> {
  if (USE_MOCK) {
    await delay();
    const it: MenuItem = { id: `i-mock-${req.name}`, restaurant_id: restaurantId, is_available: true, ...req };
    MOCK_MENU.find((c) => c.id === req.category_id)?.items?.push(it);
    return it;
  }
  return reqAt<MenuItem>(`${storeBase()}/${encodeURIComponent(restaurantId)}/menu/items`, {
    method: 'POST', body: JSON.stringify(req),
  });
}

export async function updateMenuItem(
  restaurantId: string, itemId: string, patch: UpdateMenuItemRequest,
): Promise<MenuItem> {
  if (USE_MOCK) {
    await delay();
    for (const c of MOCK_MENU) {
      const it = c.items?.find((x) => x.id === itemId);
      if (it) { Object.assign(it, patch); return it; }
    }
    throw new Error('item not found');
  }
  return reqAt<MenuItem>(
    `${storeBase()}/${encodeURIComponent(restaurantId)}/menu/items/${encodeURIComponent(itemId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function deleteMenuItem(restaurantId: string, itemId: string): Promise<void> {
  if (USE_MOCK) {
    await delay();
    for (const c of MOCK_MENU) {
      const i = c.items?.findIndex((x) => x.id === itemId) ?? -1;
      if (i >= 0) { c.items!.splice(i, 1); return; }
    }
    return;
  }
  await reqAt<{ deleted: boolean }>(
    `${storeBase()}/${encodeURIComponent(restaurantId)}/menu/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  );
}

// ── Rider dispatch board ─────────────────────────────────────────────────────

const MOCK_RIDERS: Rider[] = [
  { id: 'rd-8', name: 'Chidi O.', phone: '+2348030000008', vehicle: 'bike', status: 'on_delivery', active_order_id: 'o3', zone: 'Ikoyi', rating: 4.7, deliveries_today: 6, last_seen_at: new Date(Date.now() - 60_000).toISOString(), lat: 6.452, lng: 3.436 },
  { id: 'rd-12', name: 'Ngozi A.', phone: '+2348030000012', vehicle: 'bike', status: 'available', active_order_id: null, zone: 'Ikoyi', rating: 4.9, deliveries_today: 9, last_seen_at: new Date(Date.now() - 30_000).toISOString(), lat: 6.448, lng: 3.430 },
  { id: 'rd-15', name: 'Emeka U.', phone: '+2348030000015', vehicle: 'car', status: 'available', active_order_id: null, zone: 'Maitama', rating: 4.5, deliveries_today: 4, last_seen_at: new Date(Date.now() - 120_000).toISOString(), lat: 9.086, lng: 7.501 },
  { id: 'rd-21', name: 'Bisi K.', phone: '+2348030000021', vehicle: 'bike', status: 'offline', active_order_id: null, zone: 'Lekki', rating: 4.2, deliveries_today: 0, last_seen_at: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'rd-30', name: 'Tunde F.', phone: '+2348030000030', vehicle: 'bike', status: 'suspended', active_order_id: null, zone: 'Maitama', rating: 3.4, deliveries_today: 0, last_seen_at: new Date(Date.now() - 86_400_000).toISOString() },
];

const MOCK_DISPATCH: DispatchOrder[] = [
  { id: 'o3', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', status: 'picked_up', rider_id: 'rd-8', rider_name: 'Chidi O.', delivery_address: '14 Bourdillon, Ikoyi', total_kobo: 571_000, delivery_fee_kobo: 130_000, ready_at: new Date(Date.now() - 900_000).toISOString(), created_at: new Date(Date.now() - 2_400_000).toISOString(), waiting_minutes: 0 },
  { id: 'o5', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', status: 'no_rider', rider_id: null, rider_name: null, delivery_address: '2 IBB Way, Maitama', total_kobo: 790_000, delivery_fee_kobo: 160_000, ready_at: new Date(Date.now() - 1_500_000).toISOString(), created_at: new Date(Date.now() - 3_000_000).toISOString(), waiting_minutes: 25 },
  { id: 'o7', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', status: 'ready', rider_id: null, rider_name: null, delivery_address: '9 Kingsway Rd, Ikoyi', total_kobo: 420_000, delivery_fee_kobo: 120_000, ready_at: new Date(Date.now() - 240_000).toISOString(), created_at: new Date(Date.now() - 1_200_000).toISOString(), waiting_minutes: 4 },
];

export async function listRiders(): Promise<Rider[]> {
  if (USE_MOCK) { await delay(); return MOCK_RIDERS; }
  // TARGET: GET /api/restaurant/admin/riders (restaurant.admin.dispatch)
  return reqAt<Rider[]>(`${adminBase()}/riders`);
}

export async function listDispatchQueue(): Promise<DispatchOrder[]> {
  if (USE_MOCK) { await delay(); return MOCK_DISPATCH; }
  // TARGET: GET /api/restaurant/admin/dispatch/queue (restaurant.admin.dispatch)
  return reqAt<DispatchOrder[]>(`${adminBase()}/dispatch/queue`);
}

// Manually assign/offer an order to a specific rider. Targets the live admin
// dispatch route POST /api/restaurant/admin/orders/:id/assign (body {rider_id}),
// which returns {ok:true}.
export async function assignRider(orderId: string, riderId: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    const d = MOCK_DISPATCH.find((o) => o.id === orderId);
    const r = MOCK_RIDERS.find((x) => x.id === riderId);
    if (d && r) { d.rider_id = riderId; d.rider_name = r.name; d.status = 'assigned'; r.status = 'on_delivery'; r.active_order_id = orderId; }
    return { ok: true };
  }
  // TARGET: POST /api/restaurant/admin/orders/:id/assign (restaurant.admin.dispatch)
  return reqAt<{ ok: true }>(`${adminBase()}/orders/${orderId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ rider_id: riderId }),
  });
}

// Re-run automatic dispatch for a stuck (no_rider) order. CONSUMES the live
// POST /api/finance/restaurant/orders/:orderId/dispatch route.
export async function redispatchOrder(orderId: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    const d = MOCK_DISPATCH.find((o) => o.id === orderId);
    if (d) { d.status = 'ready'; d.waiting_minutes = 0; }
    return { ok: true };
  }
  return reqAt<{ ok: true }>(`${base()}/orders/${orderId}/dispatch`, { method: 'POST' });
}

// ── Restaurant onboarding / KYC review queue ─────────────────────────────────

const MOCK_APPLICATIONS: RestaurantApplication[] = [
  { id: 'app-1', restaurant_name: 'Ofada Republic', owner_id: 'u-9001', owner_name: 'Adaeze N.', email: 'adaeze@ofada.ng', phone: '+2348040000001', cuisine: 'Nigerian', address: '4 Isaac John, Ikeja GRA', cac_number: 'RC-1849221', bank_account_name: 'Ofada Republic Ltd', bank_account_number: '0123456789', bank_name: 'GTBank', documents: [{ kind: 'cac', label: 'CAC certificate', url: '#', verified: true }, { kind: 'food_permit', label: 'NAFDAC food permit', url: '#' }, { kind: 'id', label: "Owner's NIN", url: '#', verified: true }, { kind: 'bank_proof', label: 'Bank statement', url: '#' }], status: 'pending', submitted_at: new Date(Date.now() - 86_400_000 * 2).toISOString() },
  { id: 'app-2', restaurant_name: 'Shawarma King', owner_id: 'u-9002', owner_name: 'Yusuf B.', email: 'yusuf@shawarmaking.ng', phone: '+2348040000002', cuisine: 'Middle Eastern', address: '11 Allen Ave, Ikeja', cac_number: 'RC-2201933', bank_account_name: 'Shawarma King Ent', bank_account_number: '2233445566', bank_name: 'Access', documents: [{ kind: 'cac', label: 'CAC certificate', url: '#' }, { kind: 'menu', label: 'Menu & pricing', url: '#' }], status: 'in_review', submitted_at: new Date(Date.now() - 86_400_000 * 5).toISOString(), reviewer_id: 'admin-77' },
  { id: 'app-3', restaurant_name: 'Green Bowl', owner_id: 'u-9003', owner_name: 'Femi T.', email: 'femi@greenbowl.ng', phone: '+2348040000003', cuisine: 'Healthy', address: '2 Admiralty, Lekki', cac_number: 'RC-3390011', bank_account_name: 'Green Bowl Foods', bank_account_number: '9988776655', bank_name: 'Zenith', documents: [{ kind: 'cac', label: 'CAC certificate', url: '#', verified: true }, { kind: 'food_permit', label: 'NAFDAC food permit', url: '#', verified: true }, { kind: 'id', label: "Owner's NIN", url: '#', verified: true }, { kind: 'bank_proof', label: 'Bank statement', url: '#', verified: true }], status: 'approved', submitted_at: new Date(Date.now() - 86_400_000 * 12).toISOString(), reviewed_at: new Date(Date.now() - 86_400_000 * 10).toISOString(), reviewer_id: 'admin-77', review_note: 'All docs verified.' },
  { id: 'app-4', restaurant_name: 'Quick Bites Unverified', owner_id: 'u-9004', owner_name: 'Ola D.', email: 'ola@quickbites.ng', phone: '+2348040000004', cuisine: 'Fast food', address: '7 Opebi, Ikeja', documents: [{ kind: 'id', label: "Owner's ID", url: '#' }], status: 'rejected', submitted_at: new Date(Date.now() - 86_400_000 * 8).toISOString(), reviewed_at: new Date(Date.now() - 86_400_000 * 7).toISOString(), reviewer_id: 'admin-77', review_note: 'Missing CAC and food permit; resubmit with full KYC.' },
];

export async function listApplications(status?: OnboardingStatus | ''): Promise<RestaurantApplication[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_APPLICATIONS.filter((a) => a.status === status) : MOCK_APPLICATIONS;
  }
  const qs = status ? `?status=${status}` : '';
  // TARGET: GET /api/restaurant/admin/onboarding (restaurant.admin.onboarding)
  return reqAt<RestaurantApplication[]>(`${adminBase()}/onboarding${qs}`);
}

// Approve/reject a merchant application. Reviewer note required on reject.
export async function decideApplication(
  id: string,
  decision: 'approve' | 'reject',
  note: string,
): Promise<{ ok: true }> {
  if (decision === 'reject' && !note.trim()) throw new Error('A reviewer note is required to reject.');
  if (USE_MOCK) {
    await delay();
    const a = MOCK_APPLICATIONS.find((x) => x.id === id);
    if (a) {
      a.status = decision === 'approve' ? 'approved' : 'rejected';
      a.reviewed_at = new Date().toISOString();
      a.review_note = note.trim() || null;
    }
    return { ok: true };
  }
  // TARGET: POST /api/restaurant/admin/onboarding/:id/{approve|reject}
  return reqAt<{ ok: true }>(`${adminBase()}/onboarding/${id}/${decision}`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

// ── Payout runs (restaurant + rider) ─────────────────────────────────────────

const MOCK_PAYOUT_RUNS: PayoutRun[] = [
  { id: 'pr-r-2026w27', payee_type: 'restaurant', period_start: '2026-06-29', period_end: '2026-07-05', status: 'paid', lines_count: 3, total_net_kobo: 4_820_000, created_at: new Date(Date.now() - 86_400_000 * 4).toISOString(), processed_at: new Date(Date.now() - 86_400_000 * 3).toISOString(), ledger_settled_kobo: 4_820_000, reconciled: true },
  { id: 'pr-rd-2026w27', payee_type: 'rider', period_start: '2026-06-29', period_end: '2026-07-05', status: 'paid', lines_count: 5, total_net_kobo: 1_240_000, created_at: new Date(Date.now() - 86_400_000 * 4).toISOString(), processed_at: new Date(Date.now() - 86_400_000 * 3).toISOString(), ledger_settled_kobo: 1_240_000, reconciled: true },
  { id: 'pr-r-2026w28', payee_type: 'restaurant', period_start: '2026-07-06', period_end: '2026-07-12', status: 'pending', lines_count: 3, total_net_kobo: 5_115_000, created_at: new Date(Date.now() - 3_600_000).toISOString(), ledger_settled_kobo: 5_200_000, reconciled: false },
  { id: 'pr-rd-2026w28', payee_type: 'rider', period_start: '2026-07-06', period_end: '2026-07-12', status: 'pending', lines_count: 4, total_net_kobo: 980_000, created_at: new Date(Date.now() - 3_600_000).toISOString(), ledger_settled_kobo: 980_000, reconciled: true },
];

const MOCK_PAYOUT_LINES: Record<string, PayoutLine[]> = {
  'pr-r-2026w28': [
    { id: 'pl-1', payee_id: 'r1', payee_name: 'Mama Put Express', payee_type: 'restaurant', orders_count: 42, gross_kobo: 3_150_000, fees_kobo: 472_500, net_kobo: 2_677_500, bank_account: 'GTBank ••• 6789', status: 'pending' },
    { id: 'pl-2', payee_id: 'r2', payee_name: 'Suya Spot GRA', payee_type: 'restaurant', orders_count: 28, gross_kobo: 1_960_000, fees_kobo: 294_000, net_kobo: 1_666_000, bank_account: 'Access ••• 5566', status: 'pending' },
    { id: 'pl-3', payee_id: 'r3', payee_name: 'Pasta & Co', payee_type: 'restaurant', orders_count: 12, gross_kobo: 907_500, fees_kobo: 136_000, net_kobo: 771_500, bank_account: 'Zenith ••• 6655', status: 'pending' },
  ],
  'pr-rd-2026w28': [
    { id: 'pl-4', payee_id: 'rd-8', payee_name: 'Chidi O.', payee_type: 'rider', orders_count: 34, gross_kobo: 442_000, fees_kobo: 0, net_kobo: 442_000, bank_account: 'Kuda ••• 1122', status: 'pending' },
    { id: 'pl-5', payee_id: 'rd-12', payee_name: 'Ngozi A.', payee_type: 'rider', orders_count: 29, gross_kobo: 377_000, fees_kobo: 0, net_kobo: 377_000, bank_account: 'Opay ••• 3344', status: 'pending' },
    { id: 'pl-6', payee_id: 'rd-15', payee_name: 'Emeka U.', payee_type: 'rider', orders_count: 11, gross_kobo: 161_000, fees_kobo: 0, net_kobo: 161_000, bank_account: 'GTBank ••• 5566', status: 'pending' },
  ],
};

export async function listPayoutRuns(payeeType?: PayeeType | ''): Promise<PayoutRun[]> {
  if (USE_MOCK) {
    await delay();
    return payeeType ? MOCK_PAYOUT_RUNS.filter((p) => p.payee_type === payeeType) : MOCK_PAYOUT_RUNS;
  }
  const qs = payeeType ? `?payee_type=${payeeType}` : '';
  // TARGET: GET /api/restaurant/admin/payouts (restaurant.admin.payouts)
  return reqAt<PayoutRun[]>(`${adminBase()}/payouts${qs}`);
}

export async function getPayoutLines(runId: string): Promise<PayoutLine[]> {
  if (USE_MOCK) { await delay(); return MOCK_PAYOUT_LINES[runId] ?? []; }
  // There is no /payouts/:id/lines route — that path 404'd. Lines come embedded
  // in the run detail (PayoutRunDetail = PayoutRun + lines). Each backend line is
  // ONE SETTLEMENT and every line in a run belongs to the same provider, so
  // payee_* comes from the run; fees are 0 because the platform cut was already
  // withheld upstream at settlement.
  const detail = await reqAt<{
    provider_id: string;
    provider_type: PayeeType;
    status: PayoutRun['status'];
    lines?: Array<{ id: string; amount_minor: number }>;
  }>(`${adminBase()}/payouts/${encodeURIComponent(runId)}`);
  return (detail?.lines ?? []).map((l) => ({
    id: l.id,
    payee_id: detail.provider_id,
    payee_name: detail.provider_id,
    payee_type: detail.provider_type,
    orders_count: 1,
    gross_kobo: l.amount_minor,
    fees_kobo: 0,
    net_kobo: l.amount_minor,
    status: detail.status,
  }));
}

// Process a pending payout run. Money path: requires Idempotency-Key server-side.
export async function processPayoutRun(runId: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PAYOUT_RUNS.find((x) => x.id === runId);
    if (p) { p.status = 'processing'; p.processed_at = new Date().toISOString(); }
    return { ok: true };
  }
  // TARGET: POST /api/restaurant/admin/payouts/:id/process (restaurant.admin.payouts)
  return reqAt<{ ok: true }>(`${adminBase()}/payouts/${runId}/process`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': `payout-run-${runId}` },
  });
}

// ── Refunds & disputes queue (money path) ────────────────────────────────────

const MOCK_DISPUTES: OrderDispute[] = [
  { id: 'dp-1', order_id: 'o4', restaurant_id: 'r3', restaurant_name: 'Pasta & Co', customer_id: 'u-4412', reference: 'o4', module_type: 'food', type: 'non_delivery', description: 'Order was cancelled by restaurant after 40 minutes; I was still charged for delivery and service fees.', evidence_urls: ['#'], order_total_kobo: 717_500, refundable_kobo: 717_500, status: 'open', created_at: new Date(Date.now() - 9_000_000).toISOString() },
  { id: 'dp-2', order_id: 'o1', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', customer_id: 'u-1842', reference: 'o1', module_type: 'food', type: 'wrong_item', description: 'Received grilled fish instead of chicken. Rider confirmed the mix-up at handoff and asked me to report it.', evidence_urls: ['#', '#'], order_total_kobo: 855_000, refundable_kobo: 350_000, status: 'in_review', created_at: new Date(Date.now() - 6_000_000).toISOString(), updated_at: new Date(Date.now() - 3_000_000).toISOString() },
  { id: 'dp-3', order_id: 'o2', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', customer_id: 'u-2210', reference: 'o2', module_type: 'food', type: 'quality', description: 'Suya was cold and stale on arrival.', order_total_kobo: 937_500, refundable_kobo: 750_000, status: 'resolved', resolution: 'settled', admin_note: 'Restaurant issued store credit; no ledger refund.', created_at: new Date(Date.now() - 86_400_000).toISOString(), updated_at: new Date(Date.now() - 80_000_000).toISOString() },
];

export async function listDisputes(status?: DisputeStatus | ''): Promise<OrderDispute[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_DISPUTES.filter((d) => d.status === status) : MOCK_DISPUTES;
  }
  // Food-specific admin queue: GET /api/restaurant/admin/disputes (restaurant.admin.disputes).
  // Previously this narrowed the GENERIC finance dispute feed by module_type=food,
  // which carries none of the food context (order parties, refundable ceiling).
  // That route now exists — disputes_handler.go shipped unregistered until this
  // change. Envelope is {"disputes": [...]}; reqAt only peels a `data` key.
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const raw = await reqAt<OrderDispute[] | { disputes?: FoodDisputeDTO[] }>(`${adminBase()}/disputes${qs}`);
  const rows = Array.isArray(raw) ? (raw as unknown as FoodDisputeDTO[]) : raw?.disputes ?? [];
  return rows.map(toOrderDispute);
}

// Backend FoodDispute (disputes_service.go). Narrower than the console's
// OrderDispute: it has no restaurant/customer denormalisation and no order total,
// so the fields the UI wants but the server does not send are left empty rather
// than invented. refundable_kobo falls back to refund_kobo (already-refunded) —
// the server enforces the real ceiling on resolve regardless.
type FoodDisputeDTO = {
  id: string;
  order_id: string;
  reporter_id: string;
  type: string;
  description: string;
  status: string;
  resolution?: string | null;
  refund_kobo: number;
  admin_note?: string | null;
  created_at: string;
  resolved_at?: string | null;
};

function toOrderDispute(d: FoodDisputeDTO): OrderDispute {
  return {
    id: d.id,
    order_id: d.order_id,
    customer_id: d.reporter_id,
    reference: d.order_id,
    module_type: 'food',
    type: d.type as OrderDispute['type'],
    description: d.description,
    order_total_kobo: 0,
    refundable_kobo: d.refund_kobo,
    status: d.status as DisputeStatus,
    resolution: (d.resolution ?? null) as OrderDispute['resolution'],
    admin_note: d.admin_note ?? null,
    created_at: d.created_at,
    updated_at: d.resolved_at ?? undefined,
  };
}

// Resolve a dispute. Money path: reviewer note is REQUIRED (audit); a refund
// resolution posts a balanced reversing ledger entry server-side.
export async function resolveDispute(id: string, req: ResolveDisputeRequest): Promise<{ ok: true }> {
  if (!req.admin_note.trim()) throw new Error('A reviewer note is required to resolve a dispute.');
  if (req.resolution === 'refunded') {
    if (req.refund_kobo == null || !Number.isInteger(req.refund_kobo) || req.refund_kobo <= 0) {
      throw new Error('Refund amount must be a positive integer (kobo).');
    }
    const d = MOCK_DISPUTES.find((x) => x.id === id);
    if (d && req.refund_kobo > d.refundable_kobo) {
      throw new Error(`Refund exceeds refundable amount (${nairaLabel(d.refundable_kobo)}).`);
    }
  }
  if (USE_MOCK) {
    await delay();
    const d = MOCK_DISPUTES.find((x) => x.id === id);
    if (d) { d.status = 'resolved'; d.resolution = req.resolution; d.admin_note = req.admin_note.trim(); d.updated_at = new Date().toISOString(); }
    return { ok: true };
  }
  // POST /api/restaurant/admin/disputes/:id/resolve (restaurant.admin.disputes).
  // NOTE the body field is `note`, NOT `admin_note` — the food handler binds
  // {resolution, refund_kobo?, note?} and takes adminID from the JWT. A refund
  // resolution issues a PLATFORM-FUNDED credit (no provider clawback), so the
  // Idempotency-Key is sent even though this handler does not currently read it:
  // it costs nothing and protects the retry path if the service starts honouring it.
  await reqAt<{ dispute: unknown }>(`${adminBase()}/disputes/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': `dispute-resolve-${id}` },
    body: JSON.stringify({ resolution: req.resolution, note: req.admin_note, refund_kobo: req.refund_kobo }),
  });
  // The handler answers {"dispute": {...}}; callers only need success/failure —
  // reqAt already throws on a non-2xx.
  return { ok: true };
}

// ── Scheduled orders (restaurant.admin.dispatch) ─────────────────────────────

/**
 * Releases scheduled orders whose window has arrived into the normal pipeline.
 * POST /api/restaurant/admin/activate-scheduled. Idempotent by nature — an order
 * already activated is skipped — so it is safe to press repeatedly.
 * group_handler.go shipped this unregistered; it now has a route.
 */
export async function activateScheduledOrders(): Promise<{ activated: number }> {
  if (USE_MOCK) { await delay(); return { activated: 0 }; }
  const res = await reqAt<{ activated?: number; count?: number }>(
    `${adminBase()}/activate-scheduled`, { method: 'POST' },
  );
  return { activated: res?.activated ?? res?.count ?? 0 };
}

// ── Merchant withdrawals (restaurant.admin.payouts — MONEY PATH) ─────────────
//
// Gated server-side by FEATURE_RESTAURANT_WITHDRAWALS_ENABLED (default OFF): with
// the flag off these routes are not registered and calls 404.
//
// IMPORTANT LIMIT: the backend exposes NO admin list of withdrawals. It has a
// merchant-scoped list (GET /restaurant/withdrawals, the caller's own) and the two
// admin actions below, keyed by id. So the console can act on a withdrawal but
// cannot discover one — an operator needs the id from support or the DB. Building
// a fake list here would be worse than saying so.

export type WithdrawalRow = {
  id: string;
  user_id: string;
  bank_account_id: string;
  amount_kobo: number;
  currency: string;
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'reversed';
  ledger_ref?: string | null;
  provider_reference?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Mark a withdrawal PAID (the provider-webhook outcome, driven manually).
 * Posts DR failed_transfer_suspense → CR provider_clearing under a row lock, so
 * paid and reversed are mutually exclusive. Requires an Idempotency-Key.
 */
export async function settleWithdrawal(id: string, providerReference: string): Promise<WithdrawalRow> {
  if (USE_MOCK) { await delay(); throw new Error('Withdrawals have no mock fixture — enable the feature flag and use a real id.'); }
  const res = await reqAt<{ data: WithdrawalRow }>(
    `${adminBase()}/withdrawals/${encodeURIComponent(id)}/settle`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': `withdrawal-settle-${id}` },
      body: JSON.stringify({ provider_reference: providerReference }),
    },
  );
  return (res as unknown as { data?: WithdrawalRow })?.data ?? (res as unknown as WithdrawalRow);
}

/**
 * Reverse a failed withdrawal — posts a compensating reversal back to the
 * merchant wallet. Mutually exclusive with settle under the same row lock.
 */
export async function reverseWithdrawal(id: string, reason: string): Promise<WithdrawalRow> {
  if (USE_MOCK) { await delay(); throw new Error('Withdrawals have no mock fixture — enable the feature flag and use a real id.'); }
  const res = await reqAt<{ data: WithdrawalRow }>(
    `${adminBase()}/withdrawals/${encodeURIComponent(id)}/reverse`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': `withdrawal-reverse-${id}` },
      body: JSON.stringify({ reason }),
    },
  );
  return (res as unknown as { data?: WithdrawalRow })?.data ?? (res as unknown as WithdrawalRow);
}

// Naira from integer kobo (shared with pages that don't import _ui.naira).
export function nairaLabel(kobo: number): string {
  return `₦${(((kobo ?? 0) / 100)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
