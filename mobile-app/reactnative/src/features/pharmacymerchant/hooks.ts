// ── Pharmacy merchant — react-query hooks ────────────────────────────────────
//
// Mirrors the restaurantmerchant hooks: one namespace key, and every mutation
// invalidates it so the inbox and the open order agree after an action.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as pharm from './api';

const KEY = 'pharmacymerchant';

/** The owner's order inbox, optionally narrowed to one state. */
export function usePharmacyOrders(state?: string) {
  return useQuery({
    queryKey: [KEY, 'orders', state ?? 'all'],
    queryFn: () => pharm.listOrders(state),
    // Short: a pharmacist watches this while working the counter.
    staleTime: 15_000,
  });
}

/** The owner's earnings. Same namespace, so an action refreshes it too. */
export function usePharmacyEarnings() {
  return useQuery({
    queryKey: [KEY, 'earnings'],
    queryFn: pharm.getEarnings,
    staleTime: 15_000,
  });
}

export function usePharmacyOrder(id?: string) {
  return useQuery({
    queryKey: [KEY, 'order', id],
    queryFn: () => pharm.getOrder(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

/**
 * The fulfilment actions.
 *
 * Each generates its own Idempotency-Key per attempt. These advance a guarded
 * state machine and the last one releases money from escrow, so a double-tap
 * must not be able to double-apply — react-query's isPending disables the button,
 * and the key makes a retry that DID reach the server a no-op rather than a
 * second transition.
 */
export function usePharmacyOrderAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      action: 'confirm' | 'dispense' | 'dispatch' | 'complete';
      method?: 'DELIVERY' | 'PICKUP';
      pickupCode?: string;
    }) => {
      const key = pharm.newIdempotencyKey(`${input.action}-${id}`);
      switch (input.action) {
        case 'confirm':
          return pharm.confirmOrder(id, key);
        case 'dispense':
          return pharm.dispenseOrder(id, key);
        case 'dispatch':
          return pharm.dispatchOrder(id, input.method ?? 'DELIVERY', key);
        case 'complete':
          return pharm.completeOrder(id, input.pickupCode, key);
      }
    },
    // Invalidate the whole namespace: an action changes the order AND its place
    // in the inbox, and a stale inbox would offer an action already taken.
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
