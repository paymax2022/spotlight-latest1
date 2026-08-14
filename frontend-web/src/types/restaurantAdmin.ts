// ── Admin — Restaurant & Delivery types (mirror of backend/internal/finance/restaurant) ──
// All monetary amounts are integers in minor units (kobo). Never floats.

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'no_rider';

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

// An order that needs dispatch attention (ready / assigned / picked_up / no_rider).
export interface DispatchOrder {
  id: string;
  restaurant_id: string;
  restaurant_name?: string;
  status: OrderStatus;
  rider_id?: string | null;
  rider_name?: string | null;
  delivery_address?: string;
  total_kobo: number;
  delivery_fee_kobo: number;
  ready_at?: string | null;
  created_at: string;
  waiting_minutes?: number;
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
