// Pure-logic unit tests for dropping deleted kitchens out of the cart.
// Run: npm run test:food
//
// The defect: a cart persists locally AND server-side, so it outlives the menu it
// was built from. A deleted restaurant's lines stayed in checkout looking
// ordinary — named, priced, adding to the total — but PlaceOrder reads the
// restaurant row, so the order could never be placed and that kitchen's delivery
// fee could never be quoted. One real cart held food from three kitchens, all
// three of them deleted.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pruneCart, type PrunableCart } from '@/features/food/cartPrune';
import { classifyAvailability, goneRestaurantIds } from '@/features/food/availability';
import type { CartLine, CartPackage } from '@/features/food/types';

const line = (rid: string, name = 'Jollof', rname?: string): CartLine => ({
  itemId: `i-${rid}-${name}`,
  name,
  priceKobo: 350000,
  qty: 1,
  restaurantId: rid,
  restaurantName: rname,
});
const pack = (id: string, lines: CartLine[], restaurantId?: string): CartPackage => ({
  id,
  lines,
  ...(restaurantId === undefined ? {} : { restaurantId }),
});
const cart = (over: Partial<PrunableCart> = {}): PrunableCart => ({
  restaurantId: 'r1',
  restaurantName: 'Gone Kitchen',
  packages: [],
  activePackageId: null,
  ...over,
});

describe('pruneCart', () => {
  it('leaves the cart untouched when nothing is gone', () => {
    const c = cart({ packages: [pack('p1', [line('r1')])] });
    const out = pruneCart(c, []);
    assert.deepEqual(out.packages, c.packages);
    assert.equal(out.removedItemCount, 0);
    assert.deepEqual(out.removedIds, []);
  });

  it('removes the dead kitchen and keeps the live one', () => {
    const c = cart({
      restaurantId: 'r1',
      packages: [pack('p1', [line('r1')], 'r1'), pack('p2', [line('r2')], 'r2')],
    });
    const out = pruneCart(c, ['r1']);
    assert.deepEqual(out.packages.map((p) => p.id), ['p2']);
    assert.equal(out.removedItemCount, 1);
    assert.deepEqual(out.removedIds, ['r1']);
  });

  it('re-points the cart-level restaurant at a survivor', () => {
    // The whole failure this exists to end: that field is first-added-wins, so
    // left alone it keeps aiming the delivery quote and PlaceOrder at a dead row.
    const c = cart({
      restaurantId: 'r1',
      restaurantName: 'Gone Kitchen',
      packages: [pack('p1', [line('r1')], 'r1'), pack('p2', [line('r2', 'Egusi', 'Live Kitchen')], 'r2')],
    });
    const out = pruneCart(c, ['r1']);
    assert.equal(out.restaurantId, 'r2');
    assert.equal(out.restaurantName, 'Live Kitchen');
  });

  it('empties the cart completely when every kitchen is gone', () => {
    const c = cart({
      restaurantId: 'r1',
      packages: [pack('p1', [line('r1')], 'r1'), pack('p2', [line('r2')], 'r2')],
    });
    const out = pruneCart(c, ['r1', 'r2']);
    assert.deepEqual(out.packages, []);
    assert.equal(out.restaurantId, null);
    assert.equal(out.restaurantName, null);
    assert.equal(out.removedItemCount, 2);
  });

  it('drops an empty pack that belongs to the dead kitchen', () => {
    const c = cart({ packages: [pack('p1', [], 'r1'), pack('p2', [line('r2')], 'r2')] });
    const out = pruneCart(c, ['r1']);
    assert.deepEqual(out.packages.map((p) => p.id), ['p2']);
  });

  it('does NOT sweep up a legacy pack that has no restaurant of its own', () => {
    // Predates packs carrying a restaurant, so it is not attributable to anyone
    // and is not evidence of anything.
    const c = cart({ packages: [pack('legacy', []), pack('p1', [line('r1')], 'r1')] });
    const out = pruneCart(c, ['r1']);
    assert.deepEqual(out.packages.map((p) => p.id), ['legacy']);
  });

  it('keeps a pack that still holds a surviving kitchen\'s food', () => {
    // A mixed pack should shrink, not vanish.
    const c = cart({ packages: [pack('p1', [line('r1'), line('r2', 'Rice')])] });
    const out = pruneCart(c, ['r1']);
    assert.deepEqual(out.packages.map((p) => p.id), ['p1']);
    assert.deepEqual(out.packages[0].lines.map((l) => l.restaurantId), ['r2']);
  });

  it('clears the active pack pointer when that pack was removed', () => {
    const c = cart({ packages: [pack('p1', [line('r1')], 'r1')], activePackageId: 'p1' });
    assert.equal(pruneCart(c, ['r1']).activePackageId, null);
  });

  it('keeps the active pack pointer when that pack survives', () => {
    const c = cart({ packages: [pack('p1', [line('r1')], 'r1'), pack('p2', [line('r2')], 'r2')], activePackageId: 'p2' });
    assert.equal(pruneCart(c, ['r1']).activePackageId, 'p2');
  });

  it('counts PORTIONS removed, not lines', () => {
    // A line holding 2 portions is "2 items" everywhere else in this cart
    // (cartItemCount sums qty), so the removal notice must agree with the
    // subtotal the customer just watched drop.
    const c = cart({ packages: [pack('p1', [{ ...line('r1'), qty: 2 }], 'r1')] });
    assert.equal(pruneCart(c, ['r1']).removedItemCount, 2);
  });

  it('reports the removed kitchen by name for the notice', () => {
    const c = cart({ packages: [pack('p1', [line('r1', 'Jollof', 'Tip Divergence Kitchen')], 'r1')] });
    assert.deepEqual(pruneCart(c, ['r1']).removedNames, ['Tip Divergence Kitchen']);
  });

  it('reports nothing removed for an id the cart never held', () => {
    const c = cart({ restaurantId: 'r2', packages: [pack('p1', [line('r2')], 'r2')] });
    const out = pruneCart(c, ['r-nonexistent']);
    assert.deepEqual(out.removedIds, []);
    assert.deepEqual(out.packages.map((p) => p.id), ['p1']);
  });
});

