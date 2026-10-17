// The organiser index has no screen of its own: it sends an organiser to their
// dashboard and everyone else to the events list. The choice is a pure
// function so it is tested without React or the router.

import test from 'node:test';
import assert from 'node:assert/strict';
import { organiserIndexTarget } from '@/features/events/organiser';

test('organiserIndexTarget: an organiser goes to the dashboard', () => {
  assert.equal(organiserIndexTarget(true), '/events/organiser/dashboard');
});

test('organiserIndexTarget: anyone else goes to the events list', () => {
  assert.equal(organiserIndexTarget(false), '/events');
});
