// ── Registration — React Query data hooks ────────────────────────────────────
// Keeps screens declarative and shares caching / loading / error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as reg from '../api/registration.api';
import type { RegistrationStepKey, PickedUpload, RegistrationPaymentMethod } from '../types/registration.types';

const KEY = 'registration';

// ── Contests ──────────────────────────────────────────────────────────────────

export function useContests() {
  return useQuery({ queryKey: [KEY, 'contests'], queryFn: reg.listContests, staleTime: 60_000 });
}

// ── Applications ────────────────────────────────────────────────────────────

export function useMyApplications() {
  return useQuery({ queryKey: [KEY, 'applications'], queryFn: reg.listApplications });
}

export function useDraft(id: string) {
  return useQuery({
    queryKey: [KEY, 'draft', id],
    queryFn: () => reg.getDraft(id),
    enabled: !!id,
  });
}

export function useStartDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contestSlug: string) => reg.startDraft(contestSlug),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'applications'] }),
  });
}

export function useSaveStep(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { stepKey: RegistrationStepKey; values: Record<string, unknown> }) =>
      reg.saveStep({ id, stepKey: params.stepKey, values: params.values }),
    onSuccess: (res) => {
      qc.setQueryData([KEY, 'draft', id], { draft: res.draft, steps: res.steps });
    },
  });
}

export function useSubmitApplication(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => reg.submitApplication(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'applications'] });
      qc.invalidateQueries({ queryKey: [KEY, 'status', id] });
    },
  });
}

export function useStatus(id: string) {
  return useQuery({
    queryKey: [KEY, 'status', id],
    queryFn: () => reg.getStatus(id),
    enabled: !!id,
  });
}

/**
 * Voting context for an application. Polls while the contest is open so the
 * applicant's vote count moves without a manual refresh; disabled entirely for
 * an application that is not votable, so a rejected or pending one costs
 * nothing.
 */
export function useRegistrationVoting(id: string) {
  return useQuery({
    queryKey: [KEY, 'voting', id],
    queryFn: () => reg.getRegistrationVoting(id),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.votable ? 30_000 : false),
  });
}

export function useWithdraw(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => reg.withdrawApplication(id, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'applications'] });
      qc.invalidateQueries({ queryKey: [KEY, 'status', id] });
    },
  });
}

// ── Payment ───────────────────────────────────────────────────────────────────

export function useInitiateRegistrationPayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { amountKobo: number; method: RegistrationPaymentMethod; email: string; name: string; idempotencyKey?: string }) =>
      reg.initiateRegistrationPayment({ id, ...params }),
    onSuccess: () => {
      // Refresh draft so the updated paymentStatus/reference is available.
      qc.invalidateQueries({ queryKey: [KEY, 'draft', id] });
    },
  });
}

export function useVerifyRegistrationPayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { transactionId: string; reference: string }) =>
      reg.verifyRegistrationPayment({ id, ...params }),
    onSuccess: (res) => {
      if (res.status === 'SUCCESSFUL') {
        qc.invalidateQueries({ queryKey: [KEY, 'draft', id] });
      }
    },
  });
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export function useUploadFile() {
  return useMutation({ mutationFn: (file: PickedUpload) => reg.uploadFile(file) });
}

/**
 * The signed-in user's live application for a contest, or null. Used by the
 * contest screen to offer "Manage your application" instead of a second apply
 * button — the gap that let one account accumulate five applications to the
 * same contest.
 */
export function useMyRegistrationForContest(target: { contestId?: string; contestSlug?: string }) {
  const key = target.contestId ?? target.contestSlug ?? '';
  return useQuery({
    queryKey: [KEY, 'for-contest', key],
    queryFn: () => reg.getMyRegistrationForContest(target),
    enabled: !!key,
    staleTime: 15_000,
  });
}
