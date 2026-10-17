// The Following feed pages with limit and offset. The client checks them the
// same way the server does, so a bad value fails before a request is sent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFollowingPage, FOLLOWING_LIMIT_MAX } from '@/features/events/social';

test('the default page is limit 20, offset 0 and passes the check', () => {
  assert.deepEqual(checkFollowingPage(20, 0), { limit: 20, offset: 0 });
});

test('the bounds are accepted: limit 1 and 100, a large offset', () => {
  assert.deepEqual(checkFollowingPage(1, 0), { limit: 1, offset: 0 });
  assert.deepEqual(checkFollowingPage(FOLLOWING_LIMIT_MAX, 500), { limit: 100, offset: 500 });
});

test('a limit outside 1..100 or not a whole number throws', () => {
  for (const bad of [0, -1, 101, 1.5, NaN, Infinity]) {
    assert.throws(() => checkFollowingPage(bad, 0), /limit/);
  }
});

test('a negative or fractional offset throws', () => {
  for (const bad of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => checkFollowingPage(20, bad), /offset/);
  }
});
