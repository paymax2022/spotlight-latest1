// ── Restaurant & Delivery — Mock data ────────────────────────────────────────
// Lets the whole flow run offline (EXPO_PUBLIC_FOOD_USE_MOCK !== 'false').
// A tiny in-memory store holds placed orders + chat so the customer, rider, and
// restaurant screens see a shared, advancing state machine. State auto-advances
// on read (advanceMockOrder) so the tracking screen's poll fallback shows motion.

import type {
  Restaurant,
  RestaurantDetail,
  MenuCategory,
  Order,
  OrderStatus,
  ChatMessage,
  RiderOffer,
  LatLng,
} from './types';

const LAGOS: LatLng = { lat: 6.5244, lng: 3.3792 };

/** A stable 4-digit customer handoff code (mock parity with the backend). */
function makeDeliveryCode(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export const MOCK_RESTAURANTS: Restaurant[] = [
  {
    id: 'r1',
    name: 'Mama Cass',
    cuisine: 'local',
    tags: ['Local', 'Soups'],
    rating: 4.8,
    ratingCount: 1240,
    etaLabel: '20–30 min',
    minOrderKobo: 250000,
    deliveryFeeKobo: 60000,
    packagingFeeKobo: 18000,
    promo: '10% off',
    icon: 'UtensilsCrossed',
    iconColor: '#EF4444',
    iconBg: 'rgba(239,68,68,0.08)',
    isOpen: true,
    address: '14 Adeola Odeku, Victoria Island',
    location: { lat: 6.4281, lng: 3.4219 },
  },
  {
    id: 'r2',
    name: 'Chicken Republic',
    cuisine: 'fast',
    tags: ['Fast Food', 'Chicken'],
    rating: 4.5,
    ratingCount: 980,
    etaLabel: '15–25 min',
    minOrderKobo: 150000,
    deliveryFeeKobo: 50000,
    packagingFeeKobo: 15000,
    promo: null,
    icon: 'Drumstick',
    iconColor: '#F97316',
    iconBg: 'rgba(249,115,22,0.08)',
    isOpen: true,
    address: '3 Allen Avenue, Ikeja',
    location: { lat: 6.6018, lng: 3.3515 },
  },
  {
    id: 'r3',
    name: 'Dragon Palace',
    cuisine: 'chinese',
    tags: ['Chinese', 'Rice'],
    rating: 4.6,
    ratingCount: 410,
    etaLabel: '25–40 min',
    minOrderKobo: 300000,
    deliveryFeeKobo: 80000,
    packagingFeeKobo: 20000,
    promo: 'Free delivery',
    icon: 'Soup',
    iconColor: '#48B8AC',
    iconBg: 'rgba(72,184,172,0.10)',
    isOpen: true,
    address: '22 Awolowo Road, Ikoyi',
    location: { lat: 6.4488, lng: 3.4316 },
  },
  {
    id: 'r4',
    name: 'The Grill House',
    cuisine: 'grills',
    tags: ['Grills', 'BBQ'],
    rating: 4.7,
    ratingCount: 560,
    etaLabel: '30–45 min',
    minOrderKobo: 400000,
    deliveryFeeKobo: 70000,
    packagingFeeKobo: 18000,
    promo: null,
    icon: 'Flame',
    iconColor: '#EAB308',
    iconBg: 'rgba(234,179,8,0.10)',
    isOpen: true,
    address: '9 Admiralty Way, Lekki Phase 1',
    location: { lat: 6.4452, lng: 3.4744 },
  },
  {
    id: 'r5',
    name: 'Green Bowl',
    cuisine: 'healthy',
    tags: ['Healthy', 'Salads'],
    rating: 4.9,
    ratingCount: 320,
    etaLabel: '20–30 min',
    minOrderKobo: 200000,
    deliveryFeeKobo: 55000,
    packagingFeeKobo: 15000,
    promo: '15% off',
    icon: 'Salad',
    iconColor: '#16A34A',
    iconBg: 'rgba(22,163,74,0.08)',
    isOpen: true,
    address: '5 Karimu Kotun, Victoria Island',
    location: { lat: 6.4302, lng: 3.4198 },
  },
  {
    id: 'r6',
    name: 'Street Buka',
    cuisine: 'local',
    tags: ['Local', 'Pepper Soup'],
    rating: 4.4,
    ratingCount: 210,
    etaLabel: '15–25 min',
    minOrderKobo: 100000,
    deliveryFeeKobo: 45000,
    packagingFeeKobo: 12000,
    promo: null,
    icon: 'CookingPot',
    iconColor: '#340075',
    iconBg: 'rgba(52,0,117,0.08)',
    isOpen: false,
    address: '17 Herbert Macaulay, Yaba',
    location: { lat: 6.5095, lng: 3.3711 },
  },
];

const MENU_BY_RESTAURANT: Record<string, MenuCategory[]> = {
  r1: [
    {
      id: 'c1',
      name: 'Soups & Swallow',
      items: [
        { id: 'i1', name: 'Egusi Soup + Pounded Yam', description: 'Melon seed soup with assorted meat', priceKobo: 320000, icon: 'Soup', available: true },
        { id: 'i2', name: 'Afang Soup + Eba', description: 'Rich vegetable soup', priceKobo: 350000, icon: 'Soup', available: true },
        { id: 'i3', name: 'Ogbono Soup + Fufu', description: 'Draw soup with goat meat', priceKobo: 330000, icon: 'Soup', available: false },
      ],
    },
    {
      id: 'c2',
      name: 'Rice',
      items: [
        { id: 'i4', name: 'Jollof Rice + Chicken', description: 'Smoky party jollof', priceKobo: 280000, icon: 'UtensilsCrossed', available: true },
        { id: 'i5', name: 'Fried Rice + Beef', description: 'Vegetable fried rice', priceKobo: 290000, icon: 'UtensilsCrossed', available: true },
      ],
    },
    {
      id: 'cP',
      name: 'Proteins (add to any pack)',
      items: [
        { id: 'p1', name: 'Goat Meat', description: 'Per piece', priceKobo: 80000, icon: 'Beef', available: true, foodType: 'protein' },
        { id: 'p2', name: 'Assorted Meat', description: 'Per piece', priceKobo: 90000, icon: 'Beef', available: true, foodType: 'protein' },
        { id: 'p3', name: 'Fried Fish', description: 'Per piece', priceKobo: 120000, icon: 'Fish', available: true, foodType: 'protein' },
        { id: 'p4', name: 'Grilled Chicken', description: 'Per piece', priceKobo: 110000, icon: 'Drumstick', available: true, foodType: 'protein' },
      ],
    },
    {
      id: 'c3',
      name: 'Drinks',
      items: [
        { id: 'i6', name: 'Chapman', description: 'House special, 50cl', priceKobo: 120000, icon: 'CupSoda', available: true },
        { id: 'i7', name: 'Bottled Water', priceKobo: 30000, icon: 'CupSoda', available: true },
      ],
    },
  ],
};

function defaultMenu(): MenuCategory[] {
  return [
    {
      id: 'c1',
      name: 'Mains',
      items: [
        { id: 'm1', name: 'Signature Combo', description: "Chef's special of the day", priceKobo: 350000, icon: 'UtensilsCrossed', available: true },
        { id: 'm2', name: 'Classic Plate', description: 'Served with sides', priceKobo: 280000, icon: 'UtensilsCrossed', available: true },
      ],
    },
    {
      id: 'cP',
      name: 'Proteins (add to any pack)',
      items: [
        { id: 'p1', name: 'Beef', description: 'Per piece', priceKobo: 80000, icon: 'Beef', available: true, foodType: 'protein' },
        { id: 'p2', name: 'Fish', description: 'Per piece', priceKobo: 110000, icon: 'Fish', available: true, foodType: 'protein' },
      ],
    },
    {
      id: 'c2',
      name: 'Sides & Drinks',
      items: [
        { id: 's1', name: 'Plantain', priceKobo: 100000, icon: 'CookingPot', available: true },
        { id: 's2', name: 'Soft Drink', priceKobo: 60000, icon: 'CupSoda', available: true },
      ],
    },
  ];
}

export function mockRestaurantDetail(id: string): RestaurantDetail {
  const base = MOCK_RESTAURANTS.find((r) => r.id === id) ?? MOCK_RESTAURANTS[0];
  return { ...base, menu: MENU_BY_RESTAURANT[id] ?? defaultMenu() };
}

// ─── In-memory order store ────────────────────────────────────────────────────
interface MockState {
  orders: Record<string, Order>;
  messages: Record<string, ChatMessage[]>;
  /** ms timestamp each order was last advanced. */
  advancedAt: Record<string, number>;
}

export const mockStore: MockState = { orders: {}, messages: {}, advancedAt: {} };

const MOCK_RIDER = {
  id: 'rider-1',
  name: 'Tunde A.',
  phone: '+2348012345678',
  vehicle: 'Bike • LAG-221-KJA',
  rating: 4.9,
  location: { ...LAGOS },
};

let orderSeq = 1;

export function makeOrder(
  partial: Partial<Order> & { restaurantId: string },
  opts?: { packageCount?: number },
): Order {
  const r = MOCK_RESTAURANTS.find((x) => x.id === partial.restaurantId) ?? MOCK_RESTAURANTS[0];
  const id = partial.id ?? `o${orderSeq++}-${Date.now().toString(36)}`;
  const items = partial.items ?? [];
  const subtotal = items.reduce((sum, it) => sum + it.priceKobo * it.qty, 0);
  const delivery = r.deliveryFeeKobo;
  const service = Math.round(subtotal * 0.05);
  // Mandatory take-away packaging: one pack fee PER takeaway package (the
  // container). Falls back to one pack per portion only if no package count was
  // supplied (legacy callers).
  const totalPortions = items.reduce((n, it) => n + it.qty, 0);
  const packCount = opts?.packageCount && opts.packageCount > 0 ? opts.packageCount : Math.max(1, totalPortions);
  const packaging = packCount * r.packagingFeeKobo;
  const order: Order = {
    id,
    restaurantId: r.id,
    restaurantName: r.name,
    status: partial.status ?? 'placed',
    items,
    subtotalKobo: partial.subtotalKobo ?? subtotal,
    deliveryFeeKobo: partial.deliveryFeeKobo ?? delivery,
    serviceFeeKobo: partial.serviceFeeKobo ?? service,
    packagingFeeKobo: partial.packagingFeeKobo ?? packaging,
    totalKobo: partial.totalKobo ?? subtotal + delivery + service + packaging,
    deliveryAddress: partial.deliveryAddress ?? 'My current location',
    deliveryLocation: partial.deliveryLocation ?? { lat: 6.45, lng: 3.46 },
    restaurantLocation: r.location ?? LAGOS,
    rider: partial.rider ?? null,
    // Dispatch starts idle; the customer's handoff code is issued at order time
    // (the backend escrows payment and returns delivery_code on the Order).
    dispatchStatus: partial.dispatchStatus ?? 'none',
    riderId: partial.riderId ?? null,
    deliveryCode: partial.deliveryCode ?? makeDeliveryCode(),
    createdAt: partial.createdAt ?? new Date().toISOString(),
    deliveredAt: partial.deliveredAt ?? null,
    rated: partial.rated ?? false,
    role: partial.role ?? 'customer',
  };
  mockStore.orders[id] = order;
  mockStore.advancedAt[id] = Date.now();
  if (!mockStore.messages[id]) {
    mockStore.messages[id] = [
      {
        id: `sys-${id}`,
        orderId: id,
        senderRole: 'system',
        body: `Payment confirmed and order placed with ${r.name}. You can chat with the restaurant and your rider here.`,
        createdAt: order.createdAt,
      },
    ];
  }
  return order;
}

// State machine progression used by the mock auto-advance. The kitchen runs
// itself (placed→accepted→preparing→ready). At 'ready' the server auto-dispatches
// (dispatch_status='searching'), so the customer tracking screen pauses on "Finding
// a rider" until a rider accepts — then the rider drives accept→pickup→handoff.
// To keep the customer screen demoable solo, a mock rider auto-accepts a short
// while after dispatch begins (ready→assigned), then en-route advances normally.
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: 'accepted',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'assigned',
  assigned: 'picked_up',
  picked_up: 'delivered',
};

