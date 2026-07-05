// Paymax Connect — VOTING hooks (React Query v5).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as votingApi from './api';
import type { ContestStatus } from './types';

export const votingKeys = {
  all: ['connect', 'voting'] as const,
  contests: (s?: ContestStatus) => [...votingKeys.all, 'contests', s ?? 'all'] as const,
  contest: (id: string) => [...votingKeys.all, 'contest', id] as const,
  leaderboard: (id: string) => [...votingKeys.all, 'leaderboard', id] as const,
  history: () => [...votingKeys.all, 'history'] as const,
};

export function useContests(status?: ContestStatus) {
  return useQuery({ queryKey: votingKeys.contests(status), queryFn: () => votingApi.listContests(status) });
}

export function useContest(id: string) {
  return useQuery({ queryKey: votingKeys.contest(id), queryFn: () => votingApi.getContest(id), enabled: !!id });
}

export function useCastFreeVote(contestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: votingApi.castFreeVote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: votingKeys.contest(contestId) });
      qc.invalidateQueries({ queryKey: votingKeys.leaderboard(contestId) });
    },
  });
}

export function useCastPaidVote(contestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: votingApi.castPaidVote,
    onSuccess: () => {
      // real money moved — refresh the tier widget + contest tallies + history.
      qc.invalidateQueries({ queryKey: ['connect', 'tier-status'] });
      qc.invalidateQueries({ queryKey: votingKeys.contest(contestId) });
      qc.invalidateQueries({ queryKey: votingKeys.leaderboard(contestId) });
      qc.invalidateQueries({ queryKey: votingKeys.history() });
    },
  });
}

export function useContestLeaderboard(contestId: string) {
  return useQuery({ queryKey: votingKeys.leaderboard(contestId), queryFn: () => votingApi.getContestLeaderboard(contestId), enabled: !!contestId });
}

export function useVoteHistory() {
  return useQuery({ queryKey: votingKeys.history(), queryFn: votingApi.getVoteHistory });
}
