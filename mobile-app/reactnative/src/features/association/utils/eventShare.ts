// ── Association — Event sharing ───────────────────────────────────────────────
// Same shape as the membership-card share: the platform sheet where it exists,
// the clipboard where it does not. On the web build Share maps to
// navigator.share, which desktop Chrome does not implement, so without the
// fallback the button would do nothing on the surface this is tested on.

import { Share } from 'react-native';
import type { EventSummary } from '../types/community.types';

export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'failed';

/** Naira from kobo, for the fee line. */
function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

export function buildEventShareMessage(e: Pick<EventSummary, 'title' | 'startsAt' | 'location' | 'paid' | 'feeKobo'>): string {
  const lines = [e.title];
  const when = new Date(e.startsAt);
  if (!Number.isNaN(when.getTime())) {
    lines.push(when.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }));
  }
  if (e.location) lines.push(e.location);
  // A free event says so rather than saying nothing — "no price" reads as
  // "price not stated", which is the wrong impression to give about a ticket.
  lines.push(e.paid && e.feeKobo > 0 ? `Tickets ${naira(e.feeKobo)}` : 'Free to attend');
  lines.push('', 'Shared from Spotlight.');
  return lines.join('\n');
}

export async function shareEvent(e: Parameters<typeof buildEventShareMessage>[0]): Promise<ShareOutcome> {
  const message = buildEventShareMessage(e);
  try {
    const res = await Share.share({ message });
    return res.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    try {
      const Clipboard = require('expo-clipboard');
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(message);
        return 'copied';
      }
    } catch { /* fall through */ }
    return 'failed';
  }
}
