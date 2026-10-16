// Pure-logic tests for the Go success-envelope unwrapper used by crypto.api.ts.
// Run with:
//   node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs \
//        --test "src/features/crypto/utils/__tests__/*.test.ts"
//
// The legacy Go crypto handlers wrap every payload under a NAMED key, not `data`:
//   sell/buy -> { success, order }, portfolio -> { success, portfolio },
//   assets -> { success, assets }, swap -> { success, swap }, etc.
// The old unwrap only handled a `data` key, so in a mockless build every legacy
// live path received { success, <key> } instead of the payload — a money-path
// bug for sell/swap/withdraw/portfolio. These pin the correct behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unwrapEnvelope } from '../envelope.ts';

test('unwraps a single named payload key from a success envelope', () => {
  const order = { id: 'co_1', status: 'Filled' };
  assert.deepEqual(unwrapEnvelope({ success: true, order }), order);
  assert.deepEqual(unwrapEnvelope({ success: true, portfolio: { totalValue: 1 } }), { totalValue: 1 });
});

test('unwraps an array payload (e.g. assets / orders / holdings)', () => {
  const assets = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(unwrapEnvelope({ success: true, assets }), assets);
  assert.deepEqual(unwrapEnvelope({ success: true, orders: [] }), []);
});

test('ignores a message field when choosing the payload key', () => {
  const swap = { id: 'sw_1' };
  assert.deepEqual(unwrapEnvelope({ success: true, message: 'ok', swap }), swap);
});

test('still honours an explicit { success, data } envelope', () => {
  assert.deepEqual(unwrapEnvelope({ success: true, data: { x: 1 } }), { x: 1 });
});

test('honours a bare { data } envelope with no success flag (back-compat)', () => {
  assert.deepEqual(unwrapEnvelope({ data: { y: 2 } }), { y: 2 });
});

test('returns a raw (mock) payload untouched — object or array, no success flag', () => {
  const raw = { id: 'co_1', status: 'Filled' };
  assert.deepEqual(unwrapEnvelope(raw), raw);
  const arr = [{ id: 'a' }];
  assert.deepEqual(unwrapEnvelope(arr), arr);
});

test('does not guess when a success envelope carries more than one payload key', () => {
  // Ambiguous (e.g. a paginated { success, orders, next_cursor }) — return the
  // whole body so the caller decides, rather than unwrapping the wrong key.
  const body = { success: true, orders: [1], next_cursor: 'abc' };
  assert.deepEqual(unwrapEnvelope(body), body);
});

test('returns a success-only body as-is (no payload key to unwrap)', () => {
  assert.deepEqual(unwrapEnvelope({ success: true }), { success: true });
});

test('passes primitives and null through unchanged', () => {
  assert.equal(unwrapEnvelope(null), null);
  assert.equal(unwrapEnvelope('plain'), 'plain');
  assert.equal(unwrapEnvelope(42), 42);
});
