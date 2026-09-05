// ── Admin — Restaurant & Delivery service ───────────────────────────────────
// Read-only monitoring console. Talks to the Go backend (Gin) under
// /api/finance/restaurant. Mock-flagged for dev: flip with
// NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false to hit the live endpoints.
//
// NOTE: the two reads an operator lives in — the restaurant register and the
// order feed — are NOT on this member root. Both are admin surfaces under
// /api/restaurant/admin (RBAC restaurant.manage); see storeBase()/adminBase().
// The member routes here are owner-scoped and answer an operator about the
// handful of rows they personally own.

import { env } from '@/config/env';
import { ACTIVE_ORDER_STATUSES, ORDER_STATUSES, isTerminalOrderStatus } from '@/types/restaurantAdmin';
import type {
  AdminDispatchPage,
  AdminDispatchQuery,
  AdminRiderPage,
  AdminRiderQuery,
  AdminOrderPage,
  AdminOrderQuery,
  AdminOrderRow,
  AdminRestaurantPage,
  AdminRestaurantQuery,
  AdminRestaurantRow,
  OrderStatus,
  Restaurant,
  Rider,
  OrderDispatchStatus,
  RiderStatus,
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

// LIVE by default. Set NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=true for fixtures.
//
// It defaulted the other way, and the failure mode was the same silent one the
// merchant-onboarding console had: decideApplication in mock mode mutates an
// in-memory array and returns {ok:true}. A reviewer approved a restaurant's KYB,
// saw success, and kyb_status never moved — while payout runs select
// `kyb_status = 'approved'`, so the shop stayed unpayable with nothing to
// indicate why. 709 outlets are currently in exactly that state.
const USE_MOCK = (process.env.NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK ?? 'false').toLowerCase() === 'true';

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

// Money-path writes must not report success from fixture mode: it is exactly
// the "reviewer approved a restaurant, kyb_status never moved" failure this
// file's header comment describes, one level down. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false to make this change against the live backend.';

// (There was a base()-relative `req` helper here. Its only caller was the old
// owner-scoped listOrders; everything else goes through reqAt with an explicit
// root, because the member and admin roots are different hosts of truth.)

// ─── Mock datasets ────────────────────────────────────────────────────────────

const MOCK_RESTAURANTS: Restaurant[] = [
  { id: 'r1', owner_id: 'u-7001', name: 'Mama Put Express', cuisine: 'Nigerian', address: '12 Awolowo Rd, Ikoyi', phone: '+2348010000001', is_open: true, rating: 4.6, rating_count: 318, created_at: new Date(Date.now() - 86400000 * 40).toISOString() },
  { id: 'r2', owner_id: 'u-7002', name: 'Suya Spot GRA', cuisine: 'Grill', address: '5 Gana St, Maitama', phone: '+2348010000002', is_open: true, rating: 4.3, rating_count: 142, created_at: new Date(Date.now() - 86400000 * 22).toISOString() },
  { id: 'r3', owner_id: 'u-7003', name: 'Pasta & Co', cuisine: 'Italian', address: '8 Admiralty Way, Lekki', phone: '+2348010000003', is_open: false, rating: 4.1, rating_count: 56, created_at: new Date(Date.now() - 86400000 * 9).toISOString() },
];

// Fixtures for the ADMIN feed, so mock and live share one shape. Statuses here
// are drawn from the `orders_status_check` vocabulary only — the old fixtures
// carried `no_rider`, a value the column cannot hold, which is how the console's
// fiction survived review for as long as it did.
const MOCK_ORDERS: AdminOrderRow[] = [
  { id: 'o1-3f2a', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', customer_id: 'u-1842', rider_id: 'rd-12', rider_name: 'Ngozi A.', status: 'delivered', dispatch_status: 'delivered', item_count: 2, subtotal_kobo: 700_000, delivery_fee_kobo: 120_000, service_fee_kobo: 35_000, packaging_fee_kobo: 0, surge_kobo: 0, tip_kobo: 0, discount_kobo: 0, total_kobo: 855_000, delivery_address: '3 Glover Rd, Ikoyi', created_at: new Date(Date.now() - 7_200_000).toISOString(), updated_at: new Date(Date.now() - 5_400_000).toISOString(), delivered_at: new Date(Date.now() - 5_400_000).toISOString(), age_minutes: 0 },
  { id: 'o2-8b41', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', customer_id: 'u-2210', rider_id: null, rider_name: null, status: 'preparing', dispatch_status: 'none', item_count: 3, subtotal_kobo: 750_000, delivery_fee_kobo: 150_000, service_fee_kobo: 37_500, packaging_fee_kobo: 0, surge_kobo: 0, tip_kobo: 0, discount_kobo: 0, total_kobo: 937_500, delivery_address: '20 Aguiyi Ironsi, Maitama', created_at: new Date(Date.now() - 1_800_000).toISOString(), updated_at: new Date(Date.now() - 600_000).toISOString(), age_minutes: 0 },
  { id: 'o3-c07d', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', customer_id: 'u-3098', rider_id: 'rd-8', rider_name: 'Chidi O.', status: 'picked_up', dispatch_status: 'assigned', item_count: 1, subtotal_kobo: 420_000, delivery_fee_kobo: 130_000, service_fee_kobo: 21_000, packaging_fee_kobo: 0, surge_kobo: 0, tip_kobo: 0, discount_kobo: 0, total_kobo: 571_000, delivery_address: '14 Bourdillon, Ikoyi', created_at: new Date(Date.now() - 2_400_000).toISOString(), updated_at: new Date(Date.now() - 300_000).toISOString(), ready_at: new Date(Date.now() - 900_000).toISOString(), age_minutes: 0 },
  { id: 'o4-1e55', restaurant_id: 'r3', restaurant_name: 'Pasta & Co', customer_id: 'u-4412', rider_id: null, rider_name: null, status: 'cancelled', dispatch_status: 'none', status_reason: 'Customer cancelled before prep', item_count: 1, subtotal_kobo: 550_000, delivery_fee_kobo: 140_000, service_fee_kobo: 27_500, packaging_fee_kobo: 0, surge_kobo: 0, tip_kobo: 0, discount_kobo: 0, total_kobo: 717_500, delivery_address: '8 Admiralty Way, Lekki', created_at: new Date(Date.now() - 9_600_000).toISOString(), updated_at: new Date(Date.now() - 9_000_000).toISOString(), age_minutes: 0 },
  { id: 'o5-9a20', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', customer_id: 'u-5521', rider_id: null, rider_name: null, status: 'dispatch_failed', dispatch_status: 'searching', status_reason: 'No rider accepted after 3 broadcast rounds', item_count: 2, subtotal_kobo: 600_000, delivery_fee_kobo: 160_000, service_fee_kobo: 30_000, packaging_fee_kobo: 0, surge_kobo: 0, tip_kobo: 0, discount_kobo: 0, total_kobo: 790_000, delivery_address: '2 IBB Way, Maitama', created_at: new Date(Date.now() - 3_000_000).toISOString(), updated_at: new Date(Date.now() - 2_700_000).toISOString(), age_minutes: 0 },
  { id: 'o6-4d18', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', customer_id: 'u-6603', rider_id: null, rider_name: null, status: 'pending', dispatch_status: 'none', item_count: 4, subtotal_kobo: 1_120_000, delivery_fee_kobo: 120_000, service_fee_kobo: 56_000, packaging_fee_kobo: 20_000, surge_kobo: 0, tip_kobo: 50_000, discount_kobo: 100_000, total_kobo: 1_266_000, delivery_address: '9 Kingsway Rd, Ikoyi', created_at: new Date(Date.now() - 420_000).toISOString(), updated_at: new Date(Date.now() - 420_000).toISOString(), age_minutes: 0 },
  { id: 'o7-77bc', restaurant_id: 'r3', restaurant_name: 'Pasta & Co', customer_id: 'u-7714', rider_id: 'rd-15', rider_name: 'Emeka U.', status: 'delivery_failed', dispatch_status: 'assigned', status_reason: 'Address unreachable; customer unresponsive', item_count: 1, subtotal_kobo: 550_000, delivery_fee_kobo: 140_000, service_fee_kobo: 27_500, packaging_fee_kobo: 0, surge_kobo: 40_000, tip_kobo: 0, discount_kobo: 0, total_kobo: 757_500, delivery_address: '31 Admiralty Way, Lekki', created_at: new Date(Date.now() - 15_000_000).toISOString(), updated_at: new Date(Date.now() - 14_400_000).toISOString(), age_minutes: 0 },
];

/** All ten statuses at zero — the server guarantees a complete map, so does this. */
function emptyStatusCounts(): Record<OrderStatus, number> {
  return Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
}

/**
 * Filter / sort / page / aggregate the fixtures exactly as AdminListOrders does
 * in SQL, so mock mode and live mode page identically. Mock mode that ignored
 * the filters would hide precisely the paging and race bugs this page is being
 * fixed for.
 */
function mockOrderPage(params: AdminOrderQuery, limit: number, offset: number): AdminOrderPage {
  const q = (params.q ?? '').trim().toLowerCase();
  // Everything EXCEPT the status filter — the aggregates below must span every
  // status (server side: buildAdminOrderWhere(p, includeStatus=false)).
  const base = MOCK_ORDERS.filter((o) => {
    if (params.dispatch && o.dispatch_status !== params.dispatch) return false;
    if (params.restaurantId && o.restaurant_id !== params.restaurantId) return false;
    if (params.riderId && o.rider_id !== params.riderId) return false;
    if (params.unassigned && (o.rider_id || ['delivered', 'cancelled', 'rejected'].includes(o.status))) return false;
    if (q && ![o.id, o.restaurant_name, o.delivery_address].some((v) => v.toLowerCase().includes(q))) return false;
    return true;
  });

  const statusCounts = emptyStatusCounts();
  for (const o of base) statusCounts[o.status] += 1;
  const activeTotal = ACTIVE_ORDER_STATUSES.reduce((n, s) => n + statusCounts[s], 0);
  const grossDeliveredKobo = base
    .filter((o) => o.status === 'delivered')
    .reduce((n, o) => n + o.total_kobo, 0);

  const matched = params.status ? base.filter((o) => o.status === params.status) : base;
  const ms = (v: string) => new Date(v).getTime();
  const sorted = [...matched].sort((a, b) => {
    switch (params.sort) {
      case 'oldest': return ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id);
      case 'total': return b.total_kobo - a.total_kobo || ms(b.created_at) - ms(a.created_at);
      case 'updated': return ms(b.updated_at) - ms(a.updated_at) || b.id.localeCompare(a.id);
      default: return ms(b.created_at) - ms(a.created_at) || b.id.localeCompare(a.id);
    }
  });

  const now = Date.now();
  const items = sorted.slice(offset, offset + limit).map((o) => ({
    ...o,
    // Age is server-computed live, so a fixture cannot carry a fixed one without
    // going stale the moment the tab is left open.
    age_minutes: isTerminalOrderStatus(o.status) ? 0 : Math.max(0, Math.floor((now - ms(o.created_at)) / 60_000)),
  }));

  return {
    items,
    total: matched.length,
    limit,
    offset,
    hasMore: offset + items.length < matched.length,
    statusCounts,
    activeTotal,
    grossDeliveredKobo,
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * One page of the operator's restaurant REGISTER.
 *
 * This used to call the customer discovery endpoint (`GET /api/finance/
 * restaurant`), which is `WHERE is_open = TRUE`. So the console showed 2,016 of
 * the 2,227 rows in `restaurants`, and the 211 it hid — closed shops, listings
 * still awaiting review — are exactly the ones an operator needs to act on. The
 * "Restaurants" KPI counted that filtered list and read as the platform total.
 *
 * It also fetched every row at once and rendered a table row each. The register
 * endpoint pages (default 25, max 200) and filters in SQL.
 */
export async function listRestaurants(params: AdminRestaurantQuery = {}): Promise<AdminRestaurantPage> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  if (USE_MOCK) {
    await delay();
    const rows = MOCK_RESTAURANTS.slice(offset, offset + limit);
    return {
      items: rows,
      total: MOCK_RESTAURANTS.length,
      openTotal: MOCK_RESTAURANTS.filter((r) => r.is_open).length,
      limit,
      offset,
      hasMore: offset + rows.length < MOCK_RESTAURANTS.length,
    };
  }

  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.review) qs.set('review', params.review);
  if (params.sort) qs.set('sort', params.sort);

  // Mounted on the ADMIN group (restaurant.manage), not the member group — hence
  // storeBase() (/api/restaurant/admin/restaurants) rather than base().
  const body = await reqAt<{
    restaurants?: AdminRestaurantRow[];
    total?: number;
    open_total?: number;
    has_more?: boolean;
  }>(`${storeBase()}?${qs.toString()}`);

  const items = body?.restaurants ?? [];
  const total = typeof body?.total === 'number' ? body.total : offset + items.length;
  return {
    items,
    total,
    openTotal: typeof body?.open_total === 'number' ? body.open_total : items.filter((r) => r.is_open).length,
    limit,
    offset,
    hasMore: typeof body?.has_more === 'boolean' ? body.has_more : offset + items.length < total,
  };
}

/**
 * One page of the platform-wide ORDER FEED
 * (GET /api/restaurant/admin/orders, RBAC restaurant.manage).
 *
 * This used to call the MEMBER route `GET /api/finance/restaurant/orders
 * ?role=restaurant`, which is owner-scoped — `JOIN restaurants r ON
 * r.id = o.restaurant_id WHERE r.owner_id = $1`. An operator therefore saw the
 * orders of restaurants THEY personally own: none of the 2,174 on the platform.
 * That handler also ignored `?status=` outright, so every filter chip returned
 * the same (empty) list and nothing about the screen said so.
 *
 * The feed pages (default 25, max 200), filters in SQL, and returns aggregates
 * over the WHOLE filtered set so the KPI tiles do not degrade into "…among the
 * 25 on screen" — see AdminOrderPage.
 *
 * A status outside the `orders_status_check` vocabulary is a 400 from the
 * server, not an empty page: a stale client fails loudly rather than reporting
 * zero orders in a state that cannot exist.
 */
export async function listOrders(params: AdminOrderQuery = {}): Promise<AdminOrderPage> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  if (USE_MOCK) {
    await delay();
    return mockOrderPage(params, limit, offset);
  }

  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (params.status) qs.set('status', params.status);
  if (params.dispatch) qs.set('dispatch', params.dispatch);
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.restaurantId) qs.set('restaurant_id', params.restaurantId);
  if (params.riderId) qs.set('rider_id', params.riderId);
  if (params.unassigned) qs.set('unassigned', '1');
  if (params.sort) qs.set('sort', params.sort);

  // Mounted on the ADMIN group (restaurant.manage). Orders hang off adminBase()
  // directly — /api/restaurant/admin/orders — NOT off storeBase(), which is the
  // per-restaurant store/menu subtree.
  const body = await reqAt<{
    orders?: AdminOrderRow[];
    total?: number;
    has_more?: boolean;
    status_counts?: Partial<Record<OrderStatus, number>>;
    active_total?: number;
    gross_delivered_kobo?: number;
  }>(`${adminBase()}/orders?${qs.toString()}`);

  const items = body?.orders ?? [];
  const total = typeof body?.total === 'number' ? body.total : offset + items.length;

  // Start from a complete zeroed map and overlay: a chip whose count is missing
  // must read 0, never `undefined` rendered as blank.
  const statusCounts = emptyStatusCounts();
  for (const [s, n] of Object.entries(body?.status_counts ?? {})) {
    if (s in statusCounts && typeof n === 'number') statusCounts[s as OrderStatus] = n;
  }

  return {
    items,
    total,
    limit,
    offset,
    hasMore: typeof body?.has_more === 'boolean' ? body.has_more : offset + items.length < total,
    statusCounts,
    activeTotal:
      typeof body?.active_total === 'number'
        ? body.active_total
        : ACTIVE_ORDER_STATUSES.reduce((n, s) => n + statusCounts[s], 0),
    grossDeliveredKobo: typeof body?.gross_delivered_kobo === 'number' ? body.gross_delivered_kobo : 0,
  };
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

export async function getRestaurantDetail(id: string): Promise<RestaurantDetail> {
  if (USE_MOCK) {
    await delay();
    const r = MOCK_RESTAURANTS.find((x) => x.id === id) ?? MOCK_RESTAURANTS[0];
    return { restaurant: r, categories: MOCK_MENU };
  }
  return reqAt<RestaurantDetail>(`${storeBase()}/${encodeURIComponent(id)}`);
}

export async function updateRestaurant(id: string, patch: UpdateRestaurantRequest): Promise<Restaurant> {
  if (USE_MOCK) throw new Error(`Updating a restaurant ${NOT_IN_FIXTURE_MODE}`);
  return reqAt<Restaurant>(`${storeBase()}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Operator force-open / force-close. */
export async function setRestaurantAvailability(id: string, isOpen: boolean): Promise<Restaurant> {
  if (USE_MOCK) throw new Error(`Changing restaurant availability ${NOT_IN_FIXTURE_MODE}`);
  return reqAt<Restaurant>(`${storeBase()}/${encodeURIComponent(id)}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ is_open: isOpen }),
  });
}

export async function createMenuCategory(restaurantId: string, name: string): Promise<MenuCategory> {
  if (USE_MOCK) throw new Error(`Creating a menu category ${NOT_IN_FIXTURE_MODE}`);
  return reqAt<MenuCategory>(`${storeBase()}/${encodeURIComponent(restaurantId)}/menu/categories`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteMenuCategory(restaurantId: string, categoryId: string): Promise<void> {
  if (USE_MOCK) throw new Error(`Deleting a menu category ${NOT_IN_FIXTURE_MODE}`);
  await reqAt<{ deleted: boolean }>(
    `${storeBase()}/${encodeURIComponent(restaurantId)}/menu/categories/${encodeURIComponent(categoryId)}`,
    { method: 'DELETE' },
  );
}

export async function createMenuItem(restaurantId: string, req: CreateMenuItemRequest): Promise<MenuItem> {
  if (USE_MOCK) throw new Error(`Creating a menu item ${NOT_IN_FIXTURE_MODE}`);
  return reqAt<MenuItem>(`${storeBase()}/${encodeURIComponent(restaurantId)}/menu/items`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function updateMenuItem(
  restaurantId: string,
  itemId: string,
  patch: UpdateMenuItemRequest,
): Promise<MenuItem> {
  if (USE_MOCK) throw new Error(`Updating a menu item ${NOT_IN_FIXTURE_MODE}`);
  return reqAt<MenuItem>(
    `${storeBase()}/${encodeURIComponent(restaurantId)}/menu/items/${encodeURIComponent(itemId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function deleteMenuItem(restaurantId: string, itemId: string): Promise<void> {
  if (USE_MOCK) throw new Error(`Deleting a menu item ${NOT_IN_FIXTURE_MODE}`);
  await reqAt<{ deleted: boolean }>(
    `${storeBase()}/${encodeURIComponent(restaurantId)}/menu/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  );
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

// ── Rider dispatch board ─────────────────────────────────────────────────────

const MOCK_RIDERS: Rider[] = [
  { id: 'rd-8', name: 'Chidi O.', phone: '+2348030000008', vehicle: 'bike', status: 'on_delivery', active_order_id: 'o3', zone: 'Ikoyi', rating: 4.7, deliveries_today: 6, last_seen_at: new Date(Date.now() - 60_000).toISOString(), lat: 6.452, lng: 3.436 },
  { id: 'rd-12', name: 'Ngozi A.', phone: '+2348030000012', vehicle: 'bike', status: 'available', active_order_id: null, zone: 'Ikoyi', rating: 4.9, deliveries_today: 9, last_seen_at: new Date(Date.now() - 30_000).toISOString(), lat: 6.448, lng: 3.430 },
  { id: 'rd-15', name: 'Emeka U.', phone: '+2348030000015', vehicle: 'car', status: 'available', active_order_id: null, zone: 'Maitama', rating: 4.5, deliveries_today: 4, last_seen_at: new Date(Date.now() - 120_000).toISOString(), lat: 9.086, lng: 7.501 },
  { id: 'rd-21', name: 'Bisi K.', phone: '+2348030000021', vehicle: 'bike', status: 'offline', active_order_id: null, zone: 'Lekki', rating: 4.2, deliveries_today: 0, last_seen_at: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'rd-30', name: 'Tunde F.', phone: '+2348030000030', vehicle: 'bike', status: 'suspended', active_order_id: null, zone: 'Maitama', rating: 3.4, deliveries_today: 0, last_seen_at: new Date(Date.now() - 86_400_000).toISOString() },
];

const MOCK_DISPATCH: DispatchOrder[] = [
  { id: 'o3', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', status: 'picked_up', dispatch_status: 'assigned', rider_id: 'rd-8', rider_name: 'Chidi O.', delivery_address: '14 Bourdillon, Ikoyi', total_kobo: 571_000, delivery_fee_kobo: 130_000, ready_at: new Date(Date.now() - 900_000).toISOString(), created_at: new Date(Date.now() - 2_400_000).toISOString(), waiting_minutes: 0 },
  // `no_rider` was never an order status. The real state for "broadcast rounds
  // ran out and nobody took it" is dispatch_failed.
  { id: 'o5', restaurant_id: 'r2', restaurant_name: 'Suya Spot GRA', status: 'dispatch_failed', dispatch_status: 'searching', rider_id: null, rider_name: null, delivery_address: '2 IBB Way, Maitama', total_kobo: 790_000, delivery_fee_kobo: 160_000, ready_at: new Date(Date.now() - 1_500_000).toISOString(), created_at: new Date(Date.now() - 3_000_000).toISOString(), waiting_minutes: 25 },
  { id: 'o7', restaurant_id: 'r1', restaurant_name: 'Mama Put Express', status: 'ready', dispatch_status: 'none', rider_id: null, rider_name: null, delivery_address: '9 Kingsway Rd, Ikoyi', total_kobo: 420_000, delivery_fee_kobo: 120_000, ready_at: new Date(Date.now() - 240_000).toISOString(), created_at: new Date(Date.now() - 1_200_000).toISOString(), waiting_minutes: 4 },
];

const RIDER_STATUSES: readonly RiderStatus[] = ['available', 'on_delivery', 'offline', 'suspended'];
const DISPATCH_STATUSES: readonly OrderDispatchStatus[] = ['none', 'searching', 'assigned', 'delivered'];

/** Zeroed count maps, so a chip whose count the server omitted reads 0, not blank. */
function emptyRiderCounts(): Record<RiderStatus, number> {
  return RIDER_STATUSES.reduce((a, s) => { a[s] = 0; return a; }, {} as Record<RiderStatus, number>);
}
function emptyDispatchCounts(): Record<OrderDispatchStatus, number> {
  return DISPATCH_STATUSES.reduce((a, s) => { a[s] = 0; return a; }, {} as Record<OrderDispatchStatus, number>);
}

/**
 * One page of the rider roster.
 *
 * Was unbounded — every driver in one response, with the board then counting the
 * array it held. `drivers` grows with traffic rather than with the merchant
 * estate, and the counts have to come from the server or "Available riders"
 * silently means "available among the 25 on screen".
 */
export async function listRiders(params: AdminRiderQuery = {}): Promise<AdminRiderPage> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  if (USE_MOCK) {
    await delay();
    const all = MOCK_RIDERS.filter((r) => {
      if (params.status && r.status !== params.status) return false;
      if (params.vehicle && r.vehicle !== params.vehicle) return false;
      const q = params.q?.trim().toLowerCase();
      if (q && !(r.name.toLowerCase().includes(q) || (r.phone ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    // Counts span every status under the OTHER filters, matching
    // buildRiderRosterWhere(p, includeStatus=false) on the server.
    const counted = MOCK_RIDERS.filter((r) => {
      if (params.vehicle && r.vehicle !== params.vehicle) return false;
      const q = params.q?.trim().toLowerCase();
      if (q && !(r.name.toLowerCase().includes(q) || (r.phone ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    const statusCounts = emptyRiderCounts();
    for (const r of counted) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, limit, offset, hasMore: offset + items.length < all.length, statusCounts };
  }

  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (params.status) qs.set('status', params.status);
  if (params.vehicle) qs.set('vehicle', params.vehicle);
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.sort) qs.set('sort', params.sort);

  const body = await reqAt<{
    riders?: Rider[]; total?: number; has_more?: boolean;
    status_counts?: Partial<Record<RiderStatus, number>>;
  }>(`${adminBase()}/riders?${qs.toString()}`);

  const items = body?.riders ?? [];
  const total = typeof body?.total === 'number' ? body.total : offset + items.length;
  const statusCounts = emptyRiderCounts();
  for (const [k, v] of Object.entries(body?.status_counts ?? {})) {
    if (k in statusCounts && typeof v === 'number') statusCounts[k as RiderStatus] = v;
  }
  return {
    items, total, limit, offset,
    hasMore: typeof body?.has_more === 'boolean' ? body.has_more : offset + items.length < total,
    statusCounts,
  };
}

/**
 * One page of the dispatch queue, newest-waiting LAST (the server orders
 * longest-waiting first — a dispatch board is worked worst-first).
 *
 * `stalledTotal` and `stalledAfterMinutes` come from the server so the console
 * neither counts only what it rendered nor keeps its own idea of how long is
 * too long.
 */
export async function listDispatchQueue(params: AdminDispatchQuery = {}): Promise<AdminDispatchPage> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const FALLBACK_STALLED_MINUTES = 10;

  if (USE_MOCK) {
    await delay();
    const matches = (o: DispatchOrder, withDispatch: boolean) => {
      if (withDispatch && params.dispatch && (o.dispatch_status ?? 'none') !== params.dispatch) return false;
      if (params.restaurantId && o.restaurant_id !== params.restaurantId) return false;
      if (params.stalled && !(o.dispatch_status === 'searching' && (o.waiting_minutes ?? 0) >= FALLBACK_STALLED_MINUTES)) return false;
      const q = params.q?.trim().toLowerCase();
      if (q && !(o.id.toLowerCase().includes(q) || (o.restaurant_name ?? '').toLowerCase().includes(q) || (o.delivery_address ?? '').toLowerCase().includes(q))) return false;
      return true;
    };
    const all = MOCK_DISPATCH.filter((o) => matches(o, true));
    const dispatchCounts = emptyDispatchCounts();
    let stalledTotal = 0;
    for (const o of MOCK_DISPATCH.filter((o) => matches(o, false))) {
      const d = (o.dispatch_status ?? 'none') as OrderDispatchStatus;
      dispatchCounts[d] = (dispatchCounts[d] ?? 0) + 1;
      if (o.dispatch_status === 'searching' && (o.waiting_minutes ?? 0) >= FALLBACK_STALLED_MINUTES) stalledTotal += 1;
    }
    const items = all.slice(offset, offset + limit);
    return {
      items, total: all.length, limit, offset,
      hasMore: offset + items.length < all.length,
      dispatchCounts, stalledTotal, stalledAfterMinutes: FALLBACK_STALLED_MINUTES,
    };
  }

  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (params.dispatch) qs.set('dispatch', params.dispatch);
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.restaurantId) qs.set('restaurant_id', params.restaurantId);
  if (params.stalled) qs.set('stalled', '1');
  if (params.sort) qs.set('sort', params.sort);

  const body = await reqAt<{
    orders?: DispatchOrder[]; total?: number; has_more?: boolean;
    dispatch_counts?: Partial<Record<OrderDispatchStatus, number>>;
    stalled_total?: number; stalled_after_minutes?: number;
  }>(`${adminBase()}/dispatch/queue?${qs.toString()}`);

  const items = body?.orders ?? [];
  const total = typeof body?.total === 'number' ? body.total : offset + items.length;
  const dispatchCounts = emptyDispatchCounts();
  for (const [k, v] of Object.entries(body?.dispatch_counts ?? {})) {
    if (k in dispatchCounts && typeof v === 'number') dispatchCounts[k as OrderDispatchStatus] = v;
  }
  return {
    items, total, limit, offset,
    hasMore: typeof body?.has_more === 'boolean' ? body.has_more : offset + items.length < total,
    dispatchCounts,
    stalledTotal: typeof body?.stalled_total === 'number' ? body.stalled_total : 0,
    stalledAfterMinutes: typeof body?.stalled_after_minutes === 'number' ? body.stalled_after_minutes : FALLBACK_STALLED_MINUTES,
  };
}

// Manually assign/offer an order to a specific rider. Targets the live admin
// dispatch route POST /api/restaurant/admin/orders/:id/assign (body {rider_id}),
// which returns {ok:true}.
export async function assignRider(orderId: string, riderId: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw new Error(`Assigning a rider ${NOT_IN_FIXTURE_MODE}`);
  // TARGET: POST /api/restaurant/admin/orders/:id/assign (restaurant.admin.dispatch)
  return reqAt<{ ok: true }>(`${adminBase()}/orders/${orderId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ rider_id: riderId }),
  });
}

// Re-run automatic dispatch for a stuck (no_rider) order. CONSUMES the live
// POST /api/finance/restaurant/orders/:orderId/dispatch route.
export async function redispatchOrder(orderId: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw new Error(`Re-dispatching an order ${NOT_IN_FIXTURE_MODE}`);
  // adminBase(), NOT base(). The member route
  // /api/finance/restaurant/orders/:id/dispatch is owner-gated in its handler
  // (`only the restaurant may re-dispatch`) and an operator is never the owner,
  // so this button answered 403 every single time. The admin route runs the same
  // idempotent DispatchOrder behind restaurant.admin.dispatch.
  return reqAt<{ ok: true }>(`${adminBase()}/orders/${orderId}/dispatch`, { method: 'POST' });
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
export interface PendingListing {
  id: string;
  name: string;
  address: string;
  is_open: boolean;
  created_at: string;
}

export async function listPendingListings(): Promise<PendingListing[]> {
  if (USE_MOCK) { await delay(); return []; }
  const d = await reqAt<any>(`${adminBase()}/listings/pending`, { method: 'GET' });
  return (d?.listings ?? d ?? []) as PendingListing[];
}

export async function decideListing(
  id: string,
  decision: 'approve' | 'reject' | 'changes',
  reason: string,
): Promise<{ ok: true }> {
  // Mirrors the server: a negative decision without a reason leaves the owner
  // nothing to act on, so it is refused here too rather than round-tripping.
  if (decision !== 'approve' && !reason.trim()) {
    throw new Error('A reason is required to reject or request changes.');
  }
  if (USE_MOCK) throw new Error(`Deciding a listing ${NOT_IN_FIXTURE_MODE}`);
  return reqAt<{ ok: true }>(`${adminBase()}/listings/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason: reason.trim() }),
  });
}

export interface UnclaimedRestaurant {
  id: string;
  name: string;
  address: string;
  is_open: boolean;
  created_at: string;
  reason: string;
}

export async function listUnclaimedRestaurants(): Promise<UnclaimedRestaurant[]> {
  if (USE_MOCK) { await delay(); return []; }
  const d = await reqAt<any>(`${adminBase()}/restaurants/unclaimed`, { method: 'GET' });
  return (d?.restaurants ?? d ?? []) as UnclaimedRestaurant[];
}

export async function decideApplication(
  id: string,
  decision: 'approve' | 'reject',
  note: string,
): Promise<{ ok: true }> {
  if (decision === 'reject' && !note.trim()) throw new Error('A reviewer note is required to reject.');
  if (USE_MOCK) throw new Error(`Deciding an application ${NOT_IN_FIXTURE_MODE}`);
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

// ── Backend payout DTOs ──────────────────────────────────────────────────────
// The Go module (backend/internal/restaurant/payout.go) models a run as ONE
// PROVIDER for ONE PERIOD, with append-only lines that are SETTLEMENTS. The
// admin types above were written against a different, imagined shape: a run
// spanning many payees, with one line PER PAYEE. The adapters below translate;
// fields the backend genuinely does not carry are left undefined rather than
// invented, so the UI can render "unknown" instead of a confident wrong number.
type ApiPayoutRun = {
  id: string;
  period_key: string;
  provider_type: 'restaurant' | 'rider';
  provider_id: string;
  gross_minor: number;
  fee_minor: number;
  net_minor: number;
  status: 'draft' | 'processing' | 'paid' | 'failed';
  idempotency_key: string;
  ledger_reference?: string | null;
  created_at: string;
  processed_at?: string | null;
};
type ApiPayoutLine = {
  id: string;
  run_id: string;
  order_id?: string | null;
  settlement_id?: string | null;
  amount_minor: number;
  created_at: string;
};
type ApiPayoutRunDetail = ApiPayoutRun & { lines: ApiPayoutLine[] };

function toPayoutRun(r: ApiPayoutRun, lines?: ApiPayoutLine[]): PayoutRun {
  // A run only has a ledger reference once ProcessRun has posted its balanced
  // transfer. So: draft/processing → reconciliation is not yet meaningful
  // (undefined, which leaves the Process button enabled); paid WITHOUT a
  // reference → a real anomaly worth flagging red.
  const settled = r.ledger_reference ? r.net_minor : undefined;
  const reconciled =
    r.status === 'paid' ? Boolean(r.ledger_reference) : undefined;

  return {
    id: r.id,
    payee_type: r.provider_type,
    // The backend stores an opaque period_key (e.g. "2026-W28"), not a date
    // range. Surfacing the key in both slots is honest; parsing it into
    // fabricated dates would not be.
    period_start: r.period_key,
    period_end: r.period_key,
    status: r.status,
    lines_count: lines?.length ?? 0, // only known on the detail response
    total_net_kobo: r.net_minor,
    created_at: r.created_at,
    processed_at: r.processed_at ?? null,
    ledger_settled_kobo: settled,
    reconciled,
  };
}

export async function listPayoutRuns(payeeType?: PayeeType | ''): Promise<PayoutRun[]> {
  if (USE_MOCK) {
    await delay();
    return payeeType ? MOCK_PAYOUT_RUNS.filter((p) => p.payee_type === payeeType) : MOCK_PAYOUT_RUNS;
  }
  // The Go handler filters on provider_type, not payee_type.
  const qs = payeeType ? `?provider_type=${encodeURIComponent(payeeType)}` : '';
  const runs = await reqAt<ApiPayoutRun[]>(`${adminBase()}/payouts${qs}`);
  return (runs ?? []).map((r) => toPayoutRun(r));
}

export async function getPayoutLines(runId: string): Promise<PayoutLine[]> {
  if (USE_MOCK) { await delay(); return MOCK_PAYOUT_LINES[runId] ?? []; }
  // There is no /payouts/:id/lines route — that path 404'd. Lines come embedded
  // in the run detail (PayoutRunDetail = PayoutRun + lines).
  const detail = await reqAt<ApiPayoutRunDetail>(`${adminBase()}/payouts/${encodeURIComponent(runId)}`);
  const lines = detail?.lines ?? [];

  // Every line in a backend run belongs to the SAME payee (the run's provider),
  // so payee_id/payee_type are taken from the run. A line is one settlement, not
  // a per-payee aggregate: orders_count is therefore 1, gross == net, and fees
  // are 0 because the platform cut was already withheld upstream at settlement.
  // bank_account is not exposed by this endpoint and stays undefined.
  return lines.map((l) => ({
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

// Build a draft run for one provider + period. Aggregates settled-but-unpaid
// settlements; idempotent per (provider, period); no money moves at build time.
// The backend has always exposed this — the console simply had no way to call it,
// so operators could process runs but never create one.
export async function buildPayoutRun(input: {
  periodKey: string;
  providerType: PayeeType;
  providerId: string;
}): Promise<PayoutRun> {
  if (USE_MOCK) throw new Error(`Building a payout run ${NOT_IN_FIXTURE_MODE}`);
  const run = await reqAt<ApiPayoutRun>(`${adminBase()}/payouts/build`, {
    method: 'POST',
    body: JSON.stringify({
      period_key: input.periodKey,
      provider_type: input.providerType,
      provider_id: input.providerId,
    }),
  });
  return toPayoutRun(run);
}

// Process a pending payout run. Money path: requires Idempotency-Key server-side.
export async function processPayoutRun(runId: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw new Error(`Processing a payout run ${NOT_IN_FIXTURE_MODE}`);
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
  // CONSUMES live GET /api/finance/disputes then narrows to module_type=food.
  const all = await reqAt<OrderDispute[]>(`${financeBase()}/disputes?module_type=food`);
  return status ? all.filter((d) => d.status === status) : all;
}

// Resolve a dispute. Money path: reviewer note is REQUIRED (audit); a refund
// resolution posts a balanced reversing ledger entry server-side.
export async function resolveDispute(id: string, req: ResolveDisputeRequest): Promise<{ ok: true }> {
  if (!req.admin_note.trim()) throw new Error('A reviewer note is required to resolve a dispute.');
  if (req.resolution === 'refunded') {
    if (req.refund_kobo == null || !Number.isInteger(req.refund_kobo) || req.refund_kobo <= 0) {
      throw new Error('Refund amount must be a positive integer (kobo).');
    }
    if (USE_MOCK) {
      const d = MOCK_DISPUTES.find((x) => x.id === id);
      if (d && req.refund_kobo > d.refundable_kobo) {
        throw new Error(`Refund exceeds refundable amount (${nairaLabel(d.refundable_kobo)}).`);
      }
    }
  }
  if (USE_MOCK) throw new Error(`Resolving a dispute ${NOT_IN_FIXTURE_MODE}`);
  // CONSUMES live POST /api/finance/admin/disputes/:id/resolve
  // (body { resolution, admin_note }; server binds adminID from JWT, posts the
  // reversing ledger entry on refund).
  return reqAt<{ ok: true }>(`${financeBase()}/admin/disputes/${id}/resolve`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': `dispute-resolve-${id}` },
    body: JSON.stringify({ resolution: req.resolution, admin_note: req.admin_note, refund_kobo: req.refund_kobo }),
  });
}

// Naira from integer kobo (shared with pages that don't import _ui.naira).
export function nairaLabel(kobo: number): string {
  return `₦${(((kobo ?? 0) / 100)).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
