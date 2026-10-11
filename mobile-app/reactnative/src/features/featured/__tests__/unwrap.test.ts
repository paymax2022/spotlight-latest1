import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapList } from '../unwrap.ts';

// The Go placement list endpoints serialise a nil slice as {"data":null} when the
// merchant has no rows. The old `res.data?.data ?? res.data` unwrap then handed the
// screen the envelope object itself, and `data.map` crashed the promotions screen.
test('null data envelope (Go nil slice) becomes an empty array', () => {
  assert.deepEqual(unwrapList({ data: { data: null } }), []);
});

test('missing body becomes an empty array', () => {
  assert.deepEqual(unwrapList({ data: undefined as never }), []);
});

test('enveloped array is returned as-is', () => {
  assert.deepEqual(unwrapList({ data: { data: [{ id: 'a' }] } }), [{ id: 'a' }]);
});

test('bare array body is returned as-is', () => {
  assert.deepEqual(unwrapList({ data: [{ id: 'b' }] }), [{ id: 'b' }]);
});

test('a non-array payload never leaks through', () => {
  assert.deepEqual(unwrapList({ data: { data: { items: [] } } }), []);
});
