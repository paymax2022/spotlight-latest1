// Paymax Connect — Discovery React Query hooks (PRD §10.2 DC-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as discoveryApi from './api';
import type { DiscoveryFilters, DiscoveryMode, SwipeAction } from './types';

export const discoveryKeys = {
  all: ['connect', 'discovery'] as const,
  stack: (f: DiscoveryFilters) => [...discoveryKeys.all, 'stack', f] as const,
  profile: (id: string) => [...discoveryKeys.all, 'profile', id] as const,
  likesYou: () => [...discoveryKeys.all, 'likes-you'] as const,
  dailyPicks: () => [...discoveryKeys.all, 'daily-picks'] as const,
  nearby: (mode: DiscoveryMode) => [...discoveryKeys.all, 'nearby', mode] as const,
  boosts: () => [...discoveryKeys.all, 'boosts'] as const,
  tier: () => [...discoveryKeys.all, 'tier'] as const,
};

export function useDiscoveryStack(filters: DiscoveryFilters) {
  return useQuery({
    queryKey: discoveryKeys.stack(filters),
    queryFn: () => discoveryApi.getDiscoveryStack(filters),
    // A missing-profile (or any 4xx) rejection is deterministic — retrying just
    // wastes calls and delays the onboarding CTA. Only retry transient errors.
    retry: (failureCount, error) => {
      if (error instanceof discoveryApi.ProfileRequiredError) return false;
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 2;
    },
  });
}

export function useProfileDetail(id: string) {
  return useQuery({
    queryKey: discoveryKeys.profile(id),
    queryFn: () => discoveryApi.getProfileDetail(id),
    enabled: !!id,
  });
}

export function useSwipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; action: SwipeAction }) =>
      discoveryApi.swipe(v.profileId, v.action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: discoveryKeys.likesYou() });
    },
  });
}

export function useLikesYou(premium: boolean) {
  return useQuery({
    queryKey: discoveryKeys.likesYou(),
    queryFn: () => discoveryApi.getLikesYou(premium),
  });
}

export function useDailyPicks() {
  return useQuery({ queryKey: discoveryKeys.dailyPicks(), queryFn: discoveryApi.getDailyPicks });
}

export function useNearby(mode: DiscoveryMode) {
  return useQuery({ queryKey: discoveryKeys.nearby(mode), queryFn: () => discoveryApi.getNearby(mode) });
}

export function useBoostOffer() {
  return useQuery({ queryKey: discoveryKeys.boosts(), queryFn: discoveryApi.getBoostOffer });
}

export function useDiscoveryTier() {
  return useQuery({ queryKey: discoveryKeys.tier(), queryFn: discoveryApi.getDiscoveryTier });
}

export function usePurchaseBoost() {
  const qc = useQueryClient();
  return useMutation({
    // Boost purchase CHARGES the wallet → each attempt carries its own fresh
    // Idempotency-Key (passed through from the caller / PaymentSheet charge).
    mutationFn: (idempotencyKey?: string) => discoveryApi.purchaseBoost(idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: discoveryKeys.tier() });
      qc.invalidateQueries({ queryKey: discoveryKeys.boosts() });
    },
  });
}

export function useRewind() {
  return useMutation({ mutationFn: (premium: boolean) => discoveryApi.rewind(premium) });
}
