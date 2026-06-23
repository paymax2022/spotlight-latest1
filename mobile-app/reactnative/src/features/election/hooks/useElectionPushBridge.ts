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
  const { data } = useActiveElection();

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
