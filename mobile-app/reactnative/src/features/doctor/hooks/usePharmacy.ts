// ── Doctor — pharmacy fulfilment, drug delivery & refill hooks ────────────────
// Phase 2. Mirrors Phase 1 TanStack Query patterns: query keys under
// ['doctor', …], DEMO_* placeholderData, mutations auto-generate idempotencyKey
// and invalidate the affected keys.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPharmacyFulfilments,
  getPharmacyFulfilment,
  getDrugDeliveries,
  getDrugDelivery,
  getRefillRequests,
  getRefillRequest,
  reviewSubstitute,
  reviewRefill,
  DEMO_PHARMACY_FULFILMENTS,
  DEMO_DRUG_DELIVERIES,
  DEMO_REFILL_REQUESTS,
} from '@/api/doctor.phase2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  RefillStatus,
  ReviewSubstituteInput,
  ReviewRefillInput,
} from '@/types/doctor.phase2';

// ─── Pharmacy fulfilment / substitution ──────────────────────────────────────

export function usePharmacyFulfilments() {
  return useQuery({
    queryKey:        ['doctor', 'pharmacy-fulfilments'],
    queryFn:         getPharmacyFulfilments,
    placeholderData: DEMO_PHARMACY_FULFILMENTS,
    staleTime:       30_000,
  });
}

export function usePharmacyFulfilment(id: string) {
  return useQuery({
    queryKey: ['doctor', 'pharmacy-fulfilment', id],
    queryFn:  () => getPharmacyFulfilment(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function useReviewSubstitute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ReviewSubstituteInput, 'idempotencyKey'>) =>
      reviewSubstitute({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-fulfilments'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-fulfilment', vars.fulfilmentId] });
    },
  });
}

// ─── Drug delivery tracking ──────────────────────────────────────────────────

export function useDrugDeliveries() {
  return useQuery({
    queryKey:        ['doctor', 'drug-deliveries'],
    queryFn:         getDrugDeliveries,
    placeholderData: DEMO_DRUG_DELIVERIES,
    staleTime:       15_000,
  });
}

export function useDrugDelivery(fulfilmentId: string) {
  return useQuery({
    queryKey: ['doctor', 'drug-delivery', fulfilmentId],
    queryFn:  () => getDrugDelivery(fulfilmentId),
    enabled:  !!fulfilmentId,
    staleTime: 10_000,
  });
}

// ─── Refill approval ─────────────────────────────────────────────────────────

export function useRefillRequests(status?: RefillStatus) {
  return useQuery({
    queryKey:        ['doctor', 'refill-requests', status],
    queryFn:         () => getRefillRequests(status),
    placeholderData: DEMO_REFILL_REQUESTS,
    staleTime:       30_000,
  });
}

export function useRefillRequest(id: string) {
  return useQuery({
    queryKey: ['doctor', 'refill-request', id],
    queryFn:  () => getRefillRequest(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function useReviewRefill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ReviewRefillInput, 'idempotencyKey'>) =>
      reviewRefill({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'refill-requests'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'refill-request', vars.refillId] });
    },
  });
}
