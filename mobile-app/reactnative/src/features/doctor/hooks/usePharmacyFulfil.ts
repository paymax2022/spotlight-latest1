// ── Doctor — Batch 3 · Section L · pharmacy & drug fulfilment hooks ────────────
// Pharmacy directory (nearby / preferred), drug stock availability, pharmacy
// clarification chat, delivery alerts, patient-received confirmation and
// pharmacy complaints. Reads use the DEMO_* exports as placeholderData;
// mutations auto-generate the Idempotency-Key.
// REUSES Phase 2 `usePharmacyFulfilments`, `usePharmacyFulfilment`,
// `useDrugDeliveries`, `useDrugDelivery`, `useReviewSubstitute` (substitute
// approve/reject) from `usePharmacy` — those are NOT re-declared here. Substitute
// request/approve/reject reuse `useReviewSubstitute`.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPharmacies,
  getPreferredPharmacy,
  getDrugStock,
  getPharmacyMessages,
  getDeliveryAlerts,
  selectPharmacy,
  sendPharmacyMessage,
  confirmPatientReceived,
  reportPharmacy,
  DEMO_PHARMACIES,
  DEMO_PHARMACY_MESSAGES,
  DEMO_DELIVERY_ALERTS,
} from '@/api/doctor.batch3.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SelectPharmacyInput,
  SendPharmacyMessageInput,
  ConfirmPatientReceivedInput,
  ReportPharmacyInput,
} from '@/types/doctor.batch3';

// ─── Reads ───────────────────────────────────────────────────────────────────

export function usePharmacies(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'pharmacies', patientId],
    queryFn:         () => getPharmacies(patientId),
    placeholderData: DEMO_PHARMACIES,
    staleTime:       60_000,
  });
}

export function usePreferredPharmacy(patientId?: string) {
  return useQuery({
    queryKey:  ['doctor', 'preferred-pharmacy', patientId],
    queryFn:   () => getPreferredPharmacy(patientId),
    staleTime: 60_000,
  });
}

export function useDrugStock(pharmacyId: string) {
  return useQuery({
    queryKey:  ['doctor', 'drug-stock', pharmacyId],
    queryFn:   () => getDrugStock(pharmacyId),
    enabled:   !!pharmacyId,
    staleTime: 30_000,
  });
}

export function usePharmacyMessages(fulfilmentId: string) {
  return useQuery({
    queryKey:        ['doctor', 'pharmacy-messages', fulfilmentId],
    queryFn:         () => getPharmacyMessages(fulfilmentId),
    enabled:         !!fulfilmentId,
    placeholderData: DEMO_PHARMACY_MESSAGES.filter((m) => m.fulfilmentId === fulfilmentId),
    staleTime:       10_000,
  });
}

export function useDeliveryAlerts() {
  return useQuery({
    queryKey:        ['doctor', 'delivery-alerts'],
    queryFn:         getDeliveryAlerts,
    placeholderData: DEMO_DELIVERY_ALERTS,
    staleTime:       15_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useSelectPharmacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SelectPharmacyInput, 'idempotencyKey'>) =>
      selectPharmacy({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-fulfilments'] });
    },
  });
}

export function useSendPharmacyMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendPharmacyMessageInput, 'idempotencyKey'>) =>
      sendPharmacyMessage({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-messages', vars.fulfilmentId] });
    },
  });
}

export function useConfirmPatientReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ConfirmPatientReceivedInput, 'idempotencyKey'>) =>
      confirmPatientReceived({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-fulfilment', vars.fulfilmentId] });
      qc.invalidateQueries({ queryKey: ['doctor', 'pharmacy-fulfilments'] });
    },
  });
}

export function useReportPharmacy() {
  return useMutation({
    mutationFn: (input: Omit<ReportPharmacyInput, 'idempotencyKey'>) =>
      reportPharmacy({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}
