// ── Association — Group chat realtime ─────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { openWebSocket } from '@/lib/nativeWebSocket';
import { USE_MOCK, ASSOCIATION_API_BASE } from '../constants/association.constants';

const KEY = 'association';

// ws(s):// URL for the caller's own realtime stream, off the same API base the
// axios client uses (getDevUrl rewrites loopback for a physical device).
function chatWsUrl(): string {
  const base = getDevUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + ASSOCIATION_API_BASE + '/ws';
}

/** The frame the backend pushes on a committed message. */
interface ChatFrame {
  type?: string;
  payload?: { threadId?: string; id?: string };
}

/**
 * Keeps an open chat thread live.
 *
 * Association chat could send and fetch messages but never received one it had
 * not asked for: a member had to leave the thread and come back to see a reply.
 *
 * TRANSPORT: the backend's own WebSocket hub (platform/ws — the open-source
 * nhooyr/websocket server the food, mobility and doctor streams already use),
 * not a hosted realtime service. A message posted by any member of a thread is
 * pushed to every other member the API would let open it; a nil hub or an
 * unauthenticated socket simply leaves the screen on its normal fetches.
 *
 * INVALIDATES RATHER THAN APPENDING THE PAYLOAD. The pushed row is not the
 * thread's own read model: `mine` is stamped for the AUTHOR, and the audience
 * list carries no per-member reactions or unread state. Appending it to the
 * cache would render a message attributed to the wrong caller. Treating the
 * frame purely as a SIGNAL, and re-reading through the Go API, keeps the API the
 * only thing that decides what a member may see.
 *
 * Delivery is scoped by the backend's ChatThreadAudience gate — the same rule
 * GetChatThread applies, so a member cannot be pushed an executive or committee
 * message they could not fetch. See
 * backend/tests/association/chat_realtime_rls_test.go, which pins the push
 * audience against the API gate for the same users and threads.
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

  const retryRef = useRef(0);

  useEffect(() => {
    // Mock mode has no database behind it; opening a socket would only produce
    // a connection that never delivers.
    if (!threadId || USE_MOCK) return;
    // A browser cannot put the Authorization header on a WebSocket, and this
    // route has no ticket or cookie fallback (the food socket trades an HTTP
    // ticket for a signed ?ticket= URL; this one does not). A web socket could
    // therefore only ever 401 and re-loop, so web stays on its normal fetches.
    if (Platform.OS === 'web') return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
      retryRef.current += 1;
      timer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (stopped) return;
      let token: string | undefined;
      try {
        // The socket is Bearer-authenticated (the route sits behind
        // RequireAuthContext), so it must be handed the user's access token
        // BEFORE opening. A socket that connected as `anon` would be rejected at
        // the handshake — so without a token, do not open one at all.
        const supabase = createSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token;
      } catch {
        /* connect unauthenticated — server rejects, then we back off */
      }
      if (stopped) return;
      try {
        ws = openWebSocket(chatWsUrl(), token ? { Authorization: `Bearer ${token}` } : {});
        ws.onopen = () => {
          retryRef.current = 0;
        };
        ws.onmessage = (e: WebSocketMessageEvent) => {
          try {
            const raw = typeof e.data === 'string' ? e.data : '';
            const frame = JSON.parse(raw) as ChatFrame;
            if (frame?.type !== 'chat.message') return;
            // A user socket carries every thread's messages. Another thread's
            // message still changes the list (last message, unread count), so
            // only the open thread's own messages re-read that thread.
            if (frame.payload?.threadId === threadId) {
              refresh.current();
            } else {
              void qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] });
            }
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = () => {
          ws = null;
          scheduleReconnect();
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* noop */
          }
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    };
  }, [threadId, qc]);
}
