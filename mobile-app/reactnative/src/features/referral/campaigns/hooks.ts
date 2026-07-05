// ── Referral Campaigns React Query hooks (v5) — M-CMP-01..03 ─────────────────

import { useQuery } from '@tanstack/react-query';
import * as campaignsApi from './api';
import { referralKeys } from '../foundation/hooks';

export const campaignsKeys = {
  list: () => [...referralKeys.all, 'campaigns', 'list'] as const,
  featured: () => [...referralKeys.all, 'campaigns', 'featured'] as const,
  detail: (id: string) => [...referralKeys.all, 'campaigns', 'detail', id] as const,
};

export function useCampaigns() {
  return useQuery({ queryKey: campaignsKeys.list(), queryFn: campaignsApi.getCampaigns, staleTime: 60_000 });
}

export function useFeaturedCampaigns() {
  return useQuery({ queryKey: campaignsKeys.featured(), queryFn: campaignsApi.getFeaturedCampaigns, staleTime: 60_000 });
}

export function useCampaignDetail(id: string) {
  return useQuery({
    queryKey: campaignsKeys.detail(id),
    queryFn: () => campaignsApi.getCampaignDetail(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}
