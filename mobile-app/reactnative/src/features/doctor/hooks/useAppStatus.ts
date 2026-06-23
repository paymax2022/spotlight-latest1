// ── Doctor — App & Account Status hooks (Batch 7, Section AD) ─────────────────
// Query keys under ['doctor', 'app-status'] / ['doctor', 'account-status']. These
// drive the maintenance / forced-update banners and the pending/rejected/
// suspended/under-review account gates. Edge states themselves are pure
// descriptors (EDGE_STATES / getEdgeState in doctor.batch7.api) consumed directly
// by StateView — there is no read for them. `useEdgeState` is a thin convenience
// wrapper around the pure helper.

import { useQuery } from '@tanstack/react-query';
import {
  getAppStatus,
  getAccountStatus,
  getEdgeState,
  DEMO_APP_STATUS,
  DEMO_ACCOUNT_STATUS,
} from '@/api/doctor.batch7.api';
import type { EdgeStateKind, EdgeStateDescriptor } from '@/types/doctor.batch7';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useAppStatus() {
  return useQuery({
    queryKey:        ['doctor', 'app-status'],
    queryFn:         getAppStatus,
    placeholderData: DEMO_APP_STATUS,
    staleTime:       60_000,
    refetchInterval: 300_000, // poll for maintenance / forced-update changes
  });
}

export function useAccountStatus() {
  return useQuery({
    queryKey:        ['doctor', 'account-status'],
    queryFn:         getAccountStatus,
    placeholderData: DEMO_ACCOUNT_STATUS,
    staleTime:       30_000,
  });
}

// ─── Pure helper wrapper ──────────────────────────────────────────────────────
// Not a query — resolves synchronously from the descriptor map so screens can
// render a consistent empty/error/edge state without a network round-trip.
export function useEdgeState(kind: EdgeStateKind): EdgeStateDescriptor {
  return getEdgeState(kind);
}
