import { useQuery } from '@tanstack/react-query';
import { getContestantSupporters } from '../api/voting.api';

/**
 * Who voted for a contestant — visible to that contestant only.
 *
 * The server answers 403 for anyone else, so a failure here is the normal
 * outcome for a viewer who is not the contestant rather than something to
 * report. `retry: false` keeps a refused read from being attempted three times,
 * and the caller renders nothing on error.
 */
export function useContestantSupporters(contestantId?: string) {
  return useQuery({
    queryKey: ['voting', 'supporters', contestantId],
    queryFn: () => getContestantSupporters(contestantId as string),
    enabled: Boolean(contestantId),
    retry: false,
    staleTime: 30_000,
  });
}
