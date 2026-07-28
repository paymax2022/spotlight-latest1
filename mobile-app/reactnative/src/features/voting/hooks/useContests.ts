import { useQuery } from '@tanstack/react-query';
import { getContests } from '../api/voting.api';

export function useContests(params?: { category?: string; status?: string }) {
  return useQuery({
    queryKey: ['voting', 'contests', params],
    queryFn:  () => getContests(params),
    staleTime: 30_000,
  });
}
