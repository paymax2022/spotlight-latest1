import { useQuery } from '@tanstack/react-query';
import { getContest } from '../api/voting.api';

export function useContestDetails(contestId: string) {
  return useQuery({
    queryKey: ['voting', 'contest', contestId],
    queryFn:  () => getContest(contestId),
    enabled:  !!contestId,
    staleTime: 30_000,
  });
}
