import test from 'node:test';
import assert from 'node:assert/strict';

import { consultTimer, formatConsultClock, serverOffsetMs } from '../sessionTimer.ts';

const at = (iso: string) => Date.parse(iso);

const base = {
  endsAt: '2026-11-04T10:30:00Z',
  warnAt: '2026-11-04T10:25:00Z',
  serverNow: '2026-11-04T10:20:00Z',
  state: 'live' as const,
  extendable: true,
};

test('counts down on the server clock, not the device clock', () => {
  // The device is five minutes slow. Trusting it would show 15 minutes left;
  // the session has 10.
  const deviceNow = at('2026-11-04T10:15:00Z');
  const offset = serverOffsetMs(base.serverNow, deviceNow);
  const timer = consultTimer(base, deviceNow, offset);
  assert.equal(timer.remainingSeconds, 600);
  assert.equal(timer.label, '10:00');
  assert.equal(timer.phase, 'ok');
  assert.equal(timer.canExtend, true);
});

test('projects elapsed time past the last poll with the captured offset', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  const timer = consultTimer(base, receivedAt + 90_000, offset);
  assert.equal(timer.remainingSeconds, 510); // 8m30s
  assert.equal(timer.phase, 'ok');
});

test('warning begins exactly at the server warn_at, not five minutes before ends_at', () => {
  const receivedAt = at('2026-11-04T10:24:59Z');
  const offset = serverOffsetMs(new Date(receivedAt).toISOString(), receivedAt);
  assert.equal(consultTimer(base, receivedAt, offset).phase, 'ok');
  assert.equal(consultTimer(base, receivedAt + 1_000, offset).phase, 'warning');
});

test('ends at 0:00 and stops offering an extension', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  const timer = consultTimer(base, at(base.endsAt), offset);
  assert.equal(timer.phase, 'expired');
  assert.equal(timer.remainingSeconds, 0);
  assert.equal(timer.label, '00:00');
  assert.equal(timer.canExtend, false);
});

test('an ended or cancelled session is expired even when its clock has time left', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  for (const state of ['ended', 'cancelled'] as const) {
    const timer = consultTimer({ ...base, state }, receivedAt, offset);
    assert.equal(timer.phase, 'expired', state);
    assert.equal(timer.canExtend, false, state);
  }
});

test('a session the server marks non-extendable never offers an extension', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  assert.equal(consultTimer({ ...base, extendable: false }, receivedAt, offset).canExtend, false);
});

test('an unreadable ends_at fails closed instead of running media indefinitely', () => {
  const timer = consultTimer({ ...base, endsAt: 'not-a-date' }, at(base.serverNow), 0);
  assert.equal(timer.phase, 'expired');
  assert.equal(timer.canExtend, false);
});

test('formatConsultClock keeps mm:ss under an hour and adds hours above it', () => {
  assert.equal(formatConsultClock(0), '00:00');
  assert.equal(formatConsultClock(59), '00:59');
  assert.equal(formatConsultClock(600), '10:00');
  assert.equal(formatConsultClock(3661), '1:01:01');
});
