// The connect sequence, with every side effect injected so the race conditions can be unit-tested.
//
// The bug this exists to prevent: the screen can be left (or "Try again" pressed, which restarts
// the connect effect) while this is still awaiting. Every await below is followed by a check, and a
// connection that completes after the owner has gone is torn down, so no orphan room is left
// joined as the same user (which would also evict the new connection as DUPLICATE_IDENTITY).
import { isTokenUsable } from './connection';
import type { Connection } from './connection';

export interface ConnectDeps {
  connection: Connection;
  now(): number;
  /** A new token + URL from the API, or null when that is not possible. */
  fetchFresh(): Promise<Connection | null>;
  startAudio(): Promise<void>;
  connect(c: Connection): Promise<void>;
  disconnect(): Promise<void>;
  /** True once the effect that owns this attempt has been cleaned up. */
  isDisposed(): boolean;
}

export type ConnectOutcome =
  | { kind: 'connected' }
  | { kind: 'aborted' }                    // the owner left or restarted; nothing to report
  | { kind: 'expired' }                    // token expired and no fresh one is available
  | { kind: 'failed'; message: string };

const TOKEN_SKEW_MS = 15_000;
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export async function runConnect(d: ConnectDeps): Promise<ConnectOutcome> {
  let conn = d.connection;
  // A token that has expired (or is about to) can only fail: get a fresh one first.
  if (!isTokenUsable(conn.token, d.now(), TOKEN_SKEW_MS)) {
    let fresh: Connection | null;
    try {
      fresh = await d.fetchFresh();
    } catch {
      return d.isDisposed() ? { kind: 'aborted' } : { kind: 'expired' };
    }
    if (d.isDisposed()) return { kind: 'aborted' };
    if (!fresh) return { kind: 'expired' };
    conn = fresh;
  }
  if (d.isDisposed()) return { kind: 'aborted' };

  try {
    await d.startAudio();
  } catch (e) {
    return d.isDisposed() ? { kind: 'aborted' } : { kind: 'failed', message: message(e, 'Could not start the audio session.') };
  }
  if (d.isDisposed()) return { kind: 'aborted' };

  try {
    await d.connect(conn);
  } catch (e) {
    return d.isDisposed() ? { kind: 'aborted' } : { kind: 'failed', message: message(e, 'Could not connect to the class.') };
  }
  if (d.isDisposed()) {
    await d.disconnect().catch(() => undefined); // the connection finished after its owner left
    return { kind: 'aborted' };
  }
  return { kind: 'connected' };
}
