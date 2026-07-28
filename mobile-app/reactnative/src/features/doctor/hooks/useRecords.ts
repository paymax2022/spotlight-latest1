// ── Doctor — advanced medical records, HMO claims & follow-up hooks ───────────
// Phase 2. Query keys under ['doctor', …]; mutations auto-generate the
// idempotencyKey and invalidate the affected keys.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPatientRecordHub,
  getHmoClaims,
  getHmoClaim,
  getFollowUps,
  getFollowUp,
  submitClaim,
  disputeClaim,
  createFollowUp,
  reviewFollowUpRequest,
  DEMO_HMO_CLAIMS,
  DEMO_FOLLOW_UPS,
} from '@/api/doctor.phase2.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  ClaimStatus,
  FollowUpStatus,
  SubmitClaimInput,
  DisputeClaimInput,
  CreateFollowUpInput,
  ReviewFollowUpRequestInput,
} from '@/types/doctor.phase2';

// ─── Advanced medical records ────────────────────────────────────────────────

export function usePatientRecordHub(patientId: string) {
  return useQuery({
    queryKey: ['doctor', 'record-hub', patientId],
    queryFn:  () => getPatientRecordHub(patientId),
    enabled:  !!patientId,
    staleTime: 30_000,
  });
}

// ─── HMO claim tracking ──────────────────────────────────────────────────────

export function useHmoClaims(status?: ClaimStatus) {
  return useQuery({
    queryKey:        ['doctor', 'hmo-claims', status],
    queryFn:         () => getHmoClaims(status),
    placeholderData: DEMO_HMO_CLAIMS,
    staleTime:       30_000,
  });
}

export function useHmoClaim(id: string) {
  return useQuery({
    queryKey: ['doctor', 'hmo-claim', id],
    queryFn:  () => getHmoClaim(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function useSubmitClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SubmitClaimInput, 'idempotencyKey'>) =>
      submitClaim({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'hmo-claims'] });
    },
  });
}

export function useDisputeClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DisputeClaimInput, 'idempotencyKey'>) =>
      disputeClaim({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'hmo-claims'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'hmo-claim', vars.claimId] });
    },
  });
}

// ─── Patient follow-up plans ─────────────────────────────────────────────────

export function useFollowUps(status?: FollowUpStatus) {
  return useQuery({
    queryKey:        ['doctor', 'follow-ups', status],
    queryFn:         () => getFollowUps(status),
    placeholderData: DEMO_FOLLOW_UPS,
    staleTime:       30_000,
  });
}

export function useFollowUp(id: string) {
  return useQuery({
    queryKey: ['doctor', 'follow-up', id],
    queryFn:  () => getFollowUp(id),
    enabled:  !!id,
    staleTime: 30_000,
  });
}

export function useCreateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateFollowUpInput, 'idempotencyKey'>) =>
      createFollowUp({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'follow-ups'] });
    },
  });
}

export function useReviewFollowUpRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ReviewFollowUpRequestInput, 'idempotencyKey'>) =>
      reviewFollowUpRequest({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'follow-ups'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'follow-up', vars.followUpId] });
    },
  });
}
