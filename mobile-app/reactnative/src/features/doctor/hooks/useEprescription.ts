// ── Doctor — Batch 3 · Section K · e-prescription hooks ───────────────────────
// Rich e-prescription (drug lines, strengths/forms, alternatives, safety
// warnings, lifecycle, digital-signature issue, cancel, share, send-to-pharmacy,
// refill consultation, audit trail). Reads use the DEMO_* exports as
// placeholderData; mutations auto-generate the Idempotency-Key.
// REUSES Phase 1 `useCreatePrescription`, `usePrescriptions`, `usePrescription`
// (from `useClinical`) and Phase 2 `useReviewRefill` (from `usePharmacy`) — those
// are not re-declared here. `checkPrescriptionWarnings`, `searchDrugCatalogue`
// and `getDrugAlternatives` are pure helpers re-exported for the UI.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getIssuedPrescription,
  issuePrescription,
  cancelPrescription,
  sharePrescription,
  sendToPharmacy,
  requestRefillConsultation,
  DEMO_ISSUED_PRESCRIPTION,
} from '@/api/doctor.batch3.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  IssuePrescriptionInput,
  CancelPrescriptionInput,
  SharePrescriptionInput,
  SendToPharmacyInput,
  RequestRefillConsultationInput,
} from '@/types/doctor.batch3';

// Re-export the pure helpers so the UI can import them from the hook module.
export {
  checkPrescriptionWarnings,
  searchDrugCatalogue,
  getDrugAlternatives,
} from '@/api/doctor.batch3.api';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useIssuedPrescription(id: string) {
  return useQuery({
    queryKey:        ['doctor', 'issued-prescription', id],
    queryFn:         () => getIssuedPrescription(id),
    enabled:         !!id,
    placeholderData: DEMO_ISSUED_PRESCRIPTION,
    staleTime:       30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useIssuePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<IssuePrescriptionInput, 'idempotencyKey'>) =>
      issuePrescription({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'issued-prescription', vars.prescriptionId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'prescriptions'] });
    },
  });
}

export function useCancelPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CancelPrescriptionInput, 'idempotencyKey'>) =>
      cancelPrescription({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'issued-prescription', vars.prescriptionId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'prescriptions'] });
    },
  });
}

export function useSharePrescription() {
  return useMutation({
    mutationFn: (input: Omit<SharePrescriptionInput, 'idempotencyKey'>) =>
      sharePrescription({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useSendToPharmacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendToPharmacyInput, 'idempotencyKey'>) =>
      sendToPharmacy({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'issued-prescription', vars.prescriptionId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-fulfilments'] });
    },
  });
}

export function useRequestRefillConsultation() {
  return useMutation({
    mutationFn: (input: Omit<RequestRefillConsultationInput, 'idempotencyKey'>) =>
      requestRefillConsultation({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}
