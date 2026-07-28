// ── Direct Referral Rewards — React Query hooks (v5) ─────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as rewardsApi from './api';
import type { PageParams } from './types';

export const rewardKeys = {
  all:        ['referral-rewards'] as const,
  link:       () => [...rewardKeys.all, 'link'] as const,
  dashboard:  () => [...rewardKeys.all, 'dashboard'] as const,
  referrals:  (p?: PageParams) => [...rewardKeys.all, 'referrals', p ?? {}] as const,
  earnings:   (p?: PageParams) => [...rewardKeys.all, 'earnings', p ?? {}] as const,
  milestones: () => [...rewardKeys.all, 'milestones'] as const,
};

// ── Reads ────────────────────────────────────────────────────────────────────
export function useReferralLink() {
  return useQuery({ queryKey: rewardKeys.link(), queryFn: rewardsApi.getOrCreateLink, staleTime: 5 * 60_000 });
}

export function useReferralDashboard() {
  return useQuery({ queryKey: rewardKeys.dashboard(), queryFn: rewardsApi.getDashboard, staleTime: 30_000 });
}

export function useReferralList(params?: PageParams) {
  return useQuery({ queryKey: rewardKeys.referrals(params), queryFn: () => rewardsApi.listReferrals(params), staleTime: 30_000 });
}

export function useReferralEarnings(params?: PageParams) {
  return useQuery({ queryKey: rewardKeys.earnings(params), queryFn: () => rewardsApi.listEarnings(params), staleTime: 30_000 });
}

export function useReferralMilestones() {
  return useQuery({ queryKey: rewardKeys.milestones(), queryFn: rewardsApi.getMilestones, staleTime: 60_000 });
}

// ── Mutations ────────────────────────────────────────────────────────────────
// Apply a referral code at signup (referred-user side). Silent by design — the
// screen swallows failures so a bad code never blocks the account creation.
export function useAttributeReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => rewardsApi.attribute(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: rewardKeys.all }),
  });
}
