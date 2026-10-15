// node --experimental-strip-types --test "src/features/food/__tests__/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyInLabel } from '../prepLabel.ts';

test('a known prep time reads as ready in about that many minutes', () => {
  assert.equal(readyInLabel(25), 'Ready in ~25 min');
  assert.equal(readyInLabel(12.4), 'Ready in ~12 min');
});

test('no prep time from the server shows nothing rather than "ready now"', () => {
  assert.equal(readyInLabel(undefined), null);
  assert.equal(readyInLabel(0), null);
  assert.equal(readyInLabel(Number.NaN), null);
});
