// ── Association — Group chat realtime ─────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase';
import { USE_MOCK } from '../constants/association.constants';

const KEY = 'association';

/**
 * Keeps an open chat thread live.
 *
 * Association chat could send and fetch messages but never received one it had
 * not asked for: a member had to leave the thread and come back to see a reply.
 * assoc_chat_messages is a Postgres table, so a Realtime subscription on it is
 * enough — no polling loop.
 *
 * INVALIDATES RATHER THAN APPENDING THE PAYLOAD. The realtime row is the raw
 * database record: no author name, no `mine` flag, no reactions, and none of
 * the scope checks the API applies. Appending it to the cache would render a
 * message attributed to nobody and would trust a row this client did not have
 * fetched for it. Treating the event purely as a SIGNAL, and re-reading through
 * the Go API, keeps the API the only thing that decides what a member may see.
 *
 * Delivery is gated by the assoc_chat_messages RLS policy, which calls
 * assoc_can_read_chat_thread() — the same rule the API applies, so a member
 * cannot be pushed an executive or committee message they could not fetch.
 * See supabase/migrations/20270117000000_assoc_chat_realtime_rls.sql.
 */
export function useAssociationChatRealtime(threadId?: string): void {
  const qc = useQueryClient();

  // Held in a ref so the effect does not re-subscribe on every render — a
  // subscribe/unsubscribe loop drops events and churns the socket.
  const refresh = useRef<() => void>(() => {});
  refresh.current = () => {
    if (threadId) void qc.invalidateQueries({ queryKey: [KEY, 'chatThread', threadId] });
    // The thread list carries the last message and unread count, both of which
    // a new message changes.
    void qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] });
  };

  useEffect(() => {
    // Mock mode has no database behind it; opening a socket would only produce
    // a channel that never fires.
    if (!threadId || USE_MOCK) return;

    let channel: ReturnType<ReturnType<typeof createSupabaseClient>['channel']> | null = null;
    let supabase: ReturnType<typeof createSupabaseClient> | null = null;
    let cancelled = false;

    void (async () => {
      try {
        supabase = createSupabaseClient();

        // Hand the user's access token to the realtime socket BEFORE
        // subscribing. Delivery is RLS-gated on auth.uid(), and a socket that
        // connected as `anon` has no uid — every event is then filtered out and
        // the channel looks healthy while delivering nothing. This is not
        // belt-and-braces: without it the subscription silently never fires.
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return; // signed out: nothing to subscribe as
        supabase.realtime.setAuth(token);

        if (cancelled) return;
        channel = supabase
          .channel(`assoc-chat:${threadId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'assoc_chat_messages',
              filter: `thread_id=eq.${threadId}`,
            },
            () => refresh.current(),
          )
          .subscribe((status, err) => {
            // Logged because a realtime channel fails SILENTLY: an RLS denial,
            // an unpublished table and a bad token all leave the screen looking
            // exactly like a quiet conversation.
            if (status !== 'SUBSCRIBED') {
              console.warn('[association] chat realtime channel', status, err ?? '');
            }
          });
      } catch {
        // Realtime is an enhancement: if the client or session is unavailable
        // the screen still works off its normal fetches.
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      if (channel && supabase) {
        try { void supabase.removeChannel(channel); } catch { /* already gone */ }
      }
    };
  }, [threadId]);
}
