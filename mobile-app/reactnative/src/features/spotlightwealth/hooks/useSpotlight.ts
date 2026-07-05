// ── Spotlight Wealth — Data hooks ────────────────────────────────────────────
// React Query hooks mirroring useCrypto.ts so the Spotlight Wealth screens stay
// declarative and share the same caching / loading / error contracts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as spotlight from '../api/spotlight.api';
import type { SpotlightTopic } from '../types/spotlight.types';

const KEY = 'spotlight';

// ─── Finance videos ───────────────────────────────────────────────────────────

export function useVideos(topic?: SpotlightTopic) {
  return useQuery({
    queryKey: [KEY, 'videos', topic ?? 'all'],
    queryFn: () => spotlight.getVideos(topic),
    staleTime: 60_000,
  });
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export function useChallenges() {
  return useQuery({ queryKey: [KEY, 'challenges'], queryFn: spotlight.getChallenges, staleTime: 30_000 });
}

export function useChallenge(id?: string) {
  return useQuery({
    queryKey: [KEY, 'challenge', id],
    queryFn: () => spotlight.getChallenge(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useJoinChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => spotlight.joinChallenge(id),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: [KEY, 'challenges'] });
      qc.invalidateQueries({ queryKey: [KEY, 'challenge', updated.id] });
    },
  });
}

// ─── Learning leaderboard ─────────────────────────────────────────────────────

export function useLeaderboard() {
  return useQuery({ queryKey: [KEY, 'leaderboard'], queryFn: spotlight.getLeaderboard, staleTime: 60_000 });
}

// ─── Reward wallet ────────────────────────────────────────────────────────────

export function useRewardWallet() {
  return useQuery({ queryKey: [KEY, 'reward-wallet'], queryFn: spotlight.getRewardWallet, staleTime: 30_000 });
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export function useCampaigns() {
  return useQuery({ queryKey: [KEY, 'campaigns'], queryFn: spotlight.getCampaigns, staleTime: 60_000 });
}

export function useCampaign(id?: string) {
  return useQuery({
    queryKey: [KEY, 'campaign', id],
    queryFn: () => spotlight.getCampaign(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}
