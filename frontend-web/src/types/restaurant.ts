// Restaurant/food-delivery domain types.
//
// These mirror the Go backend's wire shapes VERBATIM (snake_case field names,
// integer kobo amounts) — see backend/internal/restaurant/model.go,
// delivery.go, deliveryfee.go, ratings.go. Unlike the mobile app, frontend-web
// has no camelCase normalization layer, so these types intentionally match
// the JSON exactly rather than a "nicer" shape.
//
// One deliberate exception: the restaurant Paystack-checkout rail
// (backend/internal/restaurant/paystackcheckout/model.go) really is
// camelCase on the wire — a different subsystem than the rest of this
// module — so RestaurantPaystackIntent/-Status below keep that casing too.

export type Kobo = number;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Restaurant {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  address: string;
  logo_url?: string | null;
  is_open: boolean;
  rating: number;
  cuisine?: string;
  distance_meters?: number | null;
  created_at: string;
  min_order_kobo: Kobo;
  packaging_fee_kobo: Kobo;
  prep_time_minutes: number;
  geo_lat?: number | null;
  geo_lng?: number | null;
  has_promo: boolean;
  is_featured?: boolean;
  like_count: number;
  liked?: boolean;
}

export interface RestaurantPage {
  restaurants: Restaurant[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface MenuItem {
  id: string;
  category_id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  price_kobo: Kobo;
  image_url?: string | null;
  is_available: boolean;
  dietary_tags?: string[];
}

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  items: MenuItem[];
}

export interface RestaurantDetail {
  restaurant: Restaurant;
  categories: MenuCategory[];
}

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

export interface DeliveryFeeBreakdown {
  distance_km: number;
  eta_minutes: number;
  base_kobo: Kobo;
  distance_kobo: Kobo;
  time_kobo: Kobo;
  surge_kobo: Kobo;
  night_kobo: Kobo;
  weather_kobo: Kobo;
  handling_kobo: Kobo;
  promo_kobo: Kobo;
  total_kobo: Kobo;
}

export interface DeliveryQuote {
  delivery_fee_kobo: Kobo;
  flat_fallback: boolean;
  breakdown?: DeliveryFeeBreakdown;
}

export interface OrderItemModifier {
  modifier_id: string;
  name: string;
  price_delta_kobo: Kobo;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  name: string;
  price_kobo: Kobo;
  quantity: number;
  modifiers_kobo: Kobo;
  modifiers?: OrderItemModifier[];
  subtotal_kobo: Kobo;
}

export interface Order {
  id: string;
  customer_id: string;
  restaurant_id: string;
  rider_id?: string | null;
  items: OrderItem[];
  subtotal_kobo: Kobo;
  delivery_kobo: Kobo;
  tip_kobo: Kobo;
  surge_kobo: Kobo;
  service_fee_kobo: Kobo;
  packaging_fee_kobo: Kobo;
  package_count: number;
  special_instructions?: string;
  discount_kobo: Kobo;
  promo_id?: string | null;
  total_kobo: Kobo;
  status: OrderStatus;
  delivery_address: string;
  dispatch_status: string;
  delivery_code?: string | null;
  pickup_code?: string | null;
  distance_meters?: number | null;
  eta_minutes?: number | null;
  delivery_breakdown?: DeliveryFeeBreakdown | null;
  created_at: string;
  // Not on the Go model, but convenient to carry alongside an order in the UI —
  // populated client-side from context (the restaurant we fetched it from) when
  // available; never sent back to the server.
  restaurant_name?: string;
}

export interface OrderItemInput {
  menu_item_id: string;
  quantity: number;
}

export interface PlaceOrderRequest {
  items: OrderItemInput[];
  delivery_address: string;
  delivery_lat?: number;
  delivery_lng?: number;
  delivery_location?: LatLng;
  special_instructions?: string;
  package_count?: number;
}

export interface OrderRating {
  id: string;
  order_id: string;
  rater_id: string;
  restaurant_id: string;
  restaurant_stars: number;
  rider_id?: string;
  rider_stars?: number | null;
  comment?: string;
}

export interface RateOrderRequest {
  restaurant_stars: number;
  rider_stars?: number;
  comment?: string;
}

// ── Cart (persisted via /api/v1/food/cart) ──────────────────────────────────
//
// V1 keeps this deliberately simple: one restaurant, one package. The backend
// supports multi-package/multi-restaurant carts (see PlaceOrderRequest.
// PackageCount and OrderItemInput.RestaurantID), but that's a larger UX this
// module doesn't need yet — see the PR description for the explicit scope cut.

export interface CartLine {
  menu_item_id: string;
  name: string;
  price_kobo: Kobo;
  quantity: number;
}

export interface Cart {
  restaurant_id: string;
  restaurant_name: string;
  lines: CartLine[];
}

// ── Restaurant Paystack checkout (camelCase — see module doc comment) ──────

export interface RestaurantPaystackIntent {
  restaurantId: string;
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
  amountKobo: Kobo;
}

export type RestaurantPaystackStatusValue =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'amount_mismatch'
  | 'order_failed'
  | 'refunded';

export interface RestaurantPaystackStatus {
  reference: string;
  status: RestaurantPaystackStatusValue;
  orderId?: string;
  amountKobo?: Kobo;
}
