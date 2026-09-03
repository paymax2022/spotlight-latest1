// ── Restaurant & Delivery — Data hooks ───────────────────────────────────────
// React Query hooks mirroring useMobility.ts so screens stay declarative and
// share caching / loading / error contracts. Money mutations attach
// Idempotency-Keys (generated here, never reused across retries by the caller).

import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as food from './api';
import { newIdempotencyKey, toFoodError } from './utils';
import type { OrderRole, OrderStatus, PlaceOrderRequest, RateOrderRequest, LatLng } from './types';
import { goneRestaurantIds } from './availability';

const KEY = 'food';

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * The paged restaurant list, with search and cuisine applied SERVER-side.
 *
 * Discovery is 2,016 open rows; the screens used to hold all of them and filter
 * locally. Paging without moving the filters too would have been worse than the
 * original: a search would only ever match the rows already downloaded.
 *
 * Returns the flattened list plus `total` (all matches, not just the loaded
 * ones) so a screen can honestly say "showing 20 of 137".
 */
export function useRestaurantSearch(params: food.RestaurantQuery = {}) {
  const { q = '', cuisine = '', sort, promo = false, featured = false, nearLat, nearLng, minPriceKobo, maxPriceKobo } = params;
  const query = useInfiniteQuery({
    // Every filter is in the key: a page fetched under one set of filters must
    // never be served for another. Coordinates are rounded to ~1km so the
    // normal GPS jitter between renders doesn't mint a fresh cache key (and a
    // fresh page-0 fetch) every time distance sort re-evaluates.
    queryKey: [KEY, 'restaurants', {
      q, cuisine, sort: sort ?? 'newest', promo, featured, minPriceKobo, maxPriceKobo,
      near: nearLat != null && nearLng != null ? `${nearLat.toFixed(2)},${nearLng.toFixed(2)}` : null,
    }],
    queryFn: ({ pageParam }) =>
      food.listRestaurants({ q, cuisine, sort, promo, featured, nearLat, nearLng, minPriceKobo, maxPriceKobo, offset: pageParam }),
    initialPageParam: 0,
    // Page by the offset the SERVER reports it served, never by a locally
    // accumulated count: the two diverge the moment a row is added or removed
    // between requests, which is how paged lists start skipping items.
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.items.length : undefined),
    staleTime: 30_000,
  });

  const pages = query.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((p) => p.items), [pages]);

  return {
    ...query,
    items,
    // The LAST page's count, not the first's: the total is re-read on every
    // request, so an older page carries a staler figure.
    total: pages?.[pages.length - 1]?.total ?? 0,
  };
}

export function useRestaurant(id?: string) {
  return useQuery({
    queryKey: [KEY, 'restaurant', id],
    queryFn: () => food.getRestaurant(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Curated horizontal row: restaurants with an active paid RESTAURANT_TOP placement. */
export function useFeaturedRestaurants(limit = 10) {
  const query = useQuery({
    queryKey: [KEY, 'featured', limit],
    queryFn: () => food.listRestaurants({ featured: true, sort: 'likes', limit, offset: 0 }),
    staleTime: 30_000,
  });
  return { ...query, items: query.data?.items ?? [] };
}

/**
 * Curated horizontal row: nearest restaurants. Mirrors the ?view=nearby
 * fallback already used below — real proximity once `coords` resolves,
 * degrading to the kitchen-speed proxy (never empty) until then.
 */
export function useNearbyRestaurants(coords: LatLng | null, limit = 10) {
  const near = coords ? `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}` : null;
  const query = useQuery({
    queryKey: [KEY, 'nearby', near, limit],
    queryFn: () =>
      coords
        ? food.listRestaurants({ sort: 'distance', nearLat: coords.lat, nearLng: coords.lng, limit, offset: 0 })
        : food.listRestaurants({ sort: 'eta', limit, offset: 0 }),
    staleTime: 30_000,
  });
  return { ...query, items: query.data?.items ?? [] };
}

/** Optimistic like/unlike toggle; patches every cached page and detail read, rolls back on error. */
export function useToggleRestaurantLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      liked ? food.likeRestaurant(id) : food.unlikeRestaurant(id),
    onMutate: async ({ id, liked }) => {
      await qc.cancelQueries({ queryKey: [KEY] });

      const patch = <T extends { id: string; liked: boolean; likeCount: number }>(r: T): T =>
        r.id === id && r.liked !== liked
          ? { ...r, liked, likeCount: Math.max(0, r.likeCount + (liked ? 1 : -1)) }
          : r;

      // Paged discovery lists (useInfiniteQuery → {pages: RestaurantPage[]}) —
      // covers the main list, Featured row, and Near By row (all keyed under
      // [KEY, 'restaurants'/'featured'/'nearby']).
      qc.getQueriesData<{ items: { id: string; liked: boolean; likeCount: number }[] }>({
        queryKey: [KEY, 'featured'],
      }).forEach(([key, data]) => data && qc.setQueryData(key, { ...data, items: data.items.map(patch) }));
      qc.getQueriesData<{ items: { id: string; liked: boolean; likeCount: number }[] }>({
        queryKey: [KEY, 'nearby'],
      }).forEach(([key, data]) => data && qc.setQueryData(key, { ...data, items: data.items.map(patch) }));
      qc.getQueriesData<{ pages: food.RestaurantPage[]; pageParams: unknown[] }>({
        queryKey: [KEY, 'restaurants'],
      }).forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData(key, { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(patch) })) });
      });

      // Single-restaurant detail reads.
      qc.getQueriesData<{ id: string; liked: boolean; likeCount: number }>({
        queryKey: [KEY, 'restaurant', id],
      }).forEach(([key, data]) => data && qc.setQueryData(key, patch(data)));

      return {};
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'restaurants'] });
      qc.invalidateQueries({ queryKey: [KEY, 'featured'] });
      qc.invalidateQueries({ queryKey: [KEY, 'nearby'] });
      qc.invalidateQueries({ queryKey: [KEY, 'restaurant', vars.id] });
    },
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
/**
 * Which of the cart's restaurants still exist.
 *
 * Every id is checked, not just the ones that need naming: a kitchen can be
 * perfectly nameable from a captured line and still have been deleted since.
 * Same query key as useRestaurant, so a restaurant already fetched costs nothing.
 *
 * `retry: false` because a 404 is not going to become a 200, and a cart's worth
 * of dead ids should not retry-storm checkout. That also means a single transient
 * failure lands here as an error — which is exactly why classifyAvailability
 * insists on a 404 status before anything is removed.
 */
export function useCartRestaurantAvailability(ids: string[]): string[] {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: [KEY, 'restaurant', id],
      queryFn: () => food.getRestaurant(id),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const gone = goneRestaurantIds(ids, results);
  // Stable identity: this feeds an effect that mutates the cart, and a fresh
  // array every render would re-fire it forever.
  return useMemo(() => gone, [gone.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
}

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

/**
 * The caller's orders for one role.
 *
 * `pollMs` exists so a screen with a live socket can keep a SLOW poll as a
 * safety net instead of choosing between 6s-forever and nothing: the merchant
 * queue backs off to 60s once its socket connects. Defaults to the original 6s,
 * so every existing caller is unchanged.
 */
export function useOrders(role: OrderRole, options?: { poll?: boolean; pollMs?: number }) {
  return useQuery({
    queryKey: [KEY, 'orders', role],
    queryFn: () => food.listOrders(role),
    refetchInterval: options?.poll ? (options.pollMs ?? 6_000) : false,
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
