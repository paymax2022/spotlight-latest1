// ── Admin — Restaurant & Delivery types (mirror of backend/internal/finance/restaurant) ──
// All monetary amounts are integers in minor units (kobo). Never floats.

/**
 * The order vocabulary the database actually enforces: the `orders_status_check`
 * CHECK constraint, mirrored by `AdminOrderStatuses` in
 * backend/internal/restaurant/admin_orders.go.
 *
 * This type used to read `placed | accepted | assigned | refunded | no_rider`
 * next to the five real values. `orders.status` cannot hold any of those five —
 * so half the console's filter chips could never match a row, while five states
 * that DO occur (pending, confirmed, rejected, dispatch_failed, delivery_failed)
 * had no chip at all. The admin feed 400s on an unrecognised `?status=`, so a
 * stale value is now a visible error rather than a confidently empty page.
 */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'
  | 'rejected'
  | 'dispatch_failed'
  | 'delivery_failed';

/** Every status, in lifecycle order — the source for the console's filter chips. */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending', 'confirmed', 'preparing', 'ready', 'picked_up',
  'delivered', 'cancelled', 'rejected', 'dispatch_failed', 'delivery_failed',
];

/**
 * The states an order passes through while someone is still waiting on food —
 * `adminOrderActive` server-side, and what `active_total` sums. The remaining
 * five are terminal, which is also why the server stops accruing `age_minutes`
 * on them: a delivered order is not "waiting".
 */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'pending', 'confirmed', 'preparing', 'ready', 'picked_up',
];

/** True once the order will not move again, so age and dispatch stop mattering. */
export function isTerminalOrderStatus(s: OrderStatus): boolean {
  return !ACTIVE_ORDER_STATUSES.includes(s);
}

/**
 * `orders.dispatch_status` — who is carrying it, tracked separately from the
 * order's own state. This is where `assigned` lives; it was never an
 * `orders.status` value.
 */
export type OrderDispatchStatus = 'none' | 'searching' | 'assigned' | 'delivered';

export interface Restaurant {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  cuisine?: string;
  image_url?: string;
  is_open: boolean;
  rating: number;
  rating_count: number;
  created_at: string;
  // Storefront terms, integer kobo. Added to the Go DTO alongside the
  // packaging-fee migration; absent on older payloads, hence optional.
  min_order_kobo?: number;
  packaging_fee_kobo?: number;
  prep_time_minutes?: number;
}

/**
 * One row of the operator's restaurant register
 * (GET /api/restaurant/admin/restaurants).
 *
 * The console used to list restaurants off the CUSTOMER discovery endpoint,
 * which is `WHERE is_open = TRUE` — so closed shops and listings still awaiting
 * review, 211 rows of 2,227, were invisible to ops while the page's total read
 * as the platform figure. These extra columns are the ones that say WHY a shop
 * is not live.
 */
export interface AdminRestaurantRow extends Restaurant {
  kyb_status?: string;
  listing_review_status?: string;
  listing_review_reason?: string;
  updated_at?: string;
  menu_item_count?: number;
}

/** A page of the register plus the totals the console header reports. */
export interface AdminRestaurantPage {
  items: AdminRestaurantRow[];
  /** Rows matching the CURRENT filters — not the loaded ones. */
  total: number;
  /** How many of those are open. */
  openTotal: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Filters accepted by the register endpoint. */
export interface AdminRestaurantQuery {
  q?: string;
  status?: 'open' | 'closed' | 'all';
  review?: string;
  sort?: 'newest' | 'name' | 'rating' | 'updated';
  limit?: number;
  offset?: number;
}

// ── Menu (admin store management) ────────────────────────────────────────────
// Mirrors backend/internal/restaurant/model.go MenuCategory / MenuItem.

export interface MenuItem {
  id: string;
  category_id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  /** Integer kobo. Never a float, never a string for math. */
  price_kobo: number;
  image_url?: string | null;
  is_available: boolean;
  dietary_tags?: string[];
}

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  items?: MenuItem[];
}

/** Response shape of GET /api/restaurant/admin/restaurants/:id. */
export interface RestaurantDetail {
  restaurant: Restaurant;
  categories: MenuCategory[];
}

/** Partial store-profile edit; omitted fields are left unchanged server-side. */
export interface UpdateRestaurantRequest {
  name?: string;
  description?: string;
  address?: string;
  cuisine?: string;
  logo_url?: string | null;
}

export interface CreateMenuItemRequest {
  category_id: string;
  name: string;
  description?: string;
  price_kobo: number;
  image_url?: string | null;
  dietary_tags?: string[];
}

export interface UpdateMenuItemRequest {
  price_kobo?: number;
  is_available?: boolean;
  dietary_tags?: string[];
}

export interface OrderItem {
  item_id: string;
  name: string;
  unit_price_kobo: number;
  quantity: number;
  notes?: string;
}

