// ── Restaurant & Delivery — Data hooks ───────────────────────────────────────
// React Query hooks mirroring useMobility.ts so screens stay declarative and
// share caching / loading / error contracts. Money mutations attach
// Idempotency-Keys (generated here, never reused across retries by the caller).

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as food from './api';
import { newIdempotencyKey, toFoodError } from './utils';
import type { OrderRole, OrderStatus, PlaceOrderRequest, RateOrderRequest, LatLng } from './types';

const KEY = 'food';

// ─── Discovery ────────────────────────────────────────────────────────────────
export function useRestaurants() {
  return useQuery({ queryKey: [KEY, 'restaurants'], queryFn: food.listRestaurants, staleTime: 30_000 });
}

export function useRestaurant(id?: string) {
  return useQuery({
    queryKey: [KEY, 'restaurant', id],
    queryFn: () => food.getRestaurant(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/**
 * Names for restaurants the discovery list cannot supply.
 *
 * Discovery is `WHERE is_open = TRUE` (ListOpenRestaurants), so a CLOSED
 * restaurant is absent from it — 31 of 697 at the time of writing. A cart can
 * outlive a restaurant's opening hours, so a hydrated cart holding an item from
 * one had no way to name that section and fell back to "Restaurant N". The
 * detail endpoint has no such filter (`WHERE id=$1`), so it can still name it.
 *
 * Deliberately per-id and only for ids nothing else resolved: for a cart whose
 * restaurants are all open this issues no requests at all. Same query key as
 * useRestaurant, so anything already fetched is served from cache.
 */
export function useRestaurantNames(ids: string[]): Map<string, string> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: [KEY, 'restaurant', id],
      queryFn: () => food.getRestaurant(id),
      staleTime: 5 * 60_000,
      // A name is cosmetic — never retry-storm checkout to get one.
      retry: false,
    })),
  });

  const names = new Map<string, string>();
  results.forEach((r, i) => {
    const name = r.data?.name?.trim();
    if (name) names.set(ids[i], name);
  });
  return names;
}

/**
 * Distance/time-based delivery-fee quote, keyed by (restaurantId, lat, lng) so
 * react-query dedupes/caches each picked drop-off (no manual debounce needed).
 * Enabled only once a coordinate is available. The quote is an ESTIMATE — the
 * server recomputes the authoritative fee on placeOrder.
 */
export function useDeliveryQuote(restaurantId?: string, coords?: LatLng | null) {
  return useQuery({
    queryKey: [KEY, 'delivery-quote', restaurantId, coords?.lat, coords?.lng],
    queryFn: () =>
      food.getDeliveryQuote(restaurantId as string, {
        lat: (coords as LatLng).lat,
        lng: (coords as LatLng).lng,
      }),
    enabled: Boolean(restaurantId && coords),
    staleTime: 60_000,
  });
}

// ─── Orders ───────────────────────────────────────────────────────────────────
export function useOrder(orderId?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'order', orderId],
    queryFn: () => food.getOrder(orderId as string),
    enabled: Boolean(orderId),
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useOrders(role: OrderRole, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'orders', role],
    queryFn: () => food.listOrders(role),
    refetchInterval: options?.poll ? 6_000 : false,
    staleTime: 5_000,
  });
}

/** Place an order — money mutation → Idempotency-Key generated per attempt. */
export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<PlaceOrderRequest, 'idempotencyKey'>) =>
      food.placeOrder({ ...req, idempotencyKey: newIdempotencyKey('food-order') }),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'orders', 'customer'] });
    },
  });
}

export function useSetOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      restaurantId,
      orderId,
      status,
    }: {
      restaurantId: string;
      orderId: string;
      status: OrderStatus;
    }) => food.setOrderStatus(restaurantId, orderId, status),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', vars.orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ restaurantId, orderId }: { restaurantId: string; orderId: string }) =>
      food.cancelOrder(restaurantId, orderId),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', vars.orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

export function useRateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, req }: { orderId: string; req: RateOrderRequest }) =>
      food.rateOrder(orderId, req),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', vars.orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export function useMessages(orderId?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'messages', orderId],
    queryFn: () => food.getMessages(orderId as string),
    enabled: Boolean(orderId),
    // Poll as the fallback when the realtime socket is unavailable (e.g. mock).
    refetchInterval: options?.poll ? 5_000 : false,
    staleTime: 1_000,
  });
}

export function useSendMessage(orderId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      body,
      senderRole = 'customer',
      attachmentUrl,
    }: {
      body: string;
      senderRole?: 'customer' | 'restaurant' | 'rider';
      attachmentUrl?: string | null;
    }) => food.sendMessage(orderId as string, body, senderRole, attachmentUrl),
    onSuccess: () => {
      if (orderId) qc.invalidateQueries({ queryKey: [KEY, 'messages', orderId] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RIDER hooks
// ═══════════════════════════════════════════════════════════════════════════════
export function useRiderOffers(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'rider', 'offers'],
    queryFn: food.getRiderOffers,
    refetchInterval: options?.poll ? 8_000 : false,
    staleTime: 5_000,
  });
}

export function useRiderActive(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'rider', 'active'],
    queryFn: food.getRiderActive,
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => food.acceptOffer(orderId, newIdempotencyKey('food-accept')),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'rider', 'offers'] });
      qc.invalidateQueries({ queryKey: [KEY, 'rider', 'active'] });
    },
  });
}

/** Restaurant assigns a rider to a ready order. */
export function useAssignRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => food.assignRider(orderId, newIdempotencyKey('food-assign')),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: (_d, orderId) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

export function usePostRiderLocation() {
  return useMutation({
    mutationFn: ({ orderId, loc }: { orderId: string; loc: LatLng }) =>
      food.postRiderLocation(orderId, loc),
  });
}

/** Rider confirms pickup at the restaurant → order becomes picked_up. */
export function useConfirmPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => food.confirmPickup(orderId),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: (_d, orderId) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'rider', 'active'] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

/** Rider confirms handoff with the customer's delivery code → settles the order. */
export function useConfirmHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, code }: { orderId: string; code: string }) =>
      food.confirmHandoff(orderId, code),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', vars.orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'rider', 'active'] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

/** Owner re-dispatch — re-trigger auto-dispatch for a still-searching order. */
export function useRedispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => food.redispatch(orderId),
    onError: (e) => {
      throw toFoodError(e);
    },
    onSuccess: (_d, orderId) => {
      qc.invalidateQueries({ queryKey: [KEY, 'order', orderId] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}