/**
 * Auto-advance a mock order one step roughly every 6s so the tracking screen
 * shows live-ish motion without a backend. Reaching 'ready' begins dispatch
 * (dispatch_status='searching') + synthesizes a rider offer; a mock rider then
 * auto-accepts (assigned) and en-route nudges the rider marker toward drop-off.
 */
export function advanceMockOrder(id: string): Order {
  const order = mockStore.orders[id];
  if (!order) throw new Error('Order not found');
  const last = mockStore.advancedAt[id] ?? 0;
  // Dispatch search lingers a little longer so "Finding a rider…" is visible.
  const stepMs = order.status === 'ready' ? 9000 : 6000;
  if (Date.now() - last > stepMs) {
    const next = NEXT_STATUS[order.status];
    if (next) {
      order.status = next;
      mockStore.advancedAt[id] = Date.now();
      if (next === 'ready') {
        // Auto-dispatch kicks in server-side: surface as searching + an offer.
        order.dispatchStatus = 'searching';
        pushSystem(id, 'Your food is ready. Finding a nearby rider…');
      }
      if (next === 'assigned') {
        order.rider = { ...MOCK_RIDER, location: order.restaurantLocation ?? LAGOS };
        order.riderId = MOCK_RIDER.id;
        order.dispatchStatus = 'assigned';
        pushSystem(id, `${MOCK_RIDER.name} is your rider and is heading to ${order.restaurantName}.`);
      }
      if (next === 'delivered') {
        order.deliveredAt = new Date().toISOString();
        order.dispatchStatus = 'delivered';
        pushSystem(id, 'Your order has been delivered. Enjoy your meal!');
      }
    }
  }
  // Nudge rider marker toward the delivery point while en route.
  if ((order.status === 'assigned' || order.status === 'picked_up') && order.rider?.location && order.deliveryLocation) {
    const cur = order.rider.location;
    const dst = order.deliveryLocation;
    order.rider = {
      ...order.rider,
      location: { lat: cur.lat + (dst.lat - cur.lat) * 0.15, lng: cur.lng + (dst.lng - cur.lng) * 0.15 },
    };
  }
  return { ...order };
}

