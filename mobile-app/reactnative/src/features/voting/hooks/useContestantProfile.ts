import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getContestant, likeContestant, shareContestant, unlikeContestant } from '../api/voting.api';
import type { Contestant } from '../types/voting.types';

export function useContestantProfile(contestantId: string) {
  return useQuery({
    queryKey: ['voting', 'contestant', contestantId],
    queryFn:  () => getContestant(contestantId),
    enabled:  !!contestantId,
    staleTime: 30_000,
  });
}

/**
 * Toggles the caller's like with an optimistic flip so the heart responds
 * instantly, then reconciles with the server's real count on success (or
 * rolls back on failure — a like that silently didn't happen must not leave
 * the heart lit).
 */
export function useToggleContestantLike(contestantId: string) {
  const qc = useQueryClient();
  const queryKey = ['voting', 'contestant', contestantId];

  return useMutation({
    mutationFn: (liked: boolean) => (liked ? unlikeContestant(contestantId) : likeContestant(contestantId)),
    onMutate: async (liked: boolean) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Contestant>(queryKey);
      if (previous) {
        qc.setQueryData<Contestant>(queryKey, {
          ...previous,
          likedByMe: !liked,
          likeCount: Math.max(0, (previous.likeCount ?? 0) + (liked ? -1 : 1)),
        });
      }
      return { previous };
    },
    onError: (_err, _liked, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous);
    },
    onSuccess: (fresh) => {
      qc.setQueryData(queryKey, fresh);
    },
  });
}

export function useShareContestant(contestantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => shareContestant(contestantId),
    onSuccess: (result) => {
      qc.setQueryData<Contestant | undefined>(['voting', 'contestant', contestantId], (prev) =>
        prev ? { ...prev, shareCount: result.shareCount } : prev,
      );
    },
  });
}
