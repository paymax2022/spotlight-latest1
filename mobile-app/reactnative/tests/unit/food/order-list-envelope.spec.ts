// The merchant order queue must not report an error when there are no orders.
//
// GET /api/v1/restaurant/orders answers `{"orders": [...]}`, and for a merchant
// with none it answers `{"orders": null}` with HTTP 200. `unwrap` only peels a
// `data` envelope, so it handed that OBJECT to `.map()` — which threw a
// TypeError on null, rejected the query, and made app/food/restaurant render
// "Couldn't load orders". The screen's empty state was already good; it was
// simply never reached.
//
//   npm run test:food
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOrderList } from '@/features/food/normalize';

test('a merchant with no orders yields an empty list, not a throw', () => {
  // The exact body the live endpoint returns for a merchant with no orders.
  assert.deepEqual(mapOrderList({ orders: null }), []);
  assert.deepEqual(mapOrderList({ orders: [] }), []);
});

test('the orders envelope is peeled', () => {
  const rows = [{ id: 'o1' }, { id: 'o2' }];
  assert.deepEqual(mapOrderList({ orders: rows }), rows);
});

test('a bare array still works, in case the handler is ever flattened', () => {
  const rows = [{ id: 'o1' }];
  assert.deepEqual(mapOrderList(rows), rows);
});

test('junk shapes degrade to empty rather than throwing', () => {
  for (const input of [null, undefined, {}, { orders: 'nope' }, 42, 'x']) {
    assert.deepEqual(mapOrderList(input as unknown), [], `input: ${JSON.stringify(input)}`);
  }
});