function pushSystem(orderId: string, body: string) {
  (mockStore.messages[orderId] ??= []).push({
    id: `sys-${orderId}-${Date.now()}`,
    orderId,
    senderRole: 'system',
    body,
    createdAt: new Date().toISOString(),
  });
}

export function mockMessages(orderId: string): ChatMessage[] {
  return [...(mockStore.messages[orderId] ?? [])];
}

export function pushMockMessage(
  orderId: string,
  senderRole: ChatMessage['senderRole'],
  body: string,
  attachmentUrl?: string | null,
): ChatMessage {
  const msg: ChatMessage = {
    id: `m-${orderId}-${Date.now()}`,
    orderId,
    senderRole,
    senderName: senderRole === 'customer' ? 'You' : senderRole === 'rider' ? 'Tunde A.' : 'Restaurant',
    body,
    attachmentUrl: attachmentUrl ?? null,
    createdAt: new Date().toISOString(),
  };
  (mockStore.messages[orderId] ??= []).push(msg);
  return msg;
}

// Seed a couple of historical orders so lists are never empty offline.
function seedHistory() {
  if (Object.keys(mockStore.orders).length) return;
  const past = makeOrder({
    id: 'o-seed-1',
    restaurantId: 'r2',
    items: [{ itemId: 'm1', name: 'Refuel Meal', qty: 1, priceKobo: 280000 }],
    deliveryAddress: '12 Bourdillon Road, Ikoyi',
  });
  past.status = 'delivered';
  past.rated = true;
  past.deliveredAt = new Date(Date.now() - 86_400_000).toISOString();
  past.createdAt = new Date(Date.now() - 86_400_000 - 3_600_000).toISOString();
}
seedHistory();

