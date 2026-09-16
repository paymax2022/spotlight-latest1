// ── Crowdfunding — Data hooks ────────────────────────────────────────────────
// React Query hooks (mirrors the voting feature's hook pattern) so screens stay
// declarative and share caching/loading/error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCampaigns,
  getCampaign,
  getCategories,
  getSavedCampaigns,
  getRecentlyViewed,
  getCampaignContributors,
  toggleSaveCampaign,
  getContributions,
  getContribution,
  initiateContribution,
  verifyContribution,
  requestRefund,
} from '../api/crowdfunding.api';
import type {
  CampaignQuery,
  CampaignSummary,
  ContributionDraft,
} from '../types/crowdfunding.types';

const KEY = 'crowdfunding';

export function useCategories() {
  return useQuery({
    queryKey: [KEY, 'categories'],
    queryFn: getCategories,
    staleTime: 5 * 60_000,
  });
}

export function useCampaigns(query?: CampaignQuery) {
  return useQuery({
    queryKey: [KEY, 'campaigns', query ?? {}],
    queryFn: () => getCampaigns(query),
    staleTime: 30_000,
  });
}

export function useCampaign(
  id?: string,
  options?: { refetchInterval?: number | false; refetchIntervalInBackground?: boolean },
) {
  return useQuery({
    queryKey: [KEY, 'campaign', id],
    queryFn: () => getCampaign(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
  });
}

export function useCampaignContributors(id?: string) {
  return useQuery({
    queryKey: [KEY, 'contributors', id],
    queryFn: () => getCampaignContributors(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useSavedCampaigns() {
  return useQuery({
    queryKey: [KEY, 'saved'],
    queryFn: getSavedCampaigns,
    staleTime: 15_000,
  });
}

export function useRecentlyViewed() {
  return useQuery({
    queryKey: [KEY, 'recent'],
    queryFn: getRecentlyViewed,
    staleTime: 60_000,
  });
}

/** Optimistic save/unsave toggle; rolls back on error. */
export function useToggleSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => toggleSaveCampaign(id, saved),
    onMutate: async ({ id, saved }) => {
      await qc.cancelQueries({ queryKey: [KEY] });
      const patch = (list?: CampaignSummary[]) =>
        list?.map((c) => (c.id === id ? { ...c, saved } : c));
      qc.getQueriesData<CampaignSummary[]>({ queryKey: [KEY, 'campaigns'] }).forEach(([k, v]) =>
        qc.setQueryData(k, patch(v)),
      );
      return {};
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
      qc.invalidateQueries({ queryKey: [KEY, 'saved'] });
    },
  });
}

export function useContributions(params?: { status?: string }) {
  return useQuery({
    queryKey: [KEY, 'contributions', params ?? {}],
    queryFn: () => getContributions(params),
    staleTime: 20_000,
  });
}

export function useContribution(id?: string) {
  return useQuery({
    queryKey: [KEY, 'contribution', id],
    queryFn: () => getContribution(id as string),
    enabled: Boolean(id),
  });
}

export function useInitiateContribution() {
  return useMutation({
    mutationFn: ({ draft, idempotencyKey }: { draft: ContributionDraft; idempotencyKey: string }) =>
      initiateContribution(draft, idempotencyKey),
  });
}

export function useVerifyContribution() {
  return useMutation({ mutationFn: (reference: string) => verifyContribution(reference) });
}

export function useRequestRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => requestRefund(id, reason),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, 'contribution'] }),
  });
}
