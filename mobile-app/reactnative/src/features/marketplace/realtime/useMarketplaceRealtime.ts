// ── Marketplace realtime (SSE) client ────────────────────────────────────────
//
// Opt-in Server-Sent Events push for the Deal Room chat. When enabled, it lets
// the backend nudge React Query to refetch the affected thread the instant a
// message lands, instead of waiting up to MESSAGE_POLL_MS for the next poll. The
// existing polling in transact.hooks.ts stays in place as the safety net — this
// hook only ADDS invalidations; it never replaces the polls.
//
// Transport: react-native-sse's EventSource polyfill (pure JS, supports custom
// request headers — the browser/RN EventSource does NOT, which is why we need it
// to attach the Supabase Bearer). It auto-reconnects on error/close with backoff,
// so we don't hand-roll reconnection; we just (re)connect with a fresh token.
//
// Gating (ALL must hold, else this hook is inert and we fall back to polling):
//   • EXPO_PUBLIC_REALTIME_ENABLED === 'true'   (OFF by default)
//   • NOT MKT_USE_MOCK                           (mock mode has no backend)
//   • the user is signed in                      (a stream needs an auth token)
//
// Mirrors the axios client: same baseURL (getDevUrl + EXPO_PUBLIC_API_BASE_URL)
// and same token source (supabase.auth.getSession().access_token). The proxy at
// frontend-web/app/api/v1/realtime/[...path]/route.ts forwards the stream to Go.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import EventSource from 'react-native-sse';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { useAuthStore } from '@/store/authStore';
import { MKT_USE_MOCK } from '../api/client';
import { TX_KEYS } from '../api/transact.hooks';

// Only the literal 'true' turns realtime on; anything else (incl. unset) is OFF.
const REALTIME_ENABLED = (process.env.EXPO_PUBLIC_REALTIME_ENABLED ?? 'false') === 'true';

// Same base as @/api/client — the frontend-web Next.js server that hosts the proxy.
const BASE_URL = getDevUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');

// The single custom SSE event the marketplace stream emits.
type MktEvent = 'mkt.message.created';

interface MessageCreatedPayload {
  threadId: string;
  message: { id: string; threadId: string; senderId: string; text: string; createdAt: string };
}

/**
 * Mount ONCE where marketplace chat lives (the Deals inbox layout/screen) so it
 * stays connected while the user is in the marketplace. Safe to no-op: when the
 * flag is off / mock mode / signed out, it opens nothing and the app keeps
 * polling exactly as before.
 */
export function useMarketplaceRealtime(): void {
  const queryClient = useQueryClient();
  // Signed-in gate. Re-runs the effect on sign-in/out so we connect/tear down.
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!REALTIME_ENABLED || MKT_USE_MOCK || !userId) return;

    let es: EventSource<MktEvent> | null = null;
    let cancelled = false;

    (async () => {
      // Fetch a fresh session token at (re)connect time. Supabase auto-refreshes
      // the session, so getSession() returns the current, non-expired access token.
      let token: string | null = null;
      try {
        const supabase = createSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token ?? null;
      } catch {
        token = null;
      }
      if (cancelled || !token) return;

      es = new EventSource<MktEvent>(`${BASE_URL}/api/v1/realtime/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        // Let react-native-sse own reconnection (it re-opens with the same headers).
        pollingInterval: 0,
      });

      es.addEventListener('mkt.message.created', (event) => {
        // event.data is the raw SSE `data:` line (JSON). Guard the parse — a
        // malformed frame must never crash the stream handler.
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data) as MessageCreatedPayload;
          if (!payload?.threadId) return;
          // Nudge the affected thread + the inbox to refetch immediately.
          queryClient.invalidateQueries({ queryKey: TX_KEYS.messages(payload.threadId) });
          queryClient.invalidateQueries({ queryKey: TX_KEYS.threads });
        } catch {
          /* ignore unparseable frames — polling remains the safety net */
        }
      });

      // react-native-sse auto-reconnects on 'error'/timeout; nothing to do here
      // beyond swallowing the event so it doesn't surface as an unhandled listener.
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
