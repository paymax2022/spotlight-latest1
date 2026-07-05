// ── Restaurant & Delivery — Order realtime hook ──────────────────────────────
// Layers live order updates on top of the polled order: subscribes to the
// per-order WebSocket (GET /api/finance/restaurant/orders/:id/ws) and surfaces
// the latest status, rider location, and incoming chat messages. Polling stays
// the fallback whenever the socket is unavailable (cold start, reconnect, or
// EXPO_PUBLIC_FOOD_USE_MOCK, under which no socket is opened — mirrors
// useTripRealtime/useTripTracking).

import { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { api } from '@/api/client';
import { USE_MOCK } from './api';
import type { ChatMessage, LatLng, OrderStatus, OrderFrame } from './types';
import { isLiveTrackable, isTerminalStatus } from './utils';

// Build the legacy ws(s):// URL for an order, off the same API base the axios
// client uses. Kept as a fallback for when the signed-ticket endpoint (below)
// is unreachable.
function orderWsUrl(orderId: string): string {
  const base = getDevUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');
  const path = `/api/finance/restaurant/orders/${encodeURIComponent(orderId)}/ws`;
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + path;
}

// Resolve the live-tracking socket URL. In production the Next.js HTTP proxy
// cannot upgrade WebSockets, so the app first asks the authenticated ticket
// endpoint (GET /api/v1/restaurant/orders/:id/ws) for a short-lived signed
// ws(s):// URL that points DIRECTLY at the Go backend. If that call fails we
// fall back to the legacy direct URL so dev/mock behaviour is unchanged.
async function resolveOrderWsUrl(orderId: string): Promise<string> {
  try {
    // The axios client's request interceptor attaches the Supabase Bearer token,
    // so the ticket endpoint authenticates the caller without extra wiring here.
    const res = await api.get<{ url?: string; data?: { url?: string } }>(
      `/api/v1/restaurant/orders/${encodeURIComponent(orderId)}/ws`,
    );
    const url = res.data?.url ?? res.data?.data?.url;
    if (url) return url;
  } catch {
    /* fall back to the legacy direct URL below */
  }
  return orderWsUrl(orderId);
}

export interface OrderRealtimeState {
  /** Latest status pushed over the socket (null until a frame arrives). */
  status: OrderStatus | null;
  /** Latest live rider position, or null. */
  riderLocation: LatLng | null;
  /** Messages received over the socket since mount (screens merge with the REST list). */
  messages: ChatMessage[];
  /** True while the live socket is connected. */
  live: boolean;
  /** True when realtime is active (not mock, has an order, still trackable). */
  realtimeEnabled: boolean;
}

export interface UseOrderRealtimeOptions {
  /** Current order status — the socket only stays open while the order is live. */
  status?: OrderStatus;
  /** Keep the socket open for chat even when the order isn't location-trackable. */
  chatOnly?: boolean;
}

/**
 * useOrderRealtime subscribes to an order's WebSocket and decodes the three
 * frame types into typed state. When mocking (or before/after a live order) it
 * stays idle and the screens rely on their React Query poll instead.
 */
export function useOrderRealtime(
  orderId?: string,
  options?: UseOrderRealtimeOptions,
): OrderRealtimeState {
  const status = options?.status;
  // Subscribe while the order is en route, or always when chat is needed and the
  // order isn't terminal.
  const open =
    !!orderId &&
    (options?.chatOnly ? !status || !isTerminalStatus(status) : !status || isLiveTrackable(status));
  const realtimeEnabled = !USE_MOCK && open;

  const [liveStatus, setLiveStatus] = useState<OrderStatus | null>(null);
  const [riderLocation, setRiderLocation] = useState<LatLng | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!realtimeEnabled || !orderId) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
      retryRef.current += 1;
      timer = setTimeout(connect, delay);
    };

    const handleFrame = (frame: OrderFrame) => {
      switch (frame.type) {
        case 'order.status':
          if (frame.payload.order_id === orderId) setLiveStatus(frame.payload.status);
          break;
        case 'order.location':
          if (frame.payload.order_id === orderId)
            setRiderLocation({ lat: frame.payload.lat, lng: frame.payload.lng });
          break;
        case 'order.message': {
          const p = frame.payload;
          if (p.order_id !== orderId) break;
          setMessages((prev) =>
            prev.some((m) => m.id === p.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: p.id,
                    orderId: p.order_id,
                    senderRole: p.sender_role,
                    senderName: p.sender_name,
                    body: p.body,
                    attachmentUrl: p.attachment_url ?? null,
                    createdAt: p.created_at,
                  },
                ],
          );
          break;
        }
      }
    };

    const connect = async () => {
      if (stoppedRef.current) return;
      let token: string | undefined;
      try {
        const supabase = createSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token;
      } catch {
        /* connect unauthenticated — server will reject, then we back off */
      }
      try {
        // Prefer the signed direct-to-backend URL (carries auth in its query),
        // falling back to the legacy header-auth URL on the same Next.js base.
        const wsUrl = await resolveOrderWsUrl(orderId);
        const usingTicket = wsUrl !== orderWsUrl(orderId);
        const WS = WebSocket as unknown as new (
          url: string,
          protocols?: string | string[],
          options?: { headers?: Record<string, string> },
        ) => WebSocket;
        const ws = new WS(wsUrl, undefined, {
          // The signed URL already authenticates via its ?ticket= query, so the
          // header is only needed on the legacy fallback path.
          headers: !usingTicket && token ? { Authorization: `Bearer ${token}` } : {},
        });
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          retryRef.current = 0;
        };
        ws.onmessage = (e: WebSocketMessageEvent) => {
          try {
            const raw = typeof e.data === 'string' ? e.data : '';
            const msg = JSON.parse(raw) as OrderFrame;
            if (msg?.type) handleFrame(msg);
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = () => {
          setConnected(false);
          if (!stoppedRef.current) scheduleReconnect();
        };
        ws.onerror = () => {
          try {
            ws.close();
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
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, [realtimeEnabled, orderId]);

  return {
    status: liveStatus,
    riderLocation,
    messages,
    live: realtimeEnabled && connected,
    realtimeEnabled,
  };
}
