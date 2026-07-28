import { useQuery } from '@tanstack/react-query';
import { getVotePackages } from '../api/voting.api';

export function useVotePackages(contestId?: string) {
  return useQuery({
    queryKey: ['voting', 'packages', contestId],
    queryFn:  () => getVotePackages(contestId),
    staleTime: 300_000, // packages change rarely
  });
}
