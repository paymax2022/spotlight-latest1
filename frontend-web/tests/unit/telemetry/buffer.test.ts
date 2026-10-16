import { describe, it, expect, vi } from 'vitest';
import { createTelemetryBuffer } from '@/src/features/telemetry/buffer';

const ev = (i = 0) => ({ surface: 'web' as const, route: `/r${i}`, occurred_at: 't' });

function harness(over: Record<string, unknown> = {}) {
  const send = vi.fn().mockResolvedValue(undefined);
  let tick: () => void = () => {};
  let hidden: () => void = () => {};
  let pagehide: () => void = () => {};
  const stopTimer = vi.fn();
  const unsub = vi.fn();
  const buf = createTelemetryBuffer({
    send,
    startTimer: (cb) => { tick = cb; return stopTimer; },
    onHidden: (cb) => { hidden = cb; return unsub; },
    onPageHide: (cb) => { pagehide = cb; return unsub; },
    ...over,
  });
  return { buf, send, tick: () => tick(), hidden: () => hidden(), pagehide: () => pagehide(), stopTimer, unsub };
}

describe('telemetry buffer', () => {
  it('flushes at size', () => {
    const h = harness({ flushSize: 3 });
    h.buf.record(ev(1)); h.buf.record(ev(2));
    expect(h.send).not.toHaveBeenCalled();
    h.buf.record(ev(3));
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toHaveLength(3);
    expect(h.buf.size()).toBe(0);
  });
  it('flushes on timer, hidden, pagehide, flushNow', () => {
    const h = harness();
    h.buf.record(ev(1)); h.tick();
    h.buf.record(ev(2)); h.hidden();
    h.buf.record(ev(3)); h.pagehide();
    h.buf.record(ev(4)); h.buf.flushNow();
    expect(h.send).toHaveBeenCalledTimes(4);
  });
  it('empty flush sends nothing', () => {
    const h = harness();
    h.buf.flushNow();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('rejecting or throwing sender does not throw', async () => {
    const h = harness({ send: () => Promise.reject(new Error('x')), flushSize: 1 });
    expect(() => h.buf.record(ev())).not.toThrow();
    const h2 = harness({ send: () => { throw new Error('x'); }, flushSize: 1 });
    expect(() => h2.buf.record(ev())).not.toThrow();
    await Promise.resolve();
  });
  it('caps at 200 dropping oldest', () => {
    const h = harness({ flushSize: 10_000 });
    for (let i = 0; i < 205; i++) h.buf.record(ev(i));
    expect(h.buf.size()).toBe(200);
    expect(h.buf.peek()[0].route).toBe('/r5');
  });
  it('dispose stops timer and listeners', () => {
    const h = harness();
    h.buf.dispose();
    expect(h.stopTimer).toHaveBeenCalled();
    expect(h.unsub).toHaveBeenCalledTimes(2);
  });
});