/**
 * The MEMBER-route order DTO (`GET /api/finance/restaurant/orders`), which
 * carries its line items inline. The ops console does not read this route — it
 * is owner-scoped (`WHERE r.owner_id = caller`), so it answers an operator with
 * the orders of restaurants they personally own. See AdminOrderRow below.
 */
export interface Order {
  id: string;
  restaurant_id: string;
  restaurant_name?: string;
  customer_id: string;
  rider_id?: string | null;
  status: OrderStatus;
  items: OrderItem[];
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  total_kobo: number;
  delivery_address?: string;
  delivery_lat?: number;
  delivery_lng?: number;
  created_at: string;
  updated_at?: string;
}

/**
 * One row of the platform-wide order feed
 * (GET /api/restaurant/admin/orders, RBAC restaurant.manage).
 *
 * Mirrors `AdminOrderRow` in backend/internal/restaurant/admin_orders.go field
 * for field. It carries the restaurant and rider NAMES already joined, so the
 * queue can be read without a second lookup — the console used to print a raw
 * rider uuid, which tells an operator nothing about who to call.
 *
 * `item_count` is SUM(order_items.quantity), not a count of distinct lines, and
 * arrives pre-aggregated because the admin feed does not ship line items.
 * All money is integer kobo, display-only: this endpoint moves none.
 */
export interface AdminOrderRow {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  customer_id: string;
  rider_id?: string | null;
  rider_name?: string | null;

  status: OrderStatus;
  dispatch_status: OrderDispatchStatus;
  /** Operator-visible why for a rejected / failed order. */
  status_reason?: string | null;

  item_count: number;

  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  packaging_fee_kobo: number;
  surge_kobo: number;
  tip_kobo: number;
  discount_kobo: number;
  total_kobo: number;

  delivery_address: string;
  created_at: string;
  updated_at: string;
  ready_at?: string | null;
  delivered_at?: string | null;
  disputed_at?: string | null;

  /**
   * How long the order has been open, computed SERVER-side so every operator's
   * console agrees regardless of clock skew. Zero on terminal statuses — check
   * isTerminalOrderStatus() before rendering it, since a just-placed order also
   * reports 0.
   */
  age_minutes: number;
}

/**
 * A page of the order feed plus aggregates over the WHOLE filtered set.
 *
 * The aggregates are why the feed returns them rather than letting the page add
 * up what it rendered: the KPI tiles counted the loaded array, so with a paged
 * feed "Active orders" would silently have meant "active among the 25 on
 * screen" — of 2,174 orders.
 */
export interface AdminOrderPage {
  items: AdminOrderRow[];
  /** Rows matching the CURRENT filters — not the loaded ones. */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  /**
   * Count per status under the current filters EXCLUDING the status filter
   * itself, so the chips keep showing what selecting them would yield instead
   * of collapsing to the one in effect. Every status is present, 0 included.
   */
  statusCounts: Record<OrderStatus, number>;
  /** Sum of statusCounts over the pre-terminal states. */
  activeTotal: number;
  /** Total of delivered orders under the same non-status filters. Integer kobo. */
  grossDeliveredKobo: number;
}

/** Filters accepted by the order feed. */
export interface AdminOrderQuery {
  status?: OrderStatus | '';
  dispatch?: OrderDispatchStatus | '';
  /** Order id prefix, restaurant name, or delivery address. */
  q?: string;
  restaurantId?: string;
  riderId?: string;
  /** No rider yet AND not already closed — a live dispatch problem. */
  unassigned?: boolean;
  sort?: 'newest' | 'oldest' | 'total' | 'updated';
  limit?: number;
  offset?: number;
}

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: 'customer' | 'restaurant' | 'rider';
  body: string;
  attachment_url?: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops-console extensions (dispatch · onboarding · payouts · refunds/disputes).
// These surfaces mirror the restaurant.order.* state machine and money-path
// invariants (integer kobo, double-entry ledger, immutable audit, reviewer
// note). Where a backend admin route already exists it is consumed; where one
// does not yet exist the shape below is the target contract the service mocks
// against (documented per-field in restaurantAdminService.ts).
// ─────────────────────────────────────────────────────────────────────────────

// ── Rider dispatch board ─────────────────────────────────────────────────────
export type RiderStatus = 'available' | 'on_delivery' | 'offline' | 'suspended';

export interface Rider {
  id: string;
  name: string;
  phone?: string;
  vehicle?: 'bike' | 'car' | 'foot';
  status: RiderStatus;
  active_order_id?: string | null;
  lat?: number;
  lng?: number;
  zone?: string;
  rating?: number;
  deliveries_today?: number;
  last_seen_at?: string;
}

