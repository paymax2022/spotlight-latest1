// ── Referral Merchant Zone (lite) React Query hooks (v5) — M-MER-01..03 ──────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as merchantApi from './api';
import { referralKeys } from '../foundation/hooks';
import type { CreateCampaignInput } from './types';

export const merchantKeys = {
  dashboard: () => [...referralKeys.all, 'merchant', 'dashboard'] as const,
  performance: (id: string) => [...referralKeys.all, 'merchant', 'performance', id] as const,
};

export function useMerchantDashboard() {
  return useQuery({ queryKey: merchantKeys.dashboard(), queryFn: merchantApi.getMerchantDashboard, staleTime: 30_000 });
}

export function useCreateAndFundCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) => merchantApi.createAndFundCampaign(input),
    onSuccess: (res) => {
      if (res.ok) qc.invalidateQueries({ queryKey: merchantKeys.dashboard() });
    },
  });
}

export function useMerchantPerformance(campaignId: string) {
  return useQuery({
    queryKey: merchantKeys.performance(campaignId),
    queryFn: () => merchantApi.getMerchantPerformance(campaignId),
    enabled: !!campaignId,
    staleTime: 30_000,
  });
}
