import { useQuery } from '@tanstack/react-query';
import { getContestants } from '../api/voting.api';

export function useContestants(
  contestId: string,
  params?: { search?: string; category?: string; state?: string; sort?: string },
) {
  return useQuery({
    queryKey: ['voting', 'contestants', contestId, params],
    queryFn:  () => getContestants(contestId, params),
    enabled:  !!contestId,
    staleTime: 30_000,
  });
}
