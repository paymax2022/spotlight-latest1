// Pure-logic unit tests for naming a cart section at checkout.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/food/*.spec.ts"
//
// The defect: checkout groups packages by restaurantId but the store keeps only
// ONE restaurantName, so a multi-restaurant cart showed the real name for the
// first group and "Restaurant 2", "Restaurant 3"… for the rest — a positional
// placeholder shown to a customer about to pay.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRestaurantName,
  groupPackagesByRestaurant,
  UNKNOWN_RESTAURANT_ID,
} from '@/features/food/restaurantName';
import type { CartLine, CartPackage } from '@/features/food/types';

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

describe('groupPackagesByRestaurant', () => {
  const pkg = (id: string, lines: CartLine[]): CartPackage => ({ id, lines });

  it('groups packages by restaurant, preserving cart order', () => {
    const groups = groupPackagesByRestaurant([
      pkg('p1', [line({ restaurantId: 'r1' })]),
      pkg('p2', [line({ restaurantId: 'r2' })]),
      pkg('p3', [line({ restaurantId: 'r1' })]),
    ]);
    assert.deepEqual(groups.map((g) => g.rid), ['r1', 'r2']);
    assert.equal(groups[0].packages.length, 2, 'both r1 packs land in one group');
  });

  it('skips empty packages so they open no section', () => {
    // The cart lets you add a pack before filling it; an empty one must not
    // render a restaurant heading of its own.
    const groups = groupPackagesByRestaurant([
      pkg('empty', []),
      pkg('p1', [line({ restaurantId: 'r1' })]),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].rid, 'r1');
  });

  it('falls back to the cart restaurant, then to the unknown marker', () => {
    // Legacy lines carry no restaurantId at all.
    assert.equal(groupPackagesByRestaurant([pkg('p', [line()])], 'r9')[0].rid, 'r9');
    assert.equal(groupPackagesByRestaurant([pkg('p', [line()])])[0].rid, UNKNOWN_RESTAURANT_ID);
  });

  it('returns nothing for an empty cart', () => {
    assert.deepEqual(groupPackagesByRestaurant([]), []);
    assert.deepEqual(groupPackagesByRestaurant([pkg('e', [])]), []);
  });
});

describe('the closed-restaurant case that survived the first fix', () => {
  it('names a group once a by-id fetch supplies what discovery could not', () => {
    // Discovery is `WHERE is_open = TRUE`, so a closed restaurant is absent
    // from it (31 of 697 in the dev DB). A hydrated cart line carries no name
    // either, so both earlier sources fail and only the by-id fetch can name it.
    const lines = [line({ restaurantId: 'rClosed' })];
    const discoveryOnly = (id: string) => ({ rOpen: 'Mama Cass' })[id];
    assert.equal(
      resolveRestaurantName(lines, 'rClosed', 1, discoveryOnly),
      'Restaurant 2',
      'reproduces the placeholder that was still showing',
    );

    const withFetched = (id: string) => ({ rOpen: 'Mama Cass', rClosed: 'Closed Kitchen' })[id];
    assert.equal(resolveRestaurantName(lines, 'rClosed', 1, withFetched), 'Closed Kitchen');
  });
});
