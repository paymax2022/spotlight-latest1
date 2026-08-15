// Pure-logic unit tests for naming a cart section at checkout.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/food/*.spec.ts"
//
// The defect: checkout groups packages by restaurantId but the store keeps only
// ONE restaurantName, so a multi-restaurant cart showed the real name for the
// first group and "Restaurant 2", "Restaurant 3"… for the rest — a positional
// placeholder shown to a customer about to pay.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRestaurantName } from '@/features/food/restaurantName';
import type { CartLine } from '@/features/food/types';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  itemId: 'i1',
  name: 'Egusi Soup',
  priceKobo: 320000,
  qty: 1,
  ...over,
});

describe('resolveRestaurantName', () => {
  it('uses the name captured on the line', () => {
    const out = resolveRestaurantName(
      [line({ restaurantId: 'r2', restaurantName: 'Chicken Republic' })],
      'r2',
      1,
    );
    assert.equal(out, 'Chicken Republic');
  });

  it('names EVERY group of a multi-restaurant cart, not just the first', () => {
    // The reported bug, end to end: three groups, three real names, no
    // "Restaurant 2"/"Restaurant 3" anywhere.
    const groups = [
      { rid: 'r1', lines: [line({ restaurantId: 'r1', restaurantName: 'Mama Cass' })] },
      { rid: 'r2', lines: [line({ restaurantId: 'r2', restaurantName: 'Chicken Republic' })] },
      { rid: 'r3', lines: [line({ restaurantId: 'r3', restaurantName: 'Kilimanjaro' })] },
    ];
    const names = groups.map((g, i) => resolveRestaurantName(g.lines, g.rid, i));
    assert.deepEqual(names, ['Mama Cass', 'Chicken Republic', 'Kilimanjaro']);
    assert.ok(!names.some((n) => /^Restaurant \d+$/.test(n)));
  });

  it('falls back to the id lookup for carts hydrated before the field existed', () => {
    // Lines restored from storage or the server carry no restaurantName.
    const out = resolveRestaurantName(
      [line({ restaurantId: 'r3' })],
      'r3',
      2,
      (id) => ({ r3: 'Kilimanjaro' })[id],
    );
    assert.equal(out, 'Kilimanjaro');
  });

  it('prefers the captured name over the lookup', () => {
    // The line is authoritative: it records what the restaurant was called when
    // the item was added, and survives the restaurant leaving discovery.
    const out = resolveRestaurantName(
      [line({ restaurantId: 'r1', restaurantName: 'Mama Cass' })],
      'r1',
      0,
      () => 'Some Other Name',
    );
    assert.equal(out, 'Mama Cass');
  });

  it('ignores blank names rather than letting them win', () => {
    const out = resolveRestaurantName(
      [line({ restaurantName: '   ' }), line({ itemId: 'i2', restaurantName: 'Mama Cass' })],
      'r1',
      0,
    );
    assert.equal(out, 'Mama Cass');

    // …and a blank must not beat a usable lookup either.
    assert.equal(
      resolveRestaurantName([line({ restaurantName: '' })], 'r9', 3, () => 'Kilimanjaro'),
      'Kilimanjaro',
    );
  });

  it('trims stray whitespace from either source', () => {
    assert.equal(resolveRestaurantName([line({ restaurantName: '  Mama Cass  ' })], 'r1', 0), 'Mama Cass');
    assert.equal(resolveRestaurantName([line()], 'r1', 0, () => '  Kilimanjaro '), 'Kilimanjaro');
  });

  it('falls back to the placeholder only when nothing identifies the group', () => {
    assert.equal(resolveRestaurantName([line()], 'r4', 1), 'Restaurant 2');
    assert.equal(resolveRestaurantName([], 'r4', 0), 'Restaurant 1');
    assert.equal(resolveRestaurantName([line()], 'r4', 2, () => undefined), 'Restaurant 3');
  });
});
