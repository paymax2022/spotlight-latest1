// Mirrors newly-arrived in-app visitor notifications as local OS notifications,
// so residents get an alert (e.g. "Visitor at the gate", "Visitor checked in")
// even when not on the notifications screen. The backend should also send a real
// push with the matching { type:'visitor_*', accessCodeId } payload; this client
// bridge polls and is the foreground fallback. Primes silently on first load so
// existing notifications don't fire a burst.

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { presentLocalNotification } from '@/lib/push';
import * as api from '../api/visitor.api';
import { visitorKeys } from './useVisitor';

export function useVisitorPushBridge(enabled: boolean): void {
  const { data } = useQuery({
    queryKey: visitorKeys.notifications(),
    queryFn: api.listNotifications,
    enabled,
    refetchInterval: enabled ? 20_000 : false,
  });

  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (!data) return;
    if (!primed.current) {
      data.forEach((n) => seen.current.add(n.id));
      primed.current = true;
      return;
    }
    for (const n of data) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (!n.read) {
        presentLocalNotification(n.title, n.body, { type: `visitor_${n.type}`, accessCodeId: n.accessCodeId });
      }
    }
  }, [data]);
}