export function mockOrdersByRole(role: 'customer' | 'restaurant' | 'rider'): Order[] {
  const all = Object.values(mockStore.orders);
  let list = all;
  if (role === 'rider') list = all.filter((o) => o.rider);
  return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map((o) => ({ ...o, role }));
}

export function mockRiderOffers(): RiderOffer[] {
  // Auto-dispatch: surface 'ready' orders that are searching for a rider and
  // not yet assigned. This mirrors the server's auto-populated rider offers.
  const open = Object.values(mockStore.orders)
    .filter((o) => !o.rider && o.status === 'ready' && o.dispatchStatus === 'searching')
    .map<RiderOffer>((o) => ({
      orderId: o.id,
      restaurantName: o.restaurantName,
      restaurantLocation: o.restaurantLocation ?? null,
      deliveryAddress: o.deliveryAddress,
      deliveryLocation: o.deliveryLocation ?? null,
      payoutKobo: o.deliveryFeeKobo + 40000,
      distanceMeters: 3200,
      itemCount: o.items.reduce((n, it) => n + it.qty, 0),
    }));
  if (open.length) return open;
  return [
    {
      orderId: 'offer-demo',
      restaurantName: 'Chicken Republic',
      restaurantLocation: { lat: 6.6018, lng: 3.3515 },
      deliveryAddress: '8 Opebi Road, Ikeja',
      deliveryLocation: { lat: 6.585, lng: 3.357 },
      payoutKobo: 90000,
      distanceMeters: 2800,
      itemCount: 2,
    },
  ];
}

