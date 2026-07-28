// ── Doctor — Pet Store / Vet-Recommended Products hooks (Batch 5, Section V) ──
// Query keys under ['doctor', 'vet', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 3 `usePetProducts` / `usePetRecommendations`
// / `useRecommendProducts` (useVet.ts) for search + recommend; this file adds
// product detail, fulfilment/delivery tracking and the share-with-owner action.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPetProductDetail,
  getPetProductFulfilments,
  getPetProductFulfilment,
  shareProductWithOwner,
  DEMO_PET_PRODUCT_DETAIL,
  DEMO_PET_PRODUCT_FULFILMENTS,
} from '@/api/doctor.batch5.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { ShareProductWithOwnerInput } from '@/types/doctor.batch5';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function usePetProductDetail(productId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'product-detail', productId],
    queryFn:         () => getPetProductDetail(productId),
    enabled:         !!productId,
    placeholderData: DEMO_PET_PRODUCT_DETAIL,
    staleTime:       60_000,
  });
}

export function usePetProductFulfilments() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'fulfilments'],
    queryFn:         getPetProductFulfilments,
    placeholderData: DEMO_PET_PRODUCT_FULFILMENTS,
    staleTime:       30_000,
  });
}

export function usePetProductFulfilment(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'vet', 'fulfilment', id],
    queryFn:   () => getPetProductFulfilment(id),
    enabled:   !!id,
    staleTime: 30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useShareProductWithOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ShareProductWithOwnerInput, 'idempotencyKey'>) =>
      shareProductWithOwner({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'fulfilments'] });
    },
  });
}
