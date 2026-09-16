// ── Restaurant & Delivery — merchant queue realtime ──────────────────────────
//
// Decision record: ADR-049.
//
// WHY THIS EXISTS, SEPARATELY FROM useOrderRealtime
// useOrderRealtime subscribes to ONE order and drops every frame whose
// `order_id` is not that order. A merchant's problem is the opposite: the order
// they most need to hear about is the one they have not been told about yet, so
// there is no id to subscribe with. The queue therefore polled every 6 seconds
// and a new order could sit unseen for that long.
//
// The backend hub is keyed by USER id (Realtime.publish → hub.SendToUser), so a
// single user-scoped socket already carries every frame for every one of this
// merchant's orders, including ones placed after the socket opened. This hook
// opens that socket and, rather than decoding frames into state, simply
// invalidates the order queries — react-query then refetches through the normal
// authenticated path, so the LIST stays the single source of truth and a frame
// can never paint an order the server would not have returned.
//
// Polling stays as the fallback (mock mode, cold start, a dropped socket).

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { openWebSocket } from '@/lib/nativeWebSocket';
import { api } from '@/api/client';
import { USE_MOCK } from './api';
import type { OrderFrame } from './types';

/** Legacy direct URL, used when the signed-ticket endpoint is unreachable. */
function userWsUrl(): string {
  const base = getDevUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/finance/restaurant/ws';
}

async function resolveUserWsUrl(): Promise<string> {
  try {
    // The axios interceptor attaches the Supabase Bearer token, so the ticket
    // endpoint authenticates the caller with no extra wiring here.
    const res = await api.get<{ url?: string; data?: { url?: string } }>('/api/v1/restaurant/ws');
    const url = res.data?.url ?? res.data?.data?.url;
    if (url) return url;
  } catch {
    /* fall back to the legacy direct URL below */
  }
  return userWsUrl();
}

export interface QueueRealtimeState {
  /** True while the socket is connected — screens show a "Live" pill off this. */
  live: boolean;
  /** True when realtime is even attempted (false under mock). */
  realtimeEnabled: boolean;
}

/**
 * Keeps the caller's food-order queries fresh from the user-scoped socket.
 *
 * `enabled` lets a screen stand the socket down when it is not showing a queue
 * (the merchant console's Earnings tab, say) without unmounting the hook.
 */
export function useRestaurantQueueRealtime(enabled = true): QueueRealtimeState {
  const qc = useQueryClient();
  const realtimeEnabled = !USE_MOCK && enabled;

  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!realtimeEnabled) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      // Same capped backoff as useOrderRealtime — a backend restart must not
      // turn every merchant device into a reconnect storm.
      const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
      retryRef.current += 1;
      timer = setTimeout(connect, delay);
    };

    const onFrame = (frame: OrderFrame) => {
      // Deliberately coarse. Any order event may have changed the queue's
      // membership or ordering, and refetching is cheap next to reconstructing
      // the list from frames — which would also mean trusting a socket payload
      // over the authenticated read.
      qc.invalidateQueries({ queryKey: ['food', 'orders'] });
      const orderId = frame.payload?.order_id;
      if (orderId) qc.invalidateQueries({ queryKey: ['food', 'order', orderId] });
    };

    const connect = async () => {
      if (stoppedRef.current) return;
      let token: string | undefined;
      try {
        const supabase = createSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token;
      } catch {
        /* connect unauthenticated — the server rejects, then we back off */
      }
      try {
        const wsUrl = await resolveUserWsUrl();
        const usingTicket = wsUrl !== userWsUrl();
        const ws = openWebSocket(
          wsUrl,
          // The signed URL authenticates via its ?ticket= query; the header is
          // only needed on the legacy fallback path (and only takes effect on
          // native — see nativeWebSocket.ts for why web can't use it at all).
          !usingTicket && token ? { Authorization: `Bearer ${token}` } : {},
        );
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          retryRef.current = 0;
          // A socket that has just (re)connected may have missed events while
          // it was down, so resync rather than assuming the cache is current.
          qc.invalidateQueries({ queryKey: ['food', 'orders'] });
        };
        ws.onmessage = (e: WebSocketMessageEvent) => {
          try {
            const raw = typeof e.data === 'string' ? e.data : '';
            const msg = JSON.parse(raw) as OrderFrame;
            if (msg?.type) onFrame(msg);
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = () => {
          setConnected(false);
          if (!stoppedRef.current) scheduleReconnect();
        };
        ws.onerror = () => {
          try { ws.close(); } catch { /* noop */ }
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, [realtimeEnabled, qc]);

  return { live: realtimeEnabled && connected, realtimeEnabled };
}
