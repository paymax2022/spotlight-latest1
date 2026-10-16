import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportBody, liveMessageEntityId } from '../report.ts';

test('the report body uses the field names the Go handler binds', () => {
  assert.deepEqual(buildReportBody('discussion', 'd1', 'unsafe'), { entity_type: 'discussion', entity_id: 'd1', reason: 'unsafe' });
  assert.deepEqual(buildReportBody('profile', 'u1', 'harassment'), { entity_type: 'profile', entity_id: 'u1', reason: 'harassment' });
});

test('a live chat message is identified by session, sender and message id', () => {
  assert.equal(liveMessageEntityId('s1', 'user-9', 'm42'), 's1/user-9/m42');
  assert.deepEqual(buildReportBody('message', liveMessageEntityId('s1', 'user-9', 'm42'), 'unsafe'),
    { entity_type: 'message', entity_id: 's1/user-9/m42', reason: 'unsafe' });
});

test('empty parts are refused rather than producing a report nobody can act on', () => {
  assert.throws(() => liveMessageEntityId('', 'u', 'm'), /report/i);
  assert.throws(() => liveMessageEntityId('s', '', 'm'), /report/i);
  assert.throws(() => liveMessageEntityId('s', 'u', ''), /report/i);
  assert.throws(() => buildReportBody('message', '', 'unsafe'), /report/i);
});
