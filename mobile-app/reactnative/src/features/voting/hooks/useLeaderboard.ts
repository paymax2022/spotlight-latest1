import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getLeaderboardState } from '../api/voting.api';

export function useLeaderboard(contestId: string) {
  return useQuery({
    queryKey: ['voting', 'leaderboard', contestId],
    queryFn:  () => getLeaderboard(contestId),
    enabled:  !!contestId,
    staleTime: 15_000,
    refetchInterval: 60_000, // auto-refresh every 60s for live data
  });
}

// Leaderboard + its hidden state. Admin can hide the leaderboard for a contest
// or its active phase; when hidden, `data.hidden` is true and `entries` empty.
export function useLeaderboardState(contestId: string) {
  return useQuery({
    queryKey: ['voting', 'leaderboard-state', contestId],
    queryFn:  () => getLeaderboardState(contestId),
    enabled:  !!contestId,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
