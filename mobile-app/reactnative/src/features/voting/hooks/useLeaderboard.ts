import { useQuery } from '@tanstack/react-query';
import { getLeaderboard } from '../api/voting.api';

export function useLeaderboard(contestId: string) {
  return useQuery({
    queryKey: ['voting', 'leaderboard', contestId],
    queryFn:  () => getLeaderboard(contestId),
    enabled:  !!contestId,
    staleTime: 15_000,
    refetchInterval: 60_000, // auto-refresh every 60s for live data
  });
}
