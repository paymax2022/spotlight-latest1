import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConnect } from '../connectFlow.ts';
import type { ConnectDeps } from '../connectFlow.ts';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number) => `${b64({ alg: 'HS256' })}.${b64({ exp })}.c2ln`;
const NOW = 1_700_000_000_000;
const fresh = jwt(NOW / 1000 + 600);
const stale = jwt(NOW / 1000 - 60);

function deps(over: Partial<ConnectDeps> = {}): { d: ConnectDeps; log: string[]; state: { disposed: boolean } } {
  const log: string[] = [];
  const state = { disposed: false };
  const d: ConnectDeps = {
    connection: { url: 'wss://rtc.example.com', token: fresh },
    now: () => NOW,
    fetchFresh: async () => { log.push('fetch'); return { url: 'wss://rtc.example.com', token: fresh }; },
    startAudio: async () => { log.push('audio'); },
    connect: async () => { log.push('connect'); },
    disconnect: async () => { log.push('disconnect'); },
    isDisposed: () => state.disposed,
    ...over,
  };
  return { d, log, state };
}

test('a usable token connects without asking for a new one', async () => {
  const { d, log } = deps();
  assert.deepEqual(await runConnect(d), { kind: 'connected' });
  assert.deepEqual(log, ['audio', 'connect']);
});

test('an expired token is replaced before dialling', async () => {
  const { d, log } = deps({ connection: { url: 'wss://rtc.example.com', token: stale } });
  assert.deepEqual(await runConnect(d), { kind: 'connected' });
  assert.deepEqual(log, ['fetch', 'audio', 'connect']);
});

test('an expired token with no way to get a new one is "expired", and nothing is dialled', async () => {
  const { d, log } = deps({ connection: { url: 'wss://rtc.example.com', token: stale }, fetchFresh: async () => null });
  assert.deepEqual(await runConnect(d), { kind: 'expired' });
  assert.deepEqual(log, []);
});

// The bug the review found: leaving (or retrying) while "connecting" must not leave a live,
// orphaned connection behind.
test('disposed while fetching a fresh token: never dials', async () => {
  const { d, log, state } = deps({
    connection: { url: 'wss://rtc.example.com', token: stale },
    fetchFresh: async () => { state.disposed = true; return { url: 'wss://rtc.example.com', token: fresh }; },
  });
  assert.deepEqual(await runConnect(d), { kind: 'aborted' });
  assert.deepEqual(log, []);
});

test('disposed while the audio session starts: never dials', async () => {
  const { d, log, state } = deps({ startAudio: async () => { log.push('audio'); state.disposed = true; } });
  assert.deepEqual(await runConnect(d), { kind: 'aborted' });
  assert.deepEqual(log, ['audio']);
});

test('disposed while the connection is being made: the connection that completes is torn down', async () => {
  const { d, log, state } = deps({ connect: async () => { log.push('connect'); state.disposed = true; } });
  assert.deepEqual(await runConnect(d), { kind: 'aborted' });
  assert.deepEqual(log, ['audio', 'connect', 'disconnect']);
});

test('a failure after being disposed is not reported as a failure', async () => {
  const { d, state } = deps({ connect: async () => { state.disposed = true; throw new Error('closed'); } });
  assert.deepEqual(await runConnect(d), { kind: 'aborted' });
});

test('connect and audio failures are reported with a message', async () => {
  const a = deps({ connect: async () => { throw new Error('ICE failed'); } });
  assert.deepEqual(await runConnect(a.d), { kind: 'failed', message: 'ICE failed' });
  const b = deps({ startAudio: async () => { throw new Error('mic busy'); } });
  assert.deepEqual(await runConnect(b.d), { kind: 'failed', message: 'mic busy' });
  const c = deps({ connect: async () => { throw 'weird'; } });
  assert.equal((await runConnect(c.d) as { message: string }).message, 'Could not connect to the class.');
});
