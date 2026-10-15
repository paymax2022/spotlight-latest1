// In-memory, bounded, best-effort buffer for navigation events.
export interface NavEvent {
  surface: 'web';
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
  /** Subscribes to document visibility -> hidden; returns an unsubscriber. */
  onHidden?: (cb: () => void) => () => void;
  /** Subscribes to window pagehide; returns an unsubscriber. */
  onPageHide?: (cb: () => void) => () => void;
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
    try {
      events.push(e);
      if (events.length > cap) events = events.slice(events.length - cap);
      if (events.length >= flushSize) flushNow();
    } catch { /* never throw into the app */ }
  }

  const stopTimer = opts.startTimer?.(flushNow, intervalMs);
  const unsubHidden = opts.onHidden?.(flushNow);
  const unsubPageHide = opts.onPageHide?.(flushNow);

  return {
    record,
    flushNow,
    size: () => events.length,
    peek: () => events.slice(),
    dispose() { stopTimer?.(); unsubHidden?.(); unsubPageHide?.(); },
  };
}

/** Real-browser wiring for the injectable hooks. */
export function browserBufferOptions(): Pick<BufferOptions, 'startTimer' | 'onHidden' | 'onPageHide'> {
  return {
    startTimer: (cb, ms) => {
      const id = setInterval(cb, ms);
      return () => clearInterval(id);
    },
    onHidden: (cb) => {
      const h = () => { if (document.visibilityState === 'hidden') cb(); };
      document.addEventListener('visibilitychange', h);
      return () => document.removeEventListener('visibilitychange', h);
    },
    onPageHide: (cb) => {
      window.addEventListener('pagehide', cb);
      return () => window.removeEventListener('pagehide', cb);
    },
  };
}
