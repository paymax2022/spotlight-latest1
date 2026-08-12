import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase';

/**
 * Keeps the voting screens live.
 *
 * Two things change a contest under the user's feet: somebody casts a vote
 * (`connect_votes`), and an admin publishes or removes a contestant
 * (`contestants`). Both are Postgres changes, so a Realtime subscription is
 * enough — no polling loop, and an approval in the admin console shows up on
 * the phone within about a second.
 *
 * Invalidating the queries (rather than patching cached rows) means the ranked
 * roster is always recomputed server-side. Ranking is a global property of the
 * whole roster, so a local patch of one row would produce a briefly wrong
 * order.
 */
export function useVotingRealtime(contestId?: string): void {
  const qc = useQueryClient();

  // Hold the client in a ref so the effect below doesn't re-subscribe on every
  // render — a subscribe/unsubscribe loop drops events and churns the socket.
  const invalidate = useRef(() => {
    void qc.invalidateQueries({ queryKey: ['voting'] });
  });
  invalidate.current = () => {
    void qc.invalidateQueries({ queryKey: ['voting'] });
  };

  useEffect(() => {
    if (!contestId) return;

    let channel: ReturnType<ReturnType<typeof createSupabaseClient>['channel']> | null = null;
    let supabase: ReturnType<typeof createSupabaseClient> | null = null;

    try {
      supabase = createSupabaseClient();
      channel = supabase
        .channel(`voting:${contestId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'connect_votes',
            filter: `contest_id=eq.${contestId}`,
          },
          () => invalidate.current(),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'contestants',
            filter: `connect_contest_id=eq.${contestId}`,
          },
          () => invalidate.current(),
        )
        .subscribe();
    } catch {
      // Realtime is an enhancement: if the socket cannot be established the
      // screens still work through their normal fetches.
      channel = null;
    }

    return () => {
      if (supabase && channel) supabase.removeChannel(channel);
    };
  }, [contestId]);
}
