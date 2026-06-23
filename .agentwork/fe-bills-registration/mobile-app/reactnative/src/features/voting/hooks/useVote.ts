import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { castFreeVotes, initiatePaidVote, verifyPaidVote, getFreeVoteAllocation } from '../api/voting.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { VotePaidInitiatePayload, PaymentMethod } from '../types/voting.types';

export function useFreeVoteAllocation(contestId: string) {
  return useQuery({
    queryKey: ['voting', 'free-votes', contestId],
    queryFn:  () => getFreeVoteAllocation(contestId),
    enabled:  !!contestId,
    staleTime: 30_000,
  });
}

export function useCastFreeVotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { contestantId: string; contestId: string; votes: number }) =>
      castFreeVotes({ ...payload, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['voting', 'free-votes', vars.contestId] });
      qc.invalidateQueries({ queryKey: ['voting', 'leaderboard', vars.contestId] });
      qc.invalidateQueries({ queryKey: ['voting', 'contestants', vars.contestId] });
      qc.invalidateQueries({ queryKey: ['voting', 'my-votes'] });
    },
  });
}

export function useInitiatePaidVote() {
  return useMutation({
    mutationFn: (payload: Omit<VotePaidInitiatePayload, 'idempotencyKey'>) =>
      initiatePaidVote({ ...payload, idempotencyKey: generateIdempotencyKey() }),
  });
}

export function useVerifyPaidVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: verifyPaidVote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voting'] });
    },
  });
}
