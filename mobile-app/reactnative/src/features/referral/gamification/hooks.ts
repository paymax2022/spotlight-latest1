// ── Referral Gamification React Query hooks (v5) — M-GAM-01..07 ──────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as gamApi from './api';
import { referralKeys } from '../foundation/hooks';
import type { LeaderboardScope } from './types';

export const gamificationKeys = {
  missions: () => [...referralKeys.all, 'gamification', 'missions'] as const,
  mission: (id: string) => [...referralKeys.all, 'gamification', 'mission', id] as const,
  streak: () => [...referralKeys.all, 'gamification', 'streak'] as const,
  ranks: () => [...referralKeys.all, 'gamification', 'ranks'] as const,
  leaderboard: (scope: LeaderboardScope) => [...referralKeys.all, 'gamification', 'leaderboard', scope] as const,
  contests: () => [...referralKeys.all, 'gamification', 'contests'] as const,
  rankUp: () => [...referralKeys.all, 'gamification', 'rank-up'] as const,
};

export function useMissions() {
  return useQuery({
    queryKey: gamificationKeys.missions(),
    queryFn: gamApi.getMissions,
    staleTime: 30_000,
  });
}

export function useMissionDetail(id: string) {
  return useQuery({
    queryKey: gamificationKeys.mission(id),
    queryFn: () => gamApi.getMissionDetail(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useClaimMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gamApi.claimMission(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: gamificationKeys.missions() });
      qc.invalidateQueries({ queryKey: gamificationKeys.mission(id) });
      qc.invalidateQueries({ queryKey: gamificationKeys.ranks() });
    },
  });
}

export function useStreak() {
  return useQuery({
    queryKey: gamificationKeys.streak(),
    queryFn: gamApi.getStreak,
    staleTime: 60_000,
  });
}

export function useRanksBadges() {
  return useQuery({
    queryKey: gamificationKeys.ranks(),
    queryFn: gamApi.getRanksBadges,
    staleTime: 60_000,
  });
}

export function useLeaderboard(scope: LeaderboardScope) {
  return useQuery({
    queryKey: gamificationKeys.leaderboard(scope),
    queryFn: () => gamApi.getLeaderboard(scope),
    staleTime: 30_000,
  });
}

export function useContests() {
  return useQuery({
    queryKey: gamificationKeys.contests(),
    queryFn: gamApi.getContests,
    staleTime: 60_000,
  });
}

export function useJoinContest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gamApi.joinContest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: gamificationKeys.contests() }),
  });
}

export function useRankUp() {
  return useQuery({
    queryKey: gamificationKeys.rankUp(),
    queryFn: gamApi.getRankUp,
    staleTime: 60_000,
  });
}
