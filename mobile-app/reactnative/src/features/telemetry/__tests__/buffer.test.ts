import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryBuffer, type NavEvent } from '../buffer.ts';

const ev = (n: number): NavEvent => ({ surface: 'mobile', route: `/r${n}`, occurred_at: 'now' });

function setup(over: Record<string, unknown> = {}) {
  const sent: NavEvent[][] = [];
  let bg: (() => void) | null = null;
  const b = createTelemetryBuffer({
    send: async (batch) => { sent.push(batch); },
    flushSize: 20,
    cap: 200,
    startTimer: () => () => {},
    onBackground: (cb) => { bg = cb; return () => {}; },
    ...over,
  });
  return { b, sent, fireBg: () => bg?.() };
}

describe('telemetry buffer', () => {
  test('flushes at size 20', () => {
    const { b, sent } = setup();
    for (let i = 0; i < 19; i++) b.record(ev(i));
    assert.equal(sent.length, 0);
    b.record(ev(19));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].length, 20);
  });
  test('flushes on background', () => {
    const { b, sent, fireBg } = setup();
    b.record(ev(1));
    fireBg();
    assert.equal(sent.length, 1);
  });
  test('flushNow flushes; empty flush sends nothing', () => {
    const { b, sent } = setup();
    b.flushNow();
    assert.equal(sent.length, 0);
    b.record(ev(1));
    b.flushNow();
    assert.equal(sent.length, 1);
  });
  test('timer triggers flush', () => {
    let tick: () => void = () => {};
    const { b, sent } = setup({ startTimer: (cb: () => void) => { tick = cb; return () => {}; } });
    b.record(ev(1));
    tick();
    assert.equal(sent.length, 1);
  });
  test('rejecting or throwing sender never throws', async () => {
    const { b } = setup({ send: async () => { throw new Error('boom'); } });
    for (let i = 0; i < 20; i++) b.record(ev(i));
    b.flushNow();
    const { b: b2 } = setup({ send: () => { throw new Error('sync'); } });
    for (let i = 0; i < 20; i++) b2.record(ev(i));
    await new Promise((r) => setTimeout(r, 5));
  });
  test('respects cap, dropping oldest', () => {
    const { b } = setup({ flushSize: 1000, cap: 5 });
    for (let i = 0; i < 9; i++) b.record(ev(i));
    assert.equal(b.size(), 5);
    assert.equal(b.peek()[0].route, '/r4');
  });
});
