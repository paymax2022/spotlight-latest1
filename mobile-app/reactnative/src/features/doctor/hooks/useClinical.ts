// ── Doctor — prescriptions, lab orders/results & HMO eligibility hooks ────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPrescriptions,
  getPrescription,
  getLabOrders,
  getLabResult,
  getHmoEligibility,
  createPrescription,
  createLabOrder,
  markLabResultReviewed,
} from '@/api/doctor.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  CreatePrescriptionInput,
  CreateLabOrderInput,
  MarkLabResultReviewedInput,
} from '@/types/doctor';

export function usePrescriptions() {
  return useQuery({
    queryKey: ['doctor', 'prescriptions'],
    queryFn:  getPrescriptions,
    staleTime: 30_000,
  });
}

export function usePrescription(id: string) {
  return useQuery({
    queryKey: ['doctor', 'prescription', id],
    queryFn:  () => getPrescription(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function useLabOrders() {
  return useQuery({
    queryKey: ['doctor', 'lab-orders'],
    queryFn:  getLabOrders,
    staleTime: 30_000,
  });
}

export function useLabResult(orderId: string) {
  return useQuery({
    queryKey: ['doctor', 'lab-result', orderId],
    queryFn:  () => getLabResult(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  });
}

export function useHmoEligibility(appointmentId: string) {
  return useQuery({
    queryKey: ['doctor', 'hmo-eligibility', appointmentId],
    queryFn:  () => getHmoEligibility(appointmentId),
    enabled:  !!appointmentId,
    staleTime: 30_000,
  });
}

export function useCreatePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreatePrescriptionInput, 'idempotencyKey'>) =>
      createPrescription({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'prescriptions'] });
    },
  });
}

export function useCreateLabOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateLabOrderInput, 'idempotencyKey'>) =>
      createLabOrder({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-orders'] });
    },
  });
}

export function useMarkLabResultReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MarkLabResultReviewedInput, 'idempotencyKey'>) =>
      markLabResultReviewed({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-result', vars.resultId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'lab-orders'] });
    },
  });
}
