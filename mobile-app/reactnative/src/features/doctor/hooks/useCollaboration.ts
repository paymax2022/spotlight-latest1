// ── Doctor — Referral & Specialist Collaboration hooks (Batch 4, Section P) ───
// Query keys under ['doctor', …]. Mutations auto-generate the idempotencyKey and
// invalidate the relevant lists. REUSE: outgoing referrals + specialists live in
// `useReferrals` (useReferrals / useReferral / useCreateReferral / useSpecialists)
// — these add INCOMING referrals (accept/reject), opinion requests, care-team
// chat and the shared case summary.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getIncomingReferrals,
  getIncomingReferral,
  getOpinionRequests,
  getOpinionRequest,
  getCareTeamThread,
  getSharedCaseSummary,
  acceptReferral,
  rejectReferral,
  requestOpinion,
  sendCareTeamMessage,
  DEMO_INCOMING_REFERRALS,
  DEMO_OPINION_REQUESTS,
  DEMO_CARE_TEAM_THREAD,
  DEMO_SHARED_CASE_SUMMARY,
} from '@/api/doctor.batch4.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  IncomingReferralStatus,
  OpinionStatus,
  AcceptReferralInput,
  RejectReferralInput,
  RequestOpinionInput,
  SendCareTeamMessageInput,
} from '@/types/doctor.batch4';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useIncomingReferrals(status?: IncomingReferralStatus) {
  return useQuery({
    queryKey:        ['doctor', 'incoming-referrals', status],
    queryFn:         () => getIncomingReferrals(status),
    placeholderData: DEMO_INCOMING_REFERRALS,
    staleTime:       30_000,
  });
}

export function useIncomingReferral(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'incoming-referral', id],
    queryFn:   () => getIncomingReferral(id),
    enabled:   !!id,
    staleTime: 30_000,
  });
}

export function useOpinionRequests(status?: OpinionStatus) {
  return useQuery({
    queryKey:        ['doctor', 'opinion-requests', status],
    queryFn:         () => getOpinionRequests(status),
    placeholderData: DEMO_OPINION_REQUESTS,
    staleTime:       30_000,
  });
}

export function useOpinionRequest(id: string) {
  return useQuery({
    queryKey:  ['doctor', 'opinion-request', id],
    queryFn:   () => getOpinionRequest(id),
    enabled:   !!id,
    staleTime: 30_000,
  });
}

export function useCareTeamThread(threadId: string) {
  return useQuery({
    queryKey:        ['doctor', 'care-team-thread', threadId],
    queryFn:         () => getCareTeamThread(threadId),
    enabled:         !!threadId,
    placeholderData: DEMO_CARE_TEAM_THREAD,
    staleTime:       15_000,
  });
}

export function useSharedCaseSummary(caseRef: string) {
  return useQuery({
    queryKey:        ['doctor', 'shared-case-summary', caseRef],
    queryFn:         () => getSharedCaseSummary(caseRef),
    enabled:         !!caseRef,
    placeholderData: DEMO_SHARED_CASE_SUMMARY,
    staleTime:       30_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useAcceptReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AcceptReferralInput, 'idempotencyKey'>) =>
      acceptReferral({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'incoming-referrals'] });
    },
  });
}

export function useRejectReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RejectReferralInput, 'idempotencyKey'>) =>
      rejectReferral({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'incoming-referrals'] });
    },
  });
}

export function useRequestOpinion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RequestOpinionInput, 'idempotencyKey'>) =>
      requestOpinion({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'opinion-requests'] });
    },
  });
}

export function useSendCareTeamMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SendCareTeamMessageInput, 'idempotencyKey'>) =>
      sendCareTeamMessage({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['doctor', 'care-team-thread', vars.threadId] });
    },
  });
}
