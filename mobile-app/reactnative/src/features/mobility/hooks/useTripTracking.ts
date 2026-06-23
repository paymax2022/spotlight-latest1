import { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { tripWsUrl } from '../api/tracking.api';

export interface TripPosition {
  lat: number;
  lng: number;
  heading?: number;
  speedMps?: number;
  snappedPolyline?: string;
  ts: number;
}

/**
 * useTripTracking subscribes to a trip's live position over the backend
 * WebSocket. The backend pushes "trip.position" messages (snapped via OSRM
 * map-matching) to the rider + driver channels; we filter by trip_id. Auto-
 * reconnects with backoff. No-ops when tripId is undefined.
 */
export function useTripTracking(tripId?: string) {
  const [position, setPosition] = useState<TripPosition | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!tripId) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
      retryRef.current += 1;
      timer = setTimeout(connect, delay);
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
        // RN's WebSocket accepts a 3rd `options` arg (headers) at runtime, but
        // its TS type only declares (url, protocols). Construct via an any-cast.
        const WS = WebSocket as unknown as new (
          url: string,
          protocols?: string | string[],
          options?: { headers?: Record<string, string> },
        ) => WebSocket;
        const ws = new WS(tripWsUrl(), undefined, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          retryRef.current = 0;
        };
        ws.onmessage = (e: WebSocketMessageEvent) => {
          try {
            const raw = typeof e.data === 'string' ? e.data : '';
            const msg = JSON.parse(raw);
            if (msg?.type === 'trip.position' && msg.payload?.trip_id === tripId) {
              const p = msg.payload;
              setPosition({
                lat: p.lat,
                lng: p.lng,
                heading: p.heading,
                speedMps: p.speed_mps,
                snappedPolyline: p.snapped_polyline,
                ts: p.ts,
              });
            }
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
  }, [tripId]);

  return { position, connected };
}
