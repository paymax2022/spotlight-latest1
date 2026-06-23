// ── Crowdfunding — Creator data hooks (Section F + G) ────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCreatorStats,
  getMyCampaigns,
  getCreatorContributions,
  getCreatorWithdrawals,
  getCreatorNotifications,
  getCampaignAnalytics,
  submitCampaign,
} from '../api/crowdfunding.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { CampaignDraftInput } from '../types/crowdfunding.types';

const KEY = 'crowdfunding';

export function useCreatorStats() {
  return useQuery({ queryKey: [KEY, 'creator', 'stats'], queryFn: getCreatorStats, staleTime: 30_000 });
}

export function useMyCampaigns(status?: string) {
  return useQuery({
    queryKey: [KEY, 'creator', 'campaigns', status ?? 'all'],
    queryFn: () => getMyCampaigns(status),
    staleTime: 20_000,
  });
}

export function useCreatorContributions() {
  return useQuery({ queryKey: [KEY, 'creator', 'contributions'], queryFn: getCreatorContributions, staleTime: 20_000 });
}

export function useCreatorWithdrawals() {
  return useQuery({ queryKey: [KEY, 'creator', 'withdrawals'], queryFn: getCreatorWithdrawals, staleTime: 20_000 });
}

export function useCreatorNotifications() {
  return useQuery({ queryKey: [KEY, 'creator', 'notifications'], queryFn: getCreatorNotifications, staleTime: 20_000 });
}

export function useCampaignAnalytics(id?: string) {
  return useQuery({
    queryKey: [KEY, 'creator', 'analytics', id],
    queryFn: () => getCampaignAnalytics(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useSubmitCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draft, submitForReview }: { draft: CampaignDraftInput; submitForReview: boolean }) =>
      submitCampaign(draft, submitForReview, generateIdempotencyKey()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'creator', 'campaigns'] });
      qc.invalidateQueries({ queryKey: [KEY, 'creator', 'stats'] });
    },
  });
}