export function mockAcceptOffer(orderId: string): Order {
  let order = mockStore.orders[orderId];
  if (!order) {
    // The static demo offer has no backing order — synthesize a ready one.
    order = makeOrder({
      id: orderId,
      restaurantId: 'r2',
      items: [{ itemId: 'm1', name: 'Combo Meal', qty: 2, priceKobo: 280000 }],
      deliveryAddress: '8 Opebi Road, Ikeja',
      role: 'rider',
      status: 'ready',
      dispatchStatus: 'searching',
    });
  }
  // Rider accepts → order assigned, dispatch assigned, rider attached.
  order.status = 'assigned';
  order.dispatchStatus = 'assigned';
  order.rider = { ...MOCK_RIDER, location: order.restaurantLocation ?? LAGOS };
  order.riderId = MOCK_RIDER.id;
  order.role = 'rider';
  // Pause auto-advance so the rider drives pickup → handoff manually.
  mockStore.advancedAt[orderId] = Date.now() + 600_000;
  pushSystem(orderId, `${MOCK_RIDER.name} accepted the delivery.`);
  return { ...order };
}

/** Rider confirms pickup at the restaurant → picked_up. */
export function mockConfirmPickup(orderId: string): Order {
  const order = mockStore.orders[orderId];
  if (!order) throw new Error('Order not found');
  order.status = 'picked_up';
  if (!order.rider) order.rider = { ...MOCK_RIDER };
  order.riderId = order.rider.id;
  // Resume the en-route marker nudge but keep status-advance paused for handoff.
  mockStore.advancedAt[orderId] = Date.now() + 600_000;
  pushSystem(orderId, `${order.rider.name} picked up the order and is on the way.`);
  return { ...order };
}

/** Rider confirms handoff with the customer's code → delivered (settles). */
export function mockConfirmHandoff(orderId: string, code: string): Order {
  const order = mockStore.orders[orderId];
  if (!order) throw new Error('Order not found');
  if (!order.deliveryCode || code.trim() !== order.deliveryCode) {
    const err = new Error('Incorrect delivery code. Ask the customer to read it again.') as Error & {
      code?: string;
    };
    err.code = 'INVALID_DELIVERY_CODE';
    throw err;
  }
  order.status = 'delivered';
  order.dispatchStatus = 'delivered';
  order.deliveredAt = new Date().toISOString();
  mockStore.advancedAt[orderId] = Date.now() + 600_000;
  pushSystem(orderId, 'Delivery confirmed with the customer code. Order settled.');
  return { ...order };
}

/** Owner re-dispatch a still-searching ready order → keep searching + new offer. */
export function mockRedispatch(orderId: string): Order {
  const order = mockStore.orders[orderId];
  if (!order) throw new Error('Order not found');
  order.status = 'ready';
  order.dispatchStatus = 'searching';
  order.rider = null;
  order.riderId = null;
  mockStore.advancedAt[orderId] = Date.now();
  pushSystem(orderId, 'Re-dispatching to nearby riders…');
  return { ...order };
}

export function mockSetStatus(orderId: string, status: OrderStatus): Order {
  const order = mockStore.orders[orderId];
  if (!order) throw new Error('Order not found');
  order.status = status;
  mockStore.advancedAt[orderId] = Date.now() + 60_000; // pause auto-advance after a manual set
  if (status === 'delivered') {
    order.deliveredAt = new Date().toISOString();
    order.dispatchStatus = 'delivered';
  }
  // Marking ready auto-dispatches server-side: begin searching + create an offer.
  if (status === 'ready') {
    order.dispatchStatus = 'searching';
    order.rider = null;
    order.riderId = null;
    // Let the customer screen continue toward a rider auto-accepting shortly.
    mockStore.advancedAt[orderId] = Date.now();
    pushSystem(orderId, 'Order ready — finding a nearby rider…');
    return { ...order };
  }
  if (status === 'assigned' && !order.rider) {
    order.rider = { ...MOCK_RIDER };
    order.riderId = MOCK_RIDER.id;
    order.dispatchStatus = 'assigned';
  }
  pushSystem(orderId, `Status updated: ${status}.`);
  return { ...order };
}

export function mockCancel(orderId: string): Order {
  const order = mockStore.orders[orderId];
  if (!order) throw new Error('Order not found');
  order.status = 'cancelled';
  mockStore.advancedAt[orderId] = Date.now() + 600_000;
  pushSystem(orderId, 'Order cancelled.');
  return { ...order };
}
