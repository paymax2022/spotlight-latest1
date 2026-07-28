// ── Doctor — Batch 3 · Section M · lab test ordering hooks ─────────────────────
// Rich lab ordering (catalogue with sample type/fasting/price/turnaround, lab
// packages, lab providers, HMO-coverage check, urgency/collection options,
// share/cancel). Reads use the DEMO_* exports as placeholderData; mutations
// auto-generate the Idempotency-Key.
// REUSES Phase 1 `useCreateLabOrder`, `useLabOrders` (from `useClinical`) for the
// base order create/list — those are NOT re-declared here. `checkLabCoverage` is
// a pure helper re-exported for the UI.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLabCatalogue,
  getLabPackages,
  getLabProviders,
  getLabOrderRich,
  shareLabOrder,
  cancelLabOrder,
  DEMO_LAB_CATALOGUE,
  DEMO_LAB_PROVIDERS,
  DEMO_LAB_ORDER_RICH,
} from '@/api/doctor.batch3.api';
import { LAB_PACKAGES } from '@/features/doctor/constants/batch3';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  ShareLabOrderInput,
  CancelLabOrderInput,
} from '@/types/doctor.batch3';

// Re-export the pure coverage helper so the UI can import it from the hook module.
export { checkLabCoverage } from '@/api/doctor.batch3.api';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useLabCatalogue() {
  return useQuery({
    queryKey:        ['doctor', 'lab-catalogue'],
    queryFn:         getLabCatalogue,
    placeholderData: DEMO_LAB_CATALOGUE,
    staleTime:       300_000,
  });
}

export function useLabPackages() {
  return useQuery({
    queryKey:        ['doctor', 'lab-packages'],
    queryFn:         getLabPackages,
    placeholderData: LAB_PACKAGES,
    staleTime:       300_000,
  });
}

export function useLabProviders() {
  return useQuery({
    queryKey:        ['doctor', 'lab-providers'],
    queryFn:         getLabProviders,
    placeholderData: DEMO_LAB_PROVIDERS,
    staleTime:       60_000,
  });
}

export function useLabOrderRich(orderId: string) {
  return useQuery({
    queryKey:        ['doctor', 'lab-order-rich', orderId],
    queryFn:         () => getLabOrderRich(orderId),
    enabled:         !!orderId,
    placeholderData: DEMO_LAB_ORDER_RICH,
    staleTime:       30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useShareLabOrder() {
  return useMutation({
    mutationFn: (input: Omit<ShareLabOrderInput, 'idempotencyKey'>) =>
      shareLabOrder({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useCancelLabOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CancelLabOrderInput, 'idempotencyKey'>) =>
      cancelLabOrder({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-orders'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-order-rich', vars.orderId] });
    },
  });
}
