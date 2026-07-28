// ── Doctor — Follow-Up Care hooks (Batch 4, Section Q) ──────────────────────
// Query keys under ['doctor', …]. Mutations auto-generate the idempotencyKey and
// invalidate the relevant lists. REUSE: base follow-up CRUD (useFollowUps /
// useCreateFollowUp / useReviewFollowUpRequest) lives in Phase 2 — these add
// eligibility, long-term care plans, chronic monitoring and adherence checks.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFollowUpEligibility,
  getLongTermCarePlans,
  getLongTermCarePlan,
  getChronicMonitoring,
  getAdherenceChecks,
  setFollowUpReminder,
  completeFollowUp,
  recordAdherenceCheck,
  saveCarePlan,
  DEMO_FOLLOW_UP_ELIGIBILITY,
  DEMO_LONG_TERM_CARE_PLANS,
  DEMO_CHRONIC_MONITORING,
  DEMO_ADHERENCE_CHECKS,
} from '@/api/doctor.batch4.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SetFollowUpReminderInput,
  CompleteFollowUpInput,
  RecordAdherenceCheckInput,
  SaveCarePlanInput,
} from '@/types/doctor.batch4';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useFollowUpEligibility(patientId: string, appointmentId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'follow-up-eligibility', patientId, appointmentId],
    queryFn:         () => getFollowUpEligibility(patientId, appointmentId),
    enabled:         !!patientId,
    placeholderData: DEMO_FOLLOW_UP_ELIGIBILITY,
    staleTime:       30_000,
  });
}

export function useLongTermCarePlans(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'care-plans', patientId],
    queryFn:         () => getLongTermCarePlans(patientId),
    placeholderData: DEMO_LONG_TERM_CARE_PLANS,
    staleTime:       30_000,
  });
}

export function useLongTermCarePlan(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'care-plan', id],
    queryFn:   () => getLongTermCarePlan(id),
    enabled:   !!id,
    staleTime: 30_000,
  });
}

export function useChronicMonitoring(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'chronic-monitoring', patientId],
    queryFn:         () => getChronicMonitoring(patientId),
    placeholderData: DEMO_CHRONIC_MONITORING,
    staleTime:       30_000,
  });
}

export function useAdherenceChecks(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'adherence-checks', patientId],
    queryFn:         () => getAdherenceChecks(patientId),
    placeholderData: DEMO_ADHERENCE_CHECKS,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useSetFollowUpReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetFollowUpReminderInput, 'idempotencyKey'>) =>
      setFollowUpReminder({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'follow-ups'] });
    },
  });
}

export function useCompleteFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CompleteFollowUpInput, 'idempotencyKey'>) =>
      completeFollowUp({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'follow-ups'] });
    },
  });
}

export function useRecordAdherenceCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RecordAdherenceCheckInput, 'idempotencyKey'>) =>
      recordAdherenceCheck({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'adherence-checks'] });
    },
  });
}

export function useSaveCarePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveCarePlanInput, 'idempotencyKey'>) =>
      saveCarePlan({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'care-plans'] });
    },
  });
}
