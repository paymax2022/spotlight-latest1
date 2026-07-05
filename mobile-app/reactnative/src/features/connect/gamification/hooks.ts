// Paymax Connect — GAMIFICATION hooks (React Query v5).
// Everything here deals in NON-CASH points/coins. Never money.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as gameApi from './api';
import type { LeaderboardScope } from './types';

export const gameKeys = {
  all: ['connect', 'gamification'] as const,
  profile: () => [...gameKeys.all, 'profile'] as const,
  missions: () => [...gameKeys.all, 'missions'] as const,
  streak: () => [...gameKeys.all, 'streak'] as const,
  leaderboard: (s: LeaderboardScope) => [...gameKeys.all, 'leaderboard', s] as const,
  season: () => [...gameKeys.all, 'season'] as const,
  rewards: () => [...gameKeys.all, 'rewards'] as const,
  badges: () => [...gameKeys.all, 'badges'] as const,
  xpHistory: () => [...gameKeys.all, 'xp-history'] as const,
};

export function useGamificationProfile() {
  return useQuery({ queryKey: gameKeys.profile(), queryFn: gameApi.getGamificationProfile });
}

export function useMissions() {
  return useQuery({ queryKey: gameKeys.missions(), queryFn: gameApi.listMissions });
}

export function useClaimMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: gameApi.claimMission,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gameKeys.missions() });
      qc.invalidateQueries({ queryKey: gameKeys.profile() });
    },
  });
}

export function useStreak() {
  return useQuery({ queryKey: gameKeys.streak(), queryFn: gameApi.getStreak });
}

export function useCheckInStreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: gameApi.checkInStreak,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gameKeys.streak() });
      qc.invalidateQueries({ queryKey: gameKeys.profile() });
    },
  });
}

export function useGameLeaderboard(scope: LeaderboardScope) {
  return useQuery({ queryKey: gameKeys.leaderboard(scope), queryFn: () => gameApi.getGameLeaderboard(scope) });
}

export function useSeason() {
  return useQuery({ queryKey: gameKeys.season(), queryFn: gameApi.getSeason });
}

export function useRewards() {
  return useQuery({ queryKey: gameKeys.rewards(), queryFn: gameApi.listRewards });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: gameApi.redeemReward,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gameKeys.rewards() });
      qc.invalidateQueries({ queryKey: gameKeys.profile() });
    },
  });
}

export function useBadges() {
  return useQuery({ queryKey: gameKeys.badges(), queryFn: gameApi.listBadges });
}

export function useXpHistory() {
  return useQuery({ queryKey: gameKeys.xpHistory(), queryFn: gameApi.getXpHistory });
}
