// ── Crowdfunding — Investment (Section L) hooks ──────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getInvestorProfile, completeOnboardingStep, getOffers, getOffer,
  getEducation, getQuiz, subscribe, getPortfolio,
} from '../api/investment.api';
import type { InvestmentSubscriptionInput, InvestorRiskProfile } from '../types/investment.types';

const KEY = 'crowdfunding';

export function useInvestorProfile() {
  return useQuery({ queryKey: [KEY, 'inv', 'profile'], queryFn: getInvestorProfile, staleTime: 10_000 });
}
export function useCompleteOnboardingStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ step, riskProfile }: { step: 'kyc' | 'education' | 'quiz' | 'risk'; riskProfile?: InvestorRiskProfile }) => completeOnboardingStep(step, riskProfile),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'inv', 'profile'] }),
  });
}
export function useOffers() {
  return useQuery({ queryKey: [KEY, 'inv', 'offers'], queryFn: getOffers, staleTime: 30_000 });
}
export function useOffer(id?: string) {
  return useQuery({ queryKey: [KEY, 'inv', 'offer', id], queryFn: () => getOffer(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useEducation() {
  return useQuery({ queryKey: [KEY, 'inv', 'education'], queryFn: getEducation, staleTime: 5 * 60_000 });
}
export function useQuiz() {
  return useQuery({ queryKey: [KEY, 'inv', 'quiz'], queryFn: getQuiz, staleTime: 5 * 60_000 });
}
export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InvestmentSubscriptionInput) => subscribe(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'inv', 'portfolio'] }); qc.invalidateQueries({ queryKey: [KEY, 'inv', 'profile'] }); },
  });
}
export function usePortfolio() {
  return useQuery({ queryKey: [KEY, 'inv', 'portfolio'], queryFn: getPortfolio, staleTime: 20_000 });
}
