// Near-real-time progression for topic mastery.
//
// The append-only film_mastery_events stream is a NOTIFICATION aid: a poll that
// finds new events invalidates the ledger-backed queries, which then re-read
// film_topic_mastery — the actual authority. A failed poll is therefore silent;
// it must never surface as a learning error or imply the grade is lost.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  getProgressEvents,
  FILM_ACADEMY_PATH_KEY,
  FILM_ACADEMY_CERTIFICATE_KEY,
  filmAcademyTopicKey,
} from './api';

const POLL_MS = 15_000;

/**
 * Poll after `initialCursor` while `enabled`. Invalidation is scoped: the path
 * plus only the topics named by new events, so an open article is not refetched
 * on every tick.
 */
export function useMasteryEvents(enabled: boolean, initialCursor = 0): void {
  const queryClient = useQueryClient();
  const cursorRef = useRef(0);
  const inFlight = useRef(false);

  // The path response carries the cursor the server saw. Never move backwards if
  // that response arrives after an event poll already advanced the stream.
  cursorRef.current = Math.max(cursorRef.current, initialCursor);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const poll = async () => {
      if (inFlight.current || cancelled) return;
      inFlight.current = true;
      try {
        const page = await getProgressEvents(cursorRef.current);
        if (cancelled) return;
        cursorRef.current = Math.max(cursorRef.current, page.cursor);
        if (page.events.length === 0) return;

        void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_PATH_KEY });
        void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_CERTIFICATE_KEY });
        const touched = new Set(
          page.events
            .map((event) => event.topicId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        for (const topicId of touched) {
          void queryClient.invalidateQueries({ queryKey: filmAcademyTopicKey(topicId) });
        }
      } catch {
        // Notification only. The path/topic queries remain authoritative.
      } finally {
        inFlight.current = false;
      }
    };

    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, queryClient]);
}
