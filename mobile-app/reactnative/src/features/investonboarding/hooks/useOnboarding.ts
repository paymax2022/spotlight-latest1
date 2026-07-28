// ── Paymax Invest · Onboarding — Data hooks ──────────────────────────────────
// React Query hooks mirroring useCrypto.ts so screens stay declarative and share
// the same caching / loading / error contracts. Mutations invalidate the
// onboarding-state + status queries on success so gated UI re-reads cleanly.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as onboarding from '../api/onboarding.api';
import type {
  KycDraft,
  SuitabilityAnswers,
} from '../types/onboarding.types';

const KEY = 'onboarding';

// ─── Eligibility & overview ───────────────────────────────────────────────────

export function useEligibility() {
  return useQuery({ queryKey: [KEY, 'eligibility'], queryFn: onboarding.getEligibility, staleTime: 60_000 });
}

export function useOnboardingState() {
  return useQuery({ queryKey: [KEY, 'state'], queryFn: onboarding.getOnboardingState, staleTime: 15_000 });
}

// ─── KYC ──────────────────────────────────────────────────────────────────────

export function useKycStatus() {
  return useQuery({ queryKey: [KEY, 'kyc-status'], queryFn: onboarding.getKycStatus, staleTime: 15_000 });
}

export function useSubmitKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: KycDraft) => onboarding.submitKyc(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'kyc-status'] });
      qc.invalidateQueries({ queryKey: [KEY, 'state'] });
    },
  });
}

// ─── Suitability ────────────────────────────────────────────────────────────--

export function useSuitabilityQuestions() {
  return useQuery({ queryKey: [KEY, 'suitability-questions'], queryFn: onboarding.getSuitabilityQuestions, staleTime: 5 * 60_000 });
}

export function useSuitability() {
  return useQuery({ queryKey: [KEY, 'suitability'], queryFn: onboarding.getSuitability, staleTime: 60_000 });
}

export function useSubmitSuitability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: SuitabilityAnswers) => onboarding.submitSuitability(answers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'suitability'] });
      qc.invalidateQueries({ queryKey: [KEY, 'state'] });
    },
  });
}

// ─── Agreements ─────────────────────────────────────────────────────────────--

export function useAgreements() {
  return useQuery({ queryKey: [KEY, 'agreements'], queryFn: onboarding.getAgreements, staleTime: 5 * 60_000 });
}

export function useAcceptAgreements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => onboarding.acceptAgreements(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'agreements'] });
      qc.invalidateQueries({ queryKey: [KEY, 'state'] });
    },
  });
}
