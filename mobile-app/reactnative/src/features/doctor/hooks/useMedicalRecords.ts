// ── Doctor — Medical Records hooks (Batch 6, Section W) ──────────────────────
// Query keys under ['doctor', 'records', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 2 record-hub hook (usePatientRecordHub in
// useRecords.ts) for the full aggregated record; this file adds the records
// dashboard, per-patient category index, restriction warnings and the
// download / share / access-request flows.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRecordsDashboard,
  getPatientRecordIndex,
  getRecordRestrictions,
  getRestrictedRecordWarnings,
  getRecordShares,
  downloadPatientRecord,
  sharePatientRecordWithSpecialist,
  requestRecordAccess,
  DEMO_RECORDS_DASHBOARD,
  DEMO_PATIENT_RECORD_INDEX,
  DEMO_RECORD_RESTRICTIONS,
  DEMO_RESTRICTED_WARNINGS,
  DEMO_RECORD_SHARES,
} from '@/api/doctor.batch6.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  DownloadPatientRecordInput,
  SharePatientRecordInput,
  RequestRecordAccessInput,
} from '@/types/doctor.batch6';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useRecordsDashboard() {
  return useQuery({
    queryKey:        ['doctor', 'records', 'dashboard'],
    queryFn:         getRecordsDashboard,
    placeholderData: DEMO_RECORDS_DASHBOARD,
    staleTime:       30_000,
  });
}

export function usePatientRecordIndex(patientId: string) {
  return useQuery({
    queryKey:        ['doctor', 'records', 'index', patientId],
    queryFn:         () => getPatientRecordIndex(patientId),
    enabled:         !!patientId,
    placeholderData: DEMO_PATIENT_RECORD_INDEX,
    staleTime:       30_000,
  });
}

export function useRecordRestrictions(patientId: string) {
  return useQuery({
    queryKey:        ['doctor', 'records', 'restrictions', patientId],
    queryFn:         () => getRecordRestrictions(patientId),
    enabled:         !!patientId,
    placeholderData: DEMO_RECORD_RESTRICTIONS,
    staleTime:       60_000,
  });
}

export function useRestrictedRecordWarnings(patientId: string) {
  return useQuery({
    queryKey:        ['doctor', 'records', 'restricted-warnings', patientId],
    queryFn:         () => getRestrictedRecordWarnings(patientId),
    enabled:         !!patientId,
    placeholderData: DEMO_RESTRICTED_WARNINGS,
    staleTime:       60_000,
  });
}

export function useRecordShares() {
  return useQuery({
    queryKey:        ['doctor', 'records', 'shares'],
    queryFn:         getRecordShares,
    placeholderData: DEMO_RECORD_SHARES,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useDownloadPatientRecord() {
  return useMutation({
    mutationFn: (input: Omit<DownloadPatientRecordInput, 'idempotencyKey'>) =>
      downloadPatientRecord({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useSharePatientRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SharePatientRecordInput, 'idempotencyKey'>) =>
      sharePatientRecordWithSpecialist({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'records', 'shares'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'records', 'dashboard'] });
    },
  });
}

export function useRequestRecordAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestRecordAccessInput, 'idempotencyKey'>) =>
      requestRecordAccess({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'records', 'restrictions', vars.patientId] });
    },
  });
}
