// Pure-logic unit tests for the child-safety spend gate (NDPR / SF-7).
// Run: npm run test:academy
//
// Rule (fail-closed): a MINOR may not purchase or redeem unless guardian consent
// is 'granted'. Non-minors are never blocked. The bug this pins: the gate only
// ran `if (USE_MOCK)` (so the live path was fail-OPEN) and the competition redeem
// had no gate at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSpendBlocked, assertCanSpend } from '../consent.ts';

test('non-minor is never blocked, regardless of consent state', () => {
  for (const gc of ['not_required', 'pending', 'granted'] as const) {
    assert.equal(isSpendBlocked({ isMinor: false, guardianConsent: gc }), false);
  }
});

test('minor WITH granted consent is allowed', () => {
  assert.equal(isSpendBlocked({ isMinor: true, guardianConsent: 'granted' }), false);
  assert.doesNotThrow(() => assertCanSpend({ isMinor: true, guardianConsent: 'granted' }));
});

test('minor WITHOUT granted consent is blocked (pending)', () => {
  assert.equal(isSpendBlocked({ isMinor: true, guardianConsent: 'pending' }), true);
  assert.throws(() => assertCanSpend({ isMinor: true, guardianConsent: 'pending' }), /consent required/i);
});

test('fail-closed: minor + not_required is still blocked (must be granted)', () => {
  assert.equal(isSpendBlocked({ isMinor: true, guardianConsent: 'not_required' }), true);
  assert.throws(() => assertCanSpend({ isMinor: true, guardianConsent: 'not_required' }));
});

test('assertCanSpend returns void (no throw) when allowed', () => {
  assert.equal(assertCanSpend({ isMinor: false, guardianConsent: 'not_required' }), undefined);
});
