import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useContests } from './useContests';
import { useLeaderboardState } from './useLeaderboard';
import { useFreeVoteAllocation } from './useVote';
import { getContestants } from '../api/voting.api';
import type { Contest, Contestant } from '../types/voting.types';

/** One portrait on the "contestants to watch" shelf, with the contest it is in. */
export interface WatchSlot {
  contestant: Contestant;
  contestId: string;
  contestTitle: string;
}

/** How many contests beyond the featured one the shelf may pull rosters from. */
const EXTRA_ROSTER_CONTESTS = 2;
/** Portraits the shelf shows — two per contest, so one contest cannot fill it. */
const WATCH_LIMIT = 6;

/**
 * One read of everything the landing needs, from the existing endpoints only.
 *
 * Request budget: one contest list, the featured roster (through the
 * leaderboard hook, which is the same endpoint), a free-vote allowance, and up
 * to two extra rosters. The featured contest is deliberately the first LIVE one
 * that actually has contestants — a live contest still filling its roster would
 * otherwise starve the hero, the shelf and the board at once.
 */
export function useVotingLanding() {
  // No `?status=` filter: the landing needs live AND closed rows (trending),
  // and the Go list allowlist only knows active/closed. One unfiltered read is
  // also one request instead of two.
  const contestsQuery = useContests();
  const contests = contestsQuery.data ?? [];

  const live = useMemo(() => contests.filter((c) => c.status === 'LIVE'), [contests]);
  const upcoming = useMemo(() => contests.filter((c) => c.status === 'UPCOMING'), [contests]);
  const closed = useMemo(() => contests.filter((c) => c.status === 'CLOSED'), [contests]);

  const featured = useMemo<Contest | null>(
    () => live.find((c) => (c.contestantCount ?? 0) > 0) ?? live[0] ?? upcoming[0] ?? closed[0] ?? null,
    [live, upcoming, closed],
  );

  const board = useLeaderboardState(featured?.id ?? '');
  const freeVotes = useFreeVoteAllocation(featured?.id ?? '');

  const others = useMemo(
    () => live.filter((c) => c.id !== featured?.id).slice(0, EXTRA_ROSTER_CONTESTS),
    [live, featured?.id],
  );
  const otherRosters = useQueries({
    queries: others.map((contest) => ({
      queryKey: ['voting', 'contestants', contest.id, undefined],
      queryFn: () => getContestants(contest.id),
      staleTime: 30_000,
      enabled: !!contest.id,
    })),
  });

  const watch = useMemo<WatchSlot[]>(() => {
    const slots: WatchSlot[] = [];

    if (featured) {
      const entries = board.data && !board.data.hidden ? board.data.entries : [];
      entries.slice(0, 2).forEach((entry) =>
        slots.push({
          contestant: entry.contestant,
          contestId: featured.id,
          contestTitle: featured.title,
        }),
      );
    }

    others.forEach((contest, i) => {
      // `useQueries` returns the entries in the same order as `others`.
      (otherRosters[i]?.data ?? []).slice(0, 2).forEach((contestant) =>
        slots.push({ contestant, contestId: contest.id, contestTitle: contest.title }),
      );
    });

    const seen = new Set<string>();
    return slots
      .filter((slot) => {
        if (seen.has(slot.contestant.id)) return false;
        seen.add(slot.contestant.id);
        return true;
      })
      .slice(0, WATCH_LIMIT);
  }, [board.data, featured, others, otherRosters]);

  // A trending order built only from fields the API sent: the tally first, the
  // roster size second, recency last. Nothing here is an estimate.
  const trending = useMemo(() => {
    const at = (c: Contest) => (c.startsAt ? new Date(c.startsAt).getTime() : 0);
    return [...contests]
      .sort(
        (a, b) =>
          (b.totalVotes ?? 0) - (a.totalVotes ?? 0) ||
          (b.contestantCount ?? 0) - (a.contestantCount ?? 0) ||
          at(b) - at(a),
      )
      .slice(0, 4);
  }, [contests]);

  const trendingHasVotes = trending.some((c) => (c.totalVotes ?? 0) > 0);

  const categories = useMemo(
    () => Array.from(new Set(contests.map((c) => (c.category ?? '').trim()).filter(Boolean))),
    [contests],
  );

  const refresh = () => {
    void contestsQuery.refetch();
    void board.refetch();
    void freeVotes.refetch();
    otherRosters.forEach((q) => void q.refetch());
  };

  return {
    contests,
    live,
    upcoming,
    closed,
    featured,
    board,
    freeVotes,
    watch,
    trending,
    trendingHasVotes,
    categories,
    isLoading: contestsQuery.isLoading,
    isError: contestsQuery.isError,
    isRefreshing: contestsQuery.isRefetching || board.isRefetching,
    refresh,
    retry: () => void contestsQuery.refetch(),
  };
}