// An order that needs dispatch attention (ready / picked_up / dispatch_failed).
//
// `assigned` used to be listed here as an order status. It is not one: whether a
// rider is carrying the order lives in `orders.dispatch_status`, which is why
// this now carries both columns rather than conflating them.
export interface DispatchOrder {
  id: string;
  restaurant_id: string;
  restaurant_name?: string;
  status: OrderStatus;
  dispatch_status?: OrderDispatchStatus;
  rider_id?: string | null;
  rider_name?: string | null;
  delivery_address?: string;
  total_kobo: number;
  delivery_fee_kobo: number;
  ready_at?: string | null;
  created_at: string;
  waiting_minutes?: number;
}

/** Query for the paged rider roster (GET /api/restaurant/admin/riders). */
export interface AdminRiderQuery {
  status?: RiderStatus;
  vehicle?: 'bike' | 'car' | 'foot';
  q?: string;
  sort?: 'recent' | 'name' | 'rating';
  limit?: number;
  offset?: number;
}

/** A page of the rider roster plus counts over the whole filtered set. */
export interface AdminRiderPage {
  items: Rider[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  /**
   * Every rider status and its count under the current filters EXCLUDING the
   * status filter itself — so the board's tiles keep reporting the platform, not
   * whichever 25 riders are on screen.
   */
  statusCounts: Record<RiderStatus, number>;
}

/** Query for the paged dispatch queue (GET /api/restaurant/admin/dispatch/queue). */
export interface AdminDispatchQuery {
  dispatch?: OrderDispatchStatus;
  q?: string;
  restaurantId?: string;
  stalled?: boolean;
  sort?: 'waiting' | 'newest' | 'oldest';
  limit?: number;
  offset?: number;
}

/** A page of the dispatch queue plus aggregates over the whole filtered set. */
export interface AdminDispatchPage {
  items: DispatchOrder[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  dispatchCounts: Record<OrderDispatchStatus, number>;
  /** Still searching, past the threshold — counted server-side, never per page. */
  stalledTotal: number;
  /**
   * The SERVER's stall threshold. Rendered rather than hardcoded, so the console
   * and the backend cannot disagree about what "stalled" means.
   */
  stalledAfterMinutes: number;
}

// ── Restaurant onboarding / KYC review queue ─────────────────────────────────
export type OnboardingStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export interface OnboardingDoc {
  kind: 'cac' | 'food_permit' | 'id' | 'bank_proof' | 'menu' | 'other';
  label: string;
  url: string;
  verified?: boolean;
}

export interface RestaurantApplication {
  id: string;
  restaurant_name: string;
  owner_id: string;
  owner_name?: string;
  email?: string;
  phone?: string;
  cuisine?: string;
  address?: string;
  cac_number?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_name?: string;
  documents: OnboardingDoc[];
  status: OnboardingStatus;
  submitted_at: string;
  reviewed_at?: string | null;
  reviewer_id?: string | null;
  review_note?: string | null;
}

// ── Payout runs (restaurant settlement + rider earnings) ─────────────────────
export type PayeeType = 'restaurant' | 'rider';
export type PayoutRunStatus = 'draft' | 'pending' | 'processing' | 'paid' | 'failed';

export interface PayoutLine {
  id: string;
  payee_id: string;
  payee_name: string;
  payee_type: PayeeType;
  orders_count: number;
  gross_kobo: number;      // sum of settled order value attributable to payee
  fees_kobo: number;       // platform commission / withheld
  net_kobo: number;        // gross - fees  → amount to disburse
  bank_account?: string;
  status: PayoutRunStatus;
}

export interface PayoutRun {
  id: string;
  payee_type: PayeeType;
  period_start: string;
  period_end: string;
  status: PayoutRunStatus;
  lines_count: number;
  total_net_kobo: number;
  created_at: string;
  processed_at?: string | null;
  // reconciliation: does the sum of line nets equal the ledger-settled total?
  ledger_settled_kobo?: number;
  reconciled?: boolean;
}

// ── Refunds & disputes queue (money path) ────────────────────────────────────
export type DisputeStatus = 'open' | 'in_review' | 'resolved' | 'closed';
export type DisputeResolution = 'refunded' | 'settled' | 'dismissed';
export type DisputeType =
  | 'non_delivery'
  | 'wrong_item'
  | 'no_show'
  | 'failed_payment'
  | 'quality'
  | 'other';

export interface OrderDispute {
  id: string;
  order_id: string;
  restaurant_id?: string;
  restaurant_name?: string;
  customer_id: string;
  reference: string;          // order/transaction ref (backend `reference`)
  module_type: 'food';        // backend `module_type`
  type: DisputeType;
  description: string;
  evidence_urls?: string[];
  order_total_kobo: number;
  refundable_kobo: number;    // max refundable (order value less consumed)
  status: DisputeStatus;
  resolution?: DisputeResolution | null;
  admin_note?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ResolveDisputeRequest {
  resolution: DisputeResolution;
  admin_note: string;         // REQUIRED reviewer note (money-path audit)
  refund_kobo?: number;       // when resolution === 'refunded'
}
