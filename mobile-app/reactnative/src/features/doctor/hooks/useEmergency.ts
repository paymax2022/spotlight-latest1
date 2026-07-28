// ── Doctor — Emergency & Escalation hooks (Batch 4, Section R) ───────────────
// Query keys under ['doctor', …]. Mutations auto-generate the idempotencyKey.
// NOTE: all emergency data/actions are DEMO and non-actionable (no real dialing
// or dispatch); screens must surface the emergency disclaimer.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEmergencyFacilities,
  getRedFlagAlerts,
  getEmergencyEscalations,
  getEmergencyCaseRecords,
  getEmergencyCaseRecord,
  escalateToHospital,
  escalateToAmbulance,
  notifyEmergencyContact,
  documentEmergencyCase,
  scheduleEmergencyFollowUp,
  DEMO_EMERGENCY_FACILITIES,
  DEMO_RED_FLAG_ALERTS,
  DEMO_EMERGENCY_ESCALATIONS,
  DEMO_EMERGENCY_CASE_RECORDS,
} from '@/api/doctor.batch4.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  EmergencyFacility,
  EscalateInput,
  NotifyEmergencyContactInput,
  DocumentEmergencyCaseInput,
  ScheduleEmergencyFollowUpInput,
} from '@/types/doctor.batch4';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useEmergencyFacilities(kind?: EmergencyFacility['kind']) {
  return useQuery({
    queryKey:        ['doctor', 'emergency-facilities', kind],
    queryFn:         () => getEmergencyFacilities(kind),
    placeholderData: DEMO_EMERGENCY_FACILITIES,
    staleTime:       60_000,
  });
}

export function useRedFlagAlerts(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'red-flag-alerts', patientId],
    queryFn:         () => getRedFlagAlerts(patientId),
    placeholderData: DEMO_RED_FLAG_ALERTS,
    staleTime:       30_000,
  });
}

export function useEmergencyEscalations(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'emergency-escalations', patientId],
    queryFn:         () => getEmergencyEscalations(patientId),
    placeholderData: DEMO_EMERGENCY_ESCALATIONS,
    staleTime:       15_000,
  });
}

export function useEmergencyCaseRecords(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'emergency-cases', patientId],
    queryFn:         () => getEmergencyCaseRecords(patientId),
    placeholderData: DEMO_EMERGENCY_CASE_RECORDS,
    staleTime:       30_000,
  });
}

export function useEmergencyCaseRecord(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'emergency-case', id],
    queryFn:   () => getEmergencyCaseRecord(id),
    enabled:   !!id,
    staleTime: 30_000,
  });
}

// ─── Mutations (DEMO — non-actionable) ───────────────────────────────────────

export function useEscalateToHospital() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EscalateInput, 'idempotencyKey'>) =>
      escalateToHospital({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'emergency-escalations'] });
    },
  });
}

export function useEscalateToAmbulance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EscalateInput, 'idempotencyKey'>) =>
      escalateToAmbulance({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'emergency-escalations'] });
    },
  });
}

export function useNotifyEmergencyContact() {
  return useMutation({
    mutationFn: (input: Omit<NotifyEmergencyContactInput, 'idempotencyKey'>) =>
      notifyEmergencyContact({ ...input, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useDocumentEmergencyCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DocumentEmergencyCaseInput, 'idempotencyKey'>) =>
      documentEmergencyCase({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'emergency-cases'] });
    },
  });
}

export function useScheduleEmergencyFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ScheduleEmergencyFollowUpInput, 'idempotencyKey'>) =>
      scheduleEmergencyFollowUp({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'follow-ups'] });
    },
  });
}
