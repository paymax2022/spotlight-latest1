// Phase 3. Vet dashboard / mode toggle, pet profile, pet prescription, pet lab
// orders & results, and pet store recommendations. Reads use the DEMO_* exports
// as placeholderData in mock mode only; mutations auto-generate the Idempotency-Key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getVetDashboard,
  getPetProfile,
  getPetPrescription,
  getPetLabOrders,
  getPetLabResult,
  getPetProducts,
  getPetRecommendations,
  toggleVetMode,
  createPetPrescription,
  createPetLabOrder,
  markPetLabResultReviewed,
  recommendProducts,
  DEMO_VET_DASHBOARD,
  DEMO_PET_PROFILE,
  DEMO_PET_PRESCRIPTION,
  DEMO_PET_LAB_ORDERS,
  DEMO_PET_PRODUCTS,
  DEMO_PET_RECOMMENDATIONS,
} from '@/api/doctor.phase3.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
// DEMO_* placeholders only in mock mode: a live build must never render (or act on) invented rows.
import { DOCTOR_USE_MOCK } from '@/api/doctor.client';
import type {
  ToggleVetModeInput,
  CreatePetPrescriptionInput,
  CreatePetLabOrderInput,
  MarkPetLabResultReviewedInput,
  RecommendProductsInput,
} from '@/types/doctor.phase3';

export function useVetDashboard() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'dashboard'],
    queryFn:         getVetDashboard,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_VET_DASHBOARD : undefined,
    staleTime:       30_000,
  });
}

export function useToggleVetMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ToggleVetModeInput, 'idempotencyKey'>) =>
      toggleVetMode({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'dashboard'] });
    },
  });
}

export function usePetProfile(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'pet', petId],
    queryFn:         () => getPetProfile(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_PROFILE : undefined,
    staleTime:       30_000,
  });
}

export function usePetPrescription(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'pet', petId, 'prescription'],
    queryFn:         () => getPetPrescription(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_PRESCRIPTION : undefined,
    staleTime:       30_000,
  });
}

export function useCreatePetPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreatePetPrescriptionInput, 'idempotencyKey'>) =>
      createPetPrescription({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'pet', vars.petId, 'prescription'] });
    },
  });
}

export function usePetLabOrders() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'lab-orders'],
    queryFn:         getPetLabOrders,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_LAB_ORDERS : undefined,
    staleTime:       30_000,
  });
}

export function usePetLabResult(orderId: string) {
  return useQuery({
    queryKey:  ['doctor', 'vet', 'lab-result', orderId],
    queryFn:   () => getPetLabResult(orderId),
    enabled:   !!orderId,
    staleTime: 30_000,
  });
}

export function useCreatePetLabOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreatePetLabOrderInput, 'idempotencyKey'>) =>
      createPetLabOrder({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'lab-orders'] });
    },
  });
}

export function useMarkPetLabResultReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MarkPetLabResultReviewedInput, 'idempotencyKey'>) =>
      markPetLabResultReviewed({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'lab-result', vars.resultId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'lab-orders'] });
    },
  });
}

export function usePetProducts(category?: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'products', category],
    queryFn:         () => getPetProducts(category),
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_PRODUCTS : undefined,
    staleTime:       60_000,
  });
}

export function usePetRecommendations(petId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'pet', petId, 'recommendations'],
    queryFn:         () => getPetRecommendations(petId),
    enabled:         !!petId,
    placeholderData: DOCTOR_USE_MOCK ? DEMO_PET_RECOMMENDATIONS : undefined,
    staleTime:       30_000,
  });
}

export function useRecommendProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RecommendProductsInput, 'idempotencyKey'>) =>
      recommendProducts({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'pet', vars.petId, 'recommendations'] });
    },
  });
}
