// Pure-logic tests for how the app reads POST /kyc/tier1's response.
// Run with `npm run test:wallet-idempotency` (same node --test glob).
// What these guard: the server returns 201 for a FAILED identity check too, and
// the app used to navigate on as if it had succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTier1Result } from '../tier1Result.ts';

test('PASSED is the only success', () => {
  const r = toTier1Result({ ok: true, tier: 1, checkStatus: 'PASSED', message: 'Tier 1 verified.' });
  assert.equal(r.reviewState, 'passed');
  assert.equal(r.targetTier, 1);
});

test('FAILED throws with the server message instead of reading as success', () => {
  assert.throws(
    () => toTier1Result({ ok: true, checkStatus: 'FAILED', message: "We couldn't verify that BVN/NIN. Check the number and try again." }),
    /couldn't verify that BVN\/NIN/,
  );
});

test('FAILED without a message still throws a usable message', () => {
  assert.throws(() => toTier1Result({ ok: true, checkStatus: 'failed' }), /couldn't verify/i);
});

test('REVIEW / PENDING / INITIATED are pending, never verified', () => {
  for (const checkStatus of ['REVIEW', 'PENDING', 'INITIATED']) {
    assert.equal(toTier1Result({ ok: true, checkStatus }).reviewState, 'pending', checkStatus);
  }
});

test('a response with no checkStatus (older server) is pending, not verified', () => {
  const r = toTier1Result({ ok: true, tier: 0, message: 'submitted for verification' });
  assert.equal(r.reviewState, 'pending');
  assert.equal(toTier1Result(undefined).reviewState, 'pending');
});
