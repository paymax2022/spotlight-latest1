import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectStageIdentity } from '../stage.ts';

const c = (identity: string, hasCamera: boolean, canPublish: boolean) => ({ identity, hasCamera, canPublish });

test('the stage prefers a remote participant who is allowed to publish (the host)', () => {
  assert.equal(selectStageIdentity([c('learner', true, false), c('host', true, true)], 'me'), 'host');
});

test('a remote camera is shown even if publish rights are unknown, before falling back to yourself', () => {
  assert.equal(selectStageIdentity([c('someone', true, false)], 'me'), 'someone');
});

test('with no remote video, your own camera is shown (a host previewing)', () => {
  assert.equal(selectStageIdentity([c('me', true, true), c('learner', false, false)], 'me'), 'me');
});

test('a muted or absent camera is never selected; nothing to show gives null', () => {
  assert.equal(selectStageIdentity([c('host', false, true)], 'me'), null);
  assert.equal(selectStageIdentity([], 'me'), null);
});

test('a non-publisher can never displace a publisher, whatever the order', () => {
  assert.equal(selectStageIdentity([c('a', true, false), c('b', true, false), c('host', true, true)], 'me'), 'host');
  assert.equal(selectStageIdentity([c('host', true, true), c('a', true, false)], 'me'), 'host');
});
