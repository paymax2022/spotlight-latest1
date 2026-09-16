// Pure-logic unit tests for the standing "Recent addresses" chips.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/location/*.spec.ts"
//
// Saved addresses were previously reachable ONLY by focusing an empty address
// field, which surfaced them as a dropdown — invisible unless you knew it was
// there. The chips make that discoverable. The interesting part is not the
// markup but this predicate: it decides whether the same list can appear twice
// at once, or linger after the user has already chosen a place.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowRecentChips, type RecentChipsState } from '@/features/location/recentAddressChips';

const base: RecentChipsState = {
  enabled: true,
  count: 3,
  hasPin: false,
  resolved: false,
  dropdownVisible: false,
};

describe('shouldShowRecentChips', () => {
  it('shows saved addresses without needing the field focused', () => {
    // The whole point of the affordance: no focus, no empty-field trick.
    assert.equal(shouldShowRecentChips(base), true);
  });

  it('stays hidden when there is nothing saved yet', () => {
    assert.equal(shouldShowRecentChips({ ...base, count: 0 }), false);
  });

  it('respects the caller opting out', () => {
    assert.equal(shouldShowRecentChips({ ...base, enabled: false }), false);
  });

  it('disappears once a place is confirmed', () => {
    // Either signal counts: this component's own pin, or a parent that already
    // considers the address resolved (e.g. state restored on mount).
    assert.equal(shouldShowRecentChips({ ...base, hasPin: true }), false);
    assert.equal(shouldShowRecentChips({ ...base, resolved: true }), false);
  });

  it('never renders alongside the dropdown', () => {
    // The dropdown lists these same addresses; two copies on screen reads as a
    // bug, and the user cannot tell which one is authoritative.
    assert.equal(shouldShowRecentChips({ ...base, dropdownVisible: true }), false);
  });

  it('comes back if the user clears a confirmed pin to pick again', () => {
    const afterClearing = { ...base, hasPin: false, resolved: false };
    assert.equal(shouldShowRecentChips(afterClearing), true);
  });
});
