// Like and follow buttons update optimistically, then roll back if the call
// fails. These pure helpers carry that logic, so they are tested without React
// or the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLikeToggle, applyFollowToggle, canFollowOrganiser, socialErrorMessage } from '@/features/events/social';

const toggles = [
  ['applyLikeToggle', applyLikeToggle],
  ['applyFollowToggle', applyFollowToggle],
] as const;

for (const [name, toggle] of toggles) {
  test(`${name}: turning on adds one`, () => {
    assert.deepEqual(toggle({ liked: false, count: 0 }, true), { liked: true, count: 1 });
  });

  test(`${name}: turning off removes one`, () => {
    assert.deepEqual(toggle({ liked: true, count: 1 }, false), { liked: false, count: 0 });
  });

  test(`${name}: the count never goes negative`, () => {
    assert.deepEqual(toggle({ liked: false, count: 0 }, false), { liked: false, count: 0 });
    assert.deepEqual(toggle({ liked: true, count: 0 }, false), { liked: false, count: 0 });
  });

  test(`${name}: repeating the same state does not move the count`, () => {
    assert.deepEqual(toggle({ liked: true, count: 5 }, true), { liked: true, count: 5 });
    assert.deepEqual(toggle({ liked: false, count: 5 }, false), { liked: false, count: 5 });
  });

  test(`${name}: never mutates its input and returns a new object`, () => {
    const input = Object.freeze({ liked: false, count: 3 });
    const out = toggle(input, true);
    assert.notEqual(out, input);
    assert.deepEqual(input, { liked: false, count: 3 });
  });

  test(`${name}: applying then reversing with the previous value restores the original`, () => {
    const original = { liked: false, count: 7 };
    const optimistic = toggle(original, true);
    assert.deepEqual(toggle(optimistic, original.liked), original);

    const originalOn = { liked: true, count: 7 };
    const optimisticOff = toggle(originalOn, false);
    assert.deepEqual(toggle(optimisticOff, originalOn.liked), originalOn);
  });
}

test('canFollowOrganiser: hidden on your own profile, shown otherwise', () => {
  assert.equal(canFollowOrganiser('u1', 'u1'), false);
  assert.equal(canFollowOrganiser('U1', 'u1'), false);
  assert.equal(canFollowOrganiser('u1', 'u2'), true);
  // Unknown viewer (not signed in yet): show the button; the server decides.
  assert.equal(canFollowOrganiser('u1', null), true);
  assert.equal(canFollowOrganiser('', 'u2'), false);
});

test('socialErrorMessage: nothing when there is no error, a short message otherwise', () => {
  assert.equal(socialErrorMessage(null, 'like'), null);
  assert.equal(socialErrorMessage(undefined, 'follow'), null);
  assert.equal(socialErrorMessage(new Error('boom'), 'like'), "Couldn't update your like. Please try again.");
  assert.equal(socialErrorMessage(new Error('boom'), 'follow'), "Couldn't update your follow. Please try again.");
});
