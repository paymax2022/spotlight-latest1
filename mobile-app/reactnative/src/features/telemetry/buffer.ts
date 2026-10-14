// In-memory, bounded, best-effort buffer for navigation events.
export interface NavEvent {
  surface: 'mobile';
  route: string;
  occurred_at: string;
}

export interface BufferOptions {
  send: (batch: NavEvent[]) => Promise<unknown> | unknown;
  flushSize?: number;
  cap?: number;
  intervalMs?: number;
  /** Starts the periodic flush; returns a stopper. Injectable for tests. */
  startTimer?: (cb: () => void, ms: number) => () => void;
  /** Subscribes to app-backgrounded; returns an unsubscriber. */
  onBackground?: (cb: () => void) => () => void;
}

export function createTelemetryBuffer(opts: BufferOptions) {
  const flushSize = opts.flushSize ?? 20;
  const cap = opts.cap ?? 200;
  const intervalMs = opts.intervalMs ?? 30_000;
  let events: NavEvent[] = [];

  function flushNow(): void {
    if (events.length === 0) return;
    const batch = events;
    events = [];
    try {
      Promise.resolve(opts.send(batch)).catch(() => { /* best-effort: drop */ });
    } catch { /* best-effort: drop */ }
  }

  function record(e: NavEvent): void {
    events.push(e);
    if (events.length > cap) events = events.slice(events.length - cap);
    if (events.length >= flushSize) flushNow();
  }

  const stopTimer = opts.startTimer?.(flushNow, intervalMs);
  const unsubBg = opts.onBackground?.(flushNow);

  return {
    record,
    flushNow,
    size: () => events.length,
    peek: () => events.slice(),
    dispose() { stopTimer?.(); unsubBg?.(); },
  };
}
