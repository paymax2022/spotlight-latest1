// Presents a local OS notification the moment an estate election becomes live,
// so residents are alerted even with the app backgrounded. The backend should
// also send a real push with the same { type:'election_live', electionId }
// payload; this client bridge is the foreground/polling fallback. Fires once
// per election per app session.

import { useEffect } from 'react';
import { presentLocalNotification } from '@/lib/push';
import { useActiveElection } from './useElection';

const announced = new Set<string>();

export function useElectionPushBridge(enabled: boolean): void {
  // `enabled` must gate the QUERY, not just the effect below. This hook is
  // mounted from the root layout, so while it ran unconditionally a SIGNED-OUT
  // user polled this resident-scoped endpoint every 30s from every screen — and
  // each 401 hits the global handler, which replaces the route with the login
  // screen. That made /signup unreachable: you were bounced before you could
  // type. Mirrors useVisitorPushBridge, which gates its query correctly.
  const { data } = useActiveElection(enabled);

  useEffect(() => {
    if (!enabled || !data || announced.has(data.id)) return;
    announced.add(data.id);
    presentLocalNotification(
      'Estate election is live',
      `${data.title} — tap to cast your vote.`,
      { type: 'election_live', electionId: data.id },
    );
  }, [enabled, data?.id]);
}
