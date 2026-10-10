// node --experimental-strip-types --test "src/features/referral/home/__tests__/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeCounts } from '../counts.ts';

test('a referral who just joined shows as invited before any nightly recalc', () => {
  // The live count says 1 joined; the tier input has not been recalculated yet.
  const c = homeCounts({ invited_count: 1, activated_count: 0, active_referral_count: 0 });
  assert.deepEqual(c, { invitesSent: 1, signups: 1, activated: 0 });
});

test('activated follows the live count, not the stale tier count', () => {
  const c = homeCounts({ invited_count: 3, activated_count: 2, active_referral_count: 0 });
  assert.equal(c.activated, 2);
});

test('an older backend without the live fields falls back and never invents invites', () => {
  const c = homeCounts({ active_referral_count: 4 });
  assert.deepEqual(c, { invitesSent: null, signups: null, activated: 4 });
});

test('junk values are ignored rather than shown', () => {
  const c = homeCounts({ invited_count: -1, activated_count: Number.NaN, active_referral_count: 2 });
  assert.deepEqual(c, { invitesSent: null, signups: null, activated: 2 });
});

test('nothing at all is zero activated, not undefined', () => {
  assert.equal(homeCounts({}).activated, 0);
});
