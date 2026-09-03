// ── Restaurant & Delivery — Domain types ─────────────────────────────────────
// All money is integer kobo (never floats). Mirrors the mobility/parcel type
// conventions. The order state machine is shared across the customer, rider, and
// restaurant roles; chat + realtime frames are typed here too.

export type Kobo = number;

export interface LatLng {
  lat: number;
  lng: number;
}

// ─── Restaurant + menu ──────────────────────────────────────────────────────
export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  tags: string[];
  rating: number;
  ratingCount?: number;
  /** Human ETA string, e.g. "20–30 min". */
  etaLabel: string;
  /** Minimum order in kobo. */
  minOrderKobo: Kobo;
  /**
   * Flat delivery fee in kobo, when one is known.
   *
   * OPTIONAL because the live discovery DTO has no such field and `restaurants`
   * has no such column — the real fee is distance-based and comes from the
   * delivery-quote endpoint. Only the mock sets it. It was previously required,
   * so every live restaurant read `undefined ?? 0` and the UI rendered a
   * confident ₦0 for a fee nobody had quoted. Treat absent as UNKNOWN, never as
   * free.
   */
  deliveryFeeKobo?: Kobo;
  /**
   * Price of one mandatory take-away pack, in kobo. The customer pays for one
   * pack per food item so the restaurant can package the order; charged on
   * every order and not removable. Server-supplied; never computed in the app.
   */
  packagingFeeKobo: Kobo;
  promo?: string | null;
  /** Lucide icon name + tint, for the icon-tile visual. */
  icon: string;
  iconColor: string;
  iconBg: string;
  isOpen: boolean;
  address?: string;
  location?: LatLng | null;
  /** Live COUNT(*) of likes — never client-computed, always server-supplied. */
  likeCount: number;
  /** Whether the authenticated caller has liked this restaurant. */
  liked: boolean;
  /** Active paid RESTAURANT_TOP placement, right now (see the Featured section). */
  isFeatured?: boolean;
}

/**
 * Food type drives takeaway-packing rules. A 'regular' item is a main/soup/rice/
 * drink: at most ONE distinct regular item per pack, capped at 2 portions. A
 * 'protein' item (meat/fish/chicken/…) is the exception: it may share a pack with
 * the main and with other proteins, and is NOT capped at 2.
 */
export type FoodType = 'regular' | 'protein';

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  priceKobo: Kobo;
  icon?: string;
  available: boolean;
  /** Defaults to 'regular' when omitted. */
  foodType?: FoodType;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface RestaurantDetail extends Restaurant {
  menu: MenuCategory[];
}

// ─── Cart (client-side only) ──────────────────────────────────────────────────
export interface CartLine {
  itemId: string;
  name: string;
  priceKobo: Kobo;
  qty: number;
  /** True for protein items (uncapped, may co-pack with the main). */
  isProtein?: boolean;
  /** Restaurant ID for this item (enables multi-restaurant orders). */
  restaurantId?: string;
  /**
   * Restaurant name, captured when the item was added.
   *
   * The cart already groups by `restaurantId`, but the store keeps only ONE
   * `restaurantName` — the first restaurant added — so checkout could name a
   * single section and fell back to "Restaurant 2/3/4" for the rest. The name
   * is available at add time, so recording it per line removes the guess.
   *
   * Optional because carts hydrated from storage or the server predate this
   * field; checkout resolves those from the discovery list instead.
   */
  restaurantName?: string;
}

/**
 * A takeaway package is the "mother" container: the user adds a package first,
 * then puts food into it. A single package may hold at most
 * MAX_SAME_FOOD_PER_PACKAGE (2) portions of the SAME food; to add a 3rd portion
 * the user adds another package. An order is the set of packages + their food.
 */
export interface CartPackage {
  id: string;        // local-only client id
  lines: CartLine[];
  /**
   * Which restaurant this pack belongs to.
   *
   * The cart is multi-restaurant and every LINE already carries its own
   * restaurantId; the pack — the container the user actually adds — did not, so
   * an empty pack could not be attributed to anything. Screens fell back to the
   * cart-level restaurantId, which is "whichever restaurant was added FIRST",
   * and an empty pack created anywhere else was invisible.
   *
   * Optional because carts persisted before this existed have packs without it;
   * those are matched by the old cart-level rule instead.
   */
  restaurantId?: string | null;
}

