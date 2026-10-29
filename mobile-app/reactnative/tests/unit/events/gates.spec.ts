// Gate selection: the name is what the server stores as checked_in_gate, so it
// is normalised and clamped; the choice is remembered per event for the session.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGate, gateSlug, normaliseGateName, rememberGateName, rememberedGateName,
  DEFAULT_GATE_NAME, MAX_GATE_NAME_LEN,
} from '@/features/events/gates';

test('makeGate builds a per-event id from the gate name', () => {
  assert.deepEqual(makeGate('ev1', 'Main Entrance'), { id: 'ev1:main-entrance', name: 'Main Entrance' });
  assert.deepEqual(makeGate('ev1', '  VIP  '), { id: 'ev1:vip', name: 'VIP' });
});

test('makeGate falls back to the default gate for a blank name', () => {
  assert.equal(makeGate('ev1', '   ').name, DEFAULT_GATE_NAME);
  assert.equal(makeGate(undefined, 'Side').id, 'unknown:side');
});

test('gate names are clamped to the server limit', () => {
  const long = 'x'.repeat(100);
  assert.equal(normaliseGateName(long).length, MAX_GATE_NAME_LEN);
  assert.equal(gateSlug('!!!'), 'main');
});

test('remembered gate is per event', () => {
  assert.equal(rememberedGateName('evA'), DEFAULT_GATE_NAME);
  rememberGateName('evA', 'VIP');
  rememberGateName('evB', 'North door');
  assert.equal(rememberedGateName('evA'), 'VIP');
  assert.equal(rememberedGateName('evB'), 'North door');
  rememberGateName('evA', '   ');
  assert.equal(rememberedGateName('evA'), 'VIP');
});
