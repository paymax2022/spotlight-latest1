import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDisconnect } from '../disconnect.ts';

test('leaving yourself is not an error', () => {
  const r = classifyDisconnect('CLIENT_INITIATED');
  assert.equal(r.kind, 'left');
  assert.equal(r.canRetry, false);
});

test('the class ending is final, and says so', () => {
  for (const reason of ['ROOM_DELETED', 'ROOM_CLOSED']) {
    const r = classifyDisconnect(reason);
    assert.equal(r.kind, 'class_ended');
    assert.equal(r.canRetry, false);
    assert.match(r.message, /ended/i);
  }
});

test('being removed by the host is final and is not retried', () => {
  const r = classifyDisconnect('PARTICIPANT_REMOVED');
  assert.equal(r.kind, 'removed');
  assert.equal(r.canRetry, false);
});

test('joining from another device explains itself and does not fight for the seat', () => {
  const r = classifyDisconnect('DUPLICATE_IDENTITY');
  assert.equal(r.kind, 'signed_in_elsewhere');
  assert.equal(r.canRetry, false);
});

test('network-ish reasons can be retried (the caller fetches a fresh token)', () => {
  for (const reason of ['SERVER_SHUTDOWN', 'STATE_MISMATCH', 'JOIN_FAILURE', 'MIGRATION', 'SIGNAL_CLOSE', 'CONNECTION_TIMEOUT', 'MEDIA_FAILURE']) {
    const r = classifyDisconnect(reason);
    assert.equal(r.kind, 'network', reason);
    assert.equal(r.canRetry, true, reason);
  }
});

test('anything unknown or missing is a retryable unknown, never a crash', () => {
  for (const reason of [undefined, 'UNKNOWN_REASON', 'SOMETHING_NEW', '']) {
    const r = classifyDisconnect(reason);
    assert.equal(r.kind, 'unknown');
    assert.equal(r.canRetry, true);
    assert.ok(r.message.length > 0);
  }
});
