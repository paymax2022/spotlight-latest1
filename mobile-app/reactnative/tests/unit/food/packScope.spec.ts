// Pure-logic unit tests for deciding which cart packs a restaurant page shows.
// Run: npm run test:food
//
// The defect: the page picked packs with `cartRestaurantId === id`. That field
// holds whichever restaurant was added FIRST, so on any other restaurant's page
// the answer was "none" — including for a pack created a moment earlier by the
// Add pack button. The button worked; its result was filtered out of view, and
// each click left another invisible empty pack in the cart.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packsForRestaurant } from '@/features/food/packScope';
import type { CartPackage } from '@/features/food/types';

const pkg = (id: string, restaurantId?: string | null): CartPackage => ({
  id,
  lines: [],
  ...(restaurantId === undefined ? {} : { restaurantId }),
});

const ids = (ps: CartPackage[]) => ps.map((p) => p.id);

describe('packsForRestaurant', () => {
  it('shows a pack added on a restaurant that is not the cart-level one', () => {
    // The regression: cart was opened at r1, user is on r2's page.
    const packs = [pkg('a', 'r1'), pkg('b', 'r2')];
    assert.deepEqual(ids(packsForRestaurant(packs, 'r2', 'r1')), ['b']);
  });

  it('does not leak another restaurant\'s packs onto this page', () => {
    const packs = [pkg('a', 'r1'), pkg('b', 'r2')];
    assert.deepEqual(ids(packsForRestaurant(packs, 'r1', 'r1')), ['a']);
  });

  it('keeps legacy packs visible on the cart-level restaurant', () => {
    // Persisted before packs carried a restaurant: no restaurantId at all.
    const packs = [pkg('a'), pkg('b')];
    assert.deepEqual(ids(packsForRestaurant(packs, 'r1', 'r1')), ['a', 'b']);
  });

  it('hides legacy packs on any other restaurant, as the old rule did', () => {
    const packs = [pkg('a'), pkg('b')];
    assert.deepEqual(ids(packsForRestaurant(packs, 'r2', 'r1')), []);
  });

  it('mixes legacy and attributed packs on the cart-level restaurant', () => {
    const packs = [pkg('legacy'), pkg('own', 'r1'), pkg('other', 'r2')];
    assert.deepEqual(ids(packsForRestaurant(packs, 'r1', 'r1')), ['legacy', 'own']);
  });

  it('treats an explicit null restaurant on a pack as legacy', () => {
    // addPackage stores null rather than undefined when it has no restaurant.
    const packs = [pkg('a', null)];
    assert.deepEqual(ids(packsForRestaurant(packs, 'r1', 'r1')), ['a']);
    assert.deepEqual(ids(packsForRestaurant(packs, 'r2', 'r1')), []);
  });

  it('shows nothing for a missing restaurant id rather than every legacy pack', () => {
    // Guard against `undefined === undefined` matching a cart with no restaurant.
    const packs = [pkg('a'), pkg('b', 'r1')];
    assert.deepEqual(ids(packsForRestaurant(packs, undefined, undefined)), []);
  });
});
