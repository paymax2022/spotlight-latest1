// Display rules for one consult session. Pure functions, no React and no
// imports outside this folder, so the node test runner can load this file
// without the app's `@/` alias.

import type { ConsultExtension, ConsultSession } from './types';

export type ConsultViewer = 'patient' | 'provider' | 'observer';

/** The room opens this long before the booked start, the same window the server allows. */
export const EARLY_JOIN_MS = 10 * 60 * 1000;

/** Mirrors consultengine.MaxExtensionMinutes and MaxSessionWindow. */
export const MAX_EXTENSION_MINUTES = 240;
export const MAX_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

export function viewerOf(
  session: Pick<ConsultSession, 'patient_id' | 'provider_user_id'>,
  userId?: string | null,
): ConsultViewer {
  if (!userId) return 'observer';
  if (userId === session.patient_id) return 'patient';
  if (userId === session.provider_user_id) return 'provider';
  return 'observer';
}

/** `projectedNowMs` must already include the server-clock offset (serverOffsetMs). */
export function canJoinNow(
  session: Pick<ConsultSession, 'state' | 'booked_start' | 'ends_at'>,
  projectedNowMs: number,
): boolean {
  if (session.state === 'ended' || session.state === 'cancelled') return false;
  const ends = Date.parse(session.ends_at);
  if (Number.isFinite(ends) && projectedNowMs >= ends) return false;
  if (session.state === 'live') return true;
  const start = Date.parse(session.booked_start);
  if (!Number.isFinite(start)) return false;
  return projectedNowMs + EARLY_JOIN_MS >= start;
}

export function openExtension(extensions: ConsultExtension[] | undefined): ConsultExtension | undefined {
  return extensions?.find(
    (ext) => ext.status === 'pending_approval' || ext.status === 'approved_awaiting_payment',
  );
}

export type ExtensionActionKind = 'request' | 'approve' | 'pay' | 'wait' | 'closed' | 'none';

export interface ExtensionAction {
  kind: ExtensionActionKind;
  label: string;
  extensionId?: string;
  amountKobo?: number;
}

/**
 * What the current viewer can do about the one open extension, if any.
 * The server re-checks all of it — this only decides which control to show.
 */
export function extensionAction(
  ext: ConsultExtension | undefined,
  viewer: ConsultViewer,
  projectedNowMs: number,
): ExtensionAction {
  if (viewer === 'observer') return { kind: 'none', label: '' };
  if (!ext) return { kind: 'request', label: 'Extend session' };
  switch (ext.status) {
    case 'pending_approval':
      return viewer === 'provider'
        ? { kind: 'approve', label: 'Review request', extensionId: ext.id }
        : { kind: 'wait', label: 'Waiting for provider approval', extensionId: ext.id };
    case 'approved_awaiting_payment': {
      const expires = ext.payment_expires_at ? Date.parse(ext.payment_expires_at) : NaN;
      if (!Number.isFinite(expires) || projectedNowMs >= expires) {
        return { kind: 'closed', label: 'Approval expired', extensionId: ext.id };
      }
      return viewer === 'patient'
        ? { kind: 'pay', label: 'Pay to extend', extensionId: ext.id, amountKobo: ext.price_kobo }
        : { kind: 'wait', label: 'Waiting for patient payment', extensionId: ext.id };
    }
    case 'paid':
      return { kind: 'none', label: `Extended by ${ext.added_minutes} min`, extensionId: ext.id };
    case 'declined':
    case 'expired':
    case 'cancelled':
      return { kind: 'request', label: 'Request again' };
    default:
      return { kind: 'none', label: '' };
  }
}

/**
 * Whole minutes the server will still accept on top of this session. The
 * engine refuses an extension that would push the session past booked_start +
 * four hours, and caps any single extension at 240 minutes.
 */
export function maxExtensionMinutes(
  session: Pick<ConsultSession, 'booked_start' | 'ends_at'>,
): number {
  const start = Date.parse(session.booked_start);
  const ends = Date.parse(session.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(ends)) return 0;
  const headroom = start + MAX_SESSION_WINDOW_MS - ends;
  return Math.max(0, Math.min(MAX_EXTENSION_MINUTES, Math.floor(headroom / 60_000)));
}
