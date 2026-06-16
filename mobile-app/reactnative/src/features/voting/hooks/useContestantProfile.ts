import { useQuery } from '@tanstack/react-query';
import { getContestant } from '../api/voting.api';

export function useContestantProfile(contestantId: string) {
  return useQuery({
    queryKey: ['voting', 'contestant', contestantId],
    queryFn:  () => getContestant(contestantId),
    enabled:  !!contestantId,
    staleTime: 30_000,
  });
}
