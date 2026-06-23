// ── Doctor — HMO / Insurance hooks (Batch 4, Section O) ──────────────────────
// Query keys under ['doctor', …]. Mutations auto-generate the idempotencyKey and
// invalidate the relevant lists. REUSE: HMO claim hooks (useHmoClaims /
// useSubmitClaim / useDisputeClaim) live in `usePatientReview`/Phase 2 — these
// add plan coverage, pre-auth, covered services, support chat and fraud warnings.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getHmoPlanCoverage,
  getPreAuthRequests,
  getPreAuthRequest,
  getCoveredServices,
  getHmoSupportThread,
  getHmoFraudWarnings,
  requestPreAuth,
  sendHmoSupportMessage,
  acknowledgeFraudWarning,
  DEMO_HMO_PLAN_COVERAGE,
  DEMO_PRE_AUTH_REQUESTS,
  DEMO_COVERED_SERVICES,
  DEMO_HMO_SUPPORT_THREAD,
  DEMO_HMO_FRAUD_WARNINGS,
} from '@/api/doctor.batch4.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  PreAuthStatus,
  RequestPreAuthInput,
  SendHmoSupportMessageInput,
  AcknowledgeFraudWarningInput,
} from '@/types/doctor.batch4';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useHmoPlanCoverage(patientId: string) {
  return useQuery({
    queryKey:        ['doctor', 'hmo-plan-coverage', patientId],
    queryFn:         () => getHmoPlanCoverage(patientId),
    enabled:         !!patientId,
    placeholderData: DEMO_HMO_PLAN_COVERAGE,
    staleTime:       60_000,
  });
}

export function usePreAuthRequests(status?: PreAuthStatus) {
  return useQuery({
    queryKey:        ['doctor', 'pre-auth-requests', status],
    queryFn:         () => getPreAuthRequests(status),
    placeholderData: DEMO_PRE_AUTH_REQUESTS,
    staleTime:       30_000,
  });
}

export function usePreAuthRequest(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'pre-auth-request', id],
    queryFn:   () => getPreAuthRequest(id),
    enabled:   !!id,
    staleTime: 30_000,
  });
}

export function useCoveredServices(patientId?: string) {
  return useQuery({
    queryKey:        ['doctor', 'covered-services', patientId],
    queryFn:         () => getCoveredServices(patientId),
    placeholderData: DEMO_COVERED_SERVICES,
    staleTime:       30_000,
  });
}

export function useHmoSupportThread(threadId: string) {
  return useQuery({
    queryKey:        ['doctor', 'hmo-support-thread', threadId],
    queryFn:         () => getHmoSupportThread(threadId),
    enabled:         !!threadId,
    placeholderData: DEMO_HMO_SUPPORT_THREAD,
    staleTime:       15_000,
  });
}

export function useHmoFraudWarnings() {
  return useQuery({
    queryKey:        ['doctor', 'hmo-fraud-warnings'],
    queryFn:         getHmoFraudWarnings,
    placeholderData: DEMO_HMO_FRAUD_WARNINGS,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useRequestPreAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestPreAuthInput, 'idempotencyKey'>) =>
      requestPreAuth({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'pre-auth-requests'] });
    },
  });
}

export function useSendHmoSupportMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendHmoSupportMessageInput, 'idempotencyKey'>) =>
      sendHmoSupportMessage({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'hmo-support-thread', vars.threadId] });
    },
  });
}

export function useAcknowledgeFraudWarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AcknowledgeFraudWarningInput, 'idempotencyKey'>) =>
      acknowledgeFraudWarning({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'hmo-fraud-warnings'] });
    },
  });
}