describe('classifyAvailability', () => {
  it('calls a 404 gone', () => {
    assert.equal(classifyAvailability({ isError: true, error: { response: { status: 404 } } }), 'gone');
  });

  it('refuses to call a server error gone', () => {
    // The safety property. Deleting a customer's food because the server hiccuped
    // is worse than leaving a stale line: they have no reason to notice.
    for (const status of [500, 502, 503, 429, 401, 403]) {
      assert.equal(
        classifyAvailability({ isError: true, error: { response: { status } } }),
        'unknown',
        `status ${status}`,
      );
    }
  });

  it('refuses to call a network failure gone', () => {
    assert.equal(classifyAvailability({ isError: true, error: new Error('Network Error') }), 'unknown');
    assert.equal(classifyAvailability({ isError: true, error: undefined }), 'unknown');
  });

  it('treats a still-pending query as unknown, not gone', () => {
    // React Query pauses retries while the tab is hidden, so pending can persist.
    assert.equal(classifyAvailability({}), 'unknown');
    assert.equal(classifyAvailability(undefined), 'unknown');
  });

  it('calls a successful fetch available', () => {
    assert.equal(classifyAvailability({ isSuccess: true }), 'available');
  });
});

describe('goneRestaurantIds', () => {
  it('returns only the provably-deleted ids, positionally', () => {
    const ids = ['a', 'b', 'c'];
    const results = [
      { isSuccess: true },
      { isError: true, error: { response: { status: 404 } } },
      { isError: true, error: { response: { status: 500 } } },
    ];
    assert.deepEqual(goneRestaurantIds(ids, results), ['b']);
  });

  it('returns nothing while every query is still pending', () => {
    assert.deepEqual(goneRestaurantIds(['a', 'b'], [{}, {}]), []);
  });

  it('tolerates a results array shorter than the ids', () => {
    assert.deepEqual(goneRestaurantIds(['a', 'b'], [{ isError: true, error: { response: { status: 404 } } }]), ['a']);
  });
});
