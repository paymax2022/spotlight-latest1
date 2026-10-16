import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapJoinResponse } from '../joinResponse.ts';

const session = { id: 's1', state: 'live', room_ref: 'academy-live-s1' };

test('maps the backend envelope {data:{session,token,rtc}}', () => {
  const r = mapJoinResponse({ data: { session, token: 'h.p.s', rtc: { provider: 'livekit', url: 'wss://rtc.example.com' } } });
  assert.deepEqual(r, {
    sessionId: 's1', roomName: 'academy-live-s1', token: 'h.p.s', canPublish: false, moderated: true,
    rtc: { provider: 'livekit', url: 'wss://rtc.example.com' },
  });
});

test('also accepts a body that is already unwrapped', () => {
  const r = mapJoinResponse({ session, token: 'h.p.s' });
  assert.equal(r.sessionId, 's1');
  assert.equal(r.token, 'h.p.s');
  assert.equal(r.rtc, undefined);
});

test('a provider without an rtc block yields no rtc (the screen shows "not available", never fake video)', () => {
  assert.equal(mapJoinResponse({ data: { session, token: 'stub-token-x' } }).rtc, undefined);
  assert.equal(mapJoinResponse({ data: { session, token: 'x', rtc: 'nope' } }).rtc, undefined);
  assert.equal(mapJoinResponse({ data: { session, token: 'x', rtc: { provider: 5, url: 6 } } }).rtc, undefined);
});

test('the room name falls back to the documented academy naming', () => {
  assert.equal(mapJoinResponse({ data: { session: { id: 's9' }, token: 'x' } }).roomName, 'academy-live-s9');
});

test('canPublish is never taken from the response: LiveKit permissions are the authority', () => {
  assert.equal(mapJoinResponse({ data: { session, token: 'x', canPublish: true } }).canPublish, false);
});

test('a response with no usable token or session is an error, not an empty join', () => {
  for (const bad of [null, undefined, 'x', {}, { data: {} }, { data: { session } }, { data: { token: 'x' } }, { data: { session, token: '' } }]) {
    assert.throws(() => mapJoinResponse(bad as never), /join/i, JSON.stringify(bad));
  }
});
