// Pure-logic unit tests for pricing mandatory takeaway packaging at checkout.
// Run: npm run test:food
//
// The defect: checkout read `restaurant?.packagingFeeKobo ?? 0`, so while the
// restaurant was loading — or had failed to load — the summary showed
// "Takeaway packaging (3 packs)  ₦0.00" and the estimated total was short by
// the real amount. PlaceOrder charges packaging_fee_kobo per pack off the
// restaurant row regardless; every restaurant in the dev database charges ₦200
// a pack, so it was never actually free.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePackagingFee } from '@/features/food/packagingFee';
import type { CartLine, CartPackage } from '@/features/food/types';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  itemId: 'i1',
  name: 'Egusi',
  priceKobo: 400000,
  qty: 1,
  ...over,
});
const filled = (id: string): CartPackage => ({ id, lines: [line()] });
const empty = (id: string): CartPackage => ({ id, lines: [] });

describe('resolvePackagingFee', () => {
  it('prices one pack fee per non-empty pack', () => {
    const out = resolvePackagingFee([filled('a'), filled('b'), filled('c')], 20000);
    assert.deepEqual(out, { feeKobo: 60000, known: true, packCount: 3 });
  });

  it('does not charge for an empty pack', () => {
    const out = resolvePackagingFee([filled('a'), empty('b')], 20000);
    assert.equal(out.packCount, 1);
    assert.equal(out.feeKobo, 20000);
  });

  it('reports UNKNOWN rather than free when the restaurant has not loaded', () => {
    // The regression. undefined must not collapse to ₦0 — the server still charges.
    for (const missing of [undefined, null]) {
      const out = resolvePackagingFee([filled('a'), filled('b')], missing);
      assert.equal(out.known, false, `known for ${String(missing)}`);
      assert.equal(out.feeKobo, 0, 'contributes nothing to the estimate');
      assert.equal(out.packCount, 2, 'still knows how many packs are being charged');
    }
  });

  it('distinguishes a restaurant that charges nothing from one that has not loaded', () => {
    const free = resolvePackagingFee([filled('a')], 0);
    assert.deepEqual(free, { feeKobo: 0, known: true, packCount: 1 });
    assert.equal(resolvePackagingFee([filled('a')], undefined).known, false);
  });

  it('treats a non-finite fee as unknown', () => {
    assert.equal(resolvePackagingFee([filled('a')], Number.NaN).known, false);
    assert.equal(resolvePackagingFee([filled('a')], Number.POSITIVE_INFINITY).known, false);
  });

  it('keeps kobo integral', () => {
    const out = resolvePackagingFee([filled('a'), filled('b')], 20000.7);
    assert.equal(Number.isInteger(out.feeKobo), true);
    assert.equal(out.feeKobo, 40000);
  });

  it('charges nothing for an empty cart', () => {
    assert.deepEqual(resolvePackagingFee([], 20000), { feeKobo: 0, known: true, packCount: 0 });
  });
});
