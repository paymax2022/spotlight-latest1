// ── Doctor — Pet E-Prescription hooks (Batch 5, Section T) ───────────────────
// Query keys under ['doctor', 'vet', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 3 `useCreatePetPrescription` (from useVet.ts)
// for creating the draft; this file adds the issue / send-to-pharmacy / refill
// pieces and re-exports the pure helpers `computePetDosage` + `checkPetRxWarnings`
// for UI import.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPetPharmacies,
  getIssuedPetPrescription,
  getPetRefillRequests,
  issuePetPrescription,
  sendPetRxToPharmacy,
  requestPetRefill,
  reviewPetRefill,
  computePetDosage,
  checkPetRxWarnings,
  DEMO_PET_PHARMACIES,
  DEMO_ISSUED_PET_PRESCRIPTION,
  DEMO_PET_REFILL_REQUESTS,
} from '@/api/doctor.batch5.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  IssuePetPrescriptionInput,
  SendPetRxToPharmacyInput,
  RequestPetRefillInput,
  ReviewPetRefillInput,
} from '@/types/doctor.batch5';

// Re-export the pure helpers so UI imports them from the hook layer.
export { computePetDosage, checkPetRxWarnings } from '@/api/doctor.batch5.api';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function usePetPharmacies() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'pharmacies'],
    queryFn:         getPetPharmacies,
    placeholderData: DEMO_PET_PHARMACIES,
    staleTime:       60_000,
  });
}

export function useIssuedPetPrescription(prescriptionId: string) {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'issued-prescription', prescriptionId],
    queryFn:         () => getIssuedPetPrescription(prescriptionId),
    enabled:         !!prescriptionId,
    placeholderData: DEMO_ISSUED_PET_PRESCRIPTION,
    staleTime:       30_000,
  });
}

export function usePetRefillRequests() {
  return useQuery({
    queryKey:        ['doctor', 'vet', 'refills'],
    queryFn:         getPetRefillRequests,
    placeholderData: DEMO_PET_REFILL_REQUESTS,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useIssuePetPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<IssuePetPrescriptionInput, 'idempotencyKey'>) =>
      issuePetPrescription({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'issued-prescription', vars.prescriptionId] });
    },
  });
}

export function useSendPetRxToPharmacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendPetRxToPharmacyInput, 'idempotencyKey'>) =>
      sendPetRxToPharmacy({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'issued-prescription', vars.prescriptionId] });
    },
  });
}

export function useRequestPetRefill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestPetRefillInput, 'idempotencyKey'>) =>
      requestPetRefill({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'refills'] });
    },
  });
}

export function useReviewPetRefill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ReviewPetRefillInput, 'idempotencyKey'>) =>
      reviewPetRefill({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'vet', 'refills'] });
    },
  });
}