// ─── Order ──────────────────────────────────────────────────────────────────
// State machine: placed → accepted → preparing → ready → picked_up → delivered
// Terminal/edge: cancelled, no_rider (dispatch failed to assign a rider).
//
// The backend's owner-facing vocabulary (pending/confirmed/preparing/ready/
// picked_up/delivered/cancelled) is supported too — 'pending' aliases 'placed'
// and 'confirmed' aliases 'accepted'. Both are kept so neither the existing app
// code nor the live API breaks. Setting 'ready' now auto-dispatches riders
// server-side (no manual rider pick), surfaced via `dispatchStatus`.
export type OrderStatus =
  | 'placed'
  | 'pending'
  | 'accepted'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'
  | 'no_rider';

/**
 * Server-side dispatch lifecycle, independent of the order status. Marking an
 * order 'ready' flips this to 'searching' (auto-dispatch to nearby riders); a
 * rider accepting flips it to 'assigned'; handoff flips it to 'delivered'.
 */
export type DispatchStatus = 'none' | 'searching' | 'assigned' | 'delivered';

export interface OrderItem {
  itemId: string;
  name: string;
  qty: number;
  priceKobo: Kobo;
}

export interface RiderRef {
  id: string;
  name: string;
  phone?: string;
  vehicle?: string;
  rating?: number;
  location?: LatLng | null;
}

export interface Order {
  id: string;
  restaurantId: string;
  restaurantName: string;
  status: OrderStatus;
  items: OrderItem[];
  /** Server-computed price breakdown (kobo). */
  subtotalKobo: Kobo;
  deliveryFeeKobo: Kobo;
  serviceFeeKobo: Kobo;
  /** Mandatory take-away packaging total for the whole order (kobo). */
  packagingFeeKobo: Kobo;
  totalKobo: Kobo;
  deliveryAddress: string;
  deliveryLocation?: LatLng | null;
  restaurantLocation?: LatLng | null;
  rider?: RiderRef | null;
  /** Server-side dispatch lifecycle (auto-dispatch on 'ready'). */
  dispatchStatus?: DispatchStatus;
  /** Assigned rider id (server-supplied; mirrors backend `rider_id`). */
  riderId?: string | null;
  /**
   * Customer's handoff code. Shown to the customer when the order is ready /
   * picked up; the rider must enter it at the door to settle the order. Null
   * until a code is issued, and never exposed to non-participants by the server.
   */
  deliveryCode?: string | null;
  /** ISO timestamps. */
  createdAt: string;
  deliveredAt?: string | null;
  rated?: boolean;
  /** Customer-facing role label for the orders list. */
  role?: OrderRole;
}

export type OrderRole = 'customer' | 'restaurant' | 'rider';

// ─── Chat ─────────────────────────────────────────────────────────────────────
export type ChatSenderRole = OrderRole | 'system';

export interface ChatMessage {
  id: string;
  orderId: string;
  senderRole: ChatSenderRole;
  senderName?: string;
  body: string;
  attachmentUrl?: string | null;
  createdAt: string;
}

// ─── Rider offers ───────────────────────────────────────────────────────────
export interface RiderOffer {
  orderId: string;
  restaurantName: string;
  restaurantLocation?: LatLng | null;
  deliveryAddress: string;
  deliveryLocation?: LatLng | null;
  /** Rider payout for the run, in kobo. */
  payoutKobo: Kobo;
  distanceMeters?: number;
  itemCount: number;
}

// ─── Requests ───────────────────────────────────────────────────────────────
export interface PlaceOrderRequest {
  restaurantId: string;
  items: { itemId: string; qty: number; restaurantId?: string }[];   // aggregated across packages (for pricing/charge)
  /** Number of physical takeaway packages (drives the packaging fee). */
  packageCount?: number;
  /** Per-package breakdown so the restaurant knows how to pack the order. */
  packages?: { items: { itemId: string; qty: number }[] }[];
  deliveryAddress: string;
  deliveryLocation?: LatLng | null;
  idempotencyKey: string;
}

export interface RateOrderRequest {
  restaurantStars: number;
  riderStars?: number;
  comment?: string;
}

// ─── Realtime frames (WS) ───────────────────────────────────────────────────
export type OrderFrame =
  | { type: 'order.status'; payload: { order_id: string; status: OrderStatus } }
  | { type: 'order.location'; payload: { order_id: string; lat: number; lng: number } }
  | {
      type: 'order.message';
      payload: {
        id: string;
        order_id: string;
        sender_role: ChatSenderRole;
        sender_name?: string;
        body: string;
        attachment_url?: string | null;
        created_at: string;
      };
    };

// ─── Errors ─────────────────────────────────────────────────────────────────
export type FoodErrorCode =
  | 'NO_RIDER_FOUND'
  | 'BELOW_MIN_ORDER'
  | 'RESTAURANT_CLOSED'
  | 'ORDER_CANCELLED'
  | string;

export interface FoodError extends Error {
  code?: FoodErrorCode;
  status?: number;
}
