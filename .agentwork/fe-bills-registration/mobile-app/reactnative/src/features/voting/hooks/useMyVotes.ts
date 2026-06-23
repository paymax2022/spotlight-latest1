import { useQuery } from '@tanstack/react-query';
import { getMyVotes } from '../api/voting.api';

export function useMyVotes(params?: { contestId?: string; voteType?: string; status?: string }) {
  return useQuery({
    queryKey: ['voting', 'my-votes', params],
    queryFn:  () => getMyVotes(params),
    staleTime: 30_000,
  });
}
