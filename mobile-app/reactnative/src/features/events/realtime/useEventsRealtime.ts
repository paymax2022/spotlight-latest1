// ── Events realtime (SSE) client ─────────────────────────────────────────────
//
// Opt-in Server-Sent Events push for the organiser's live check-in feed. When
// a scan is accepted (backend: Service.publishCheckinSafe, called from
// ScanTicket), the organiser and any current stewards for that event get an
// `events.checkin` frame, and this hook nudges React Query to refetch the
// affected event's attendee roster + the organiser's own event stats
// immediately instead of waiting for the next poll. The normal poll on those
// queries stays in place as the safety net — this hook only ADDS
// invalidations, it never replaces them.
//
// Same transport, same gating, same shared /api/v1/realtime/stream connection
// as useMarketplaceRealtime — see that file's header comment for the full
// rationale (react-native-sse for custom headers, auto-reconnect, the
// frontend-web proxy). Both hooks share ONE Hub instance server-side (see
// backend/internal/app/router.go) and can be mounted in the same app without
// opening two connections' worth of server load — react-native-sse doesn't
// dedupe connections across hook instances, though, so mount this ONCE,
// where the organiser dashboard lives.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import EventSource from 'react-native-sse';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { useAuthStore } from '@/store/authStore';
import { USE_MOCK } from '../constants/events.constants';
import { KEYS } from '../hooks';

const REALTIME_ENABLED = (process.env.EXPO_PUBLIC_REALTIME_ENABLED ?? 'false') === 'true';

const BASE_URL = getDevUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');

type EventsSSEEvent = 'events.checkin';

interface CheckinPayload {
  event_id: string;
  ticket_id: string;
  credential_id: string;
  scanned_at: string;
}

/**
 * Mount ONCE where the organiser dashboard lives. Safe to no-op: when the
 * flag is off / mock mode / signed out, it opens nothing and attendee/
 * dashboard screens keep polling exactly as before.
 */
export function useEventsRealtime(): void {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!REALTIME_ENABLED || USE_MOCK || !userId) return;

    let es: EventSource<EventsSSEEvent> | null = null;
    let cancelled = false;

    (async () => {
      let token: string | null = null;
      try {
        const supabase = createSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token ?? null;
      } catch {
        token = null;
      }
      if (cancelled || !token) return;

      es = new EventSource<EventsSSEEvent>(`${BASE_URL}/api/v1/realtime/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        pollingInterval: 0,
      });

      es.addEventListener('events.checkin', (event) => {
        if (event.type !== 'events.checkin' || !event.data) return;
        try {
          const payload = JSON.parse(event.data) as CheckinPayload;
          if (!payload?.event_id) return;
          queryClient.invalidateQueries({ queryKey: KEYS.attendees(payload.event_id) });
          queryClient.invalidateQueries({ queryKey: KEYS.organiser });
        } catch {
          /* ignore unparseable frames — polling remains the safety net */
        }
      });

      es.addEventListener('error', () => { /* auto-reconnect handled by the lib */ });
    })();

    return () => {
      cancelled = true;
      if (es) {
        es.removeAllEventListeners();
        es.close();
        es = null;
      }
    };
  }, [queryClient, userId]);
}
