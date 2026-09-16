// Pure-logic unit tests for how a delivery quote becomes a displayed fee.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/food/*.spec.ts"
//
// The defect: checkout trusted a quote only when `flat_fallback` was false, and
// otherwise fell back to `restaurant.deliveryFeeKobo` — a field with no database
// column and no DTO behind it, so the fallback was always 0. The server returns
// flat_fallback whenever the restaurant has no coordinates (653 of 697 in the
// dev DB), so the NORMAL path discarded a real ₦500 and rendered ₦0 while
// PlaceOrder charged the server-computed fee.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeliveryFee } from '@/features/food/deliveryFee';

describe('resolveDeliveryFee', () => {
  it('uses a distance-based quote as the exact fee', () => {
    const v = resolveDeliveryFee({ delivery_fee_kobo: 73500, flat_fallback: false });
    assert.deepEqual(v, { feeKobo: 73500, known: true, estimated: false });
  });

  it('KEEPS a flat-fallback quote instead of discarding it', () => {
    // The regression itself. ₦500 is what the Go service returns for a
    // restaurant with no coordinates; it must reach the customer.
    const v = resolveDeliveryFee({ delivery_fee_kobo: 50000, flat_fallback: true });
    assert.equal(v.feeKobo, 50000, 'a flat fallback is still a server price');
    assert.equal(v.known, true);
    assert.equal(v.estimated, true, 'but it is labelled as an estimate');
  });

  it('reports an absent quote as UNKNOWN, not as free delivery', () => {
    for (const q of [undefined, null]) {
      const v = resolveDeliveryFee(q);
      assert.equal(v.known, false, 'callers must render a placeholder, not ₦0');
      assert.equal(v.feeKobo, 0);
    }
  });

  it('treats a malformed fee as unknown rather than trusting it', () => {
    assert.equal(resolveDeliveryFee({ delivery_fee_kobo: NaN, flat_fallback: false }).known, false);
    assert.equal(
      resolveDeliveryFee({ delivery_fee_kobo: 'free' as unknown as number, flat_fallback: false }).known,
      false,
    );
  });

  it('keeps the fee an integer kobo value', () => {
    const v = resolveDeliveryFee({ delivery_fee_kobo: 50000.9, flat_fallback: true });
    assert.ok(Number.isInteger(v.feeKobo));
    assert.equal(v.feeKobo, 50000);
  });

  it('never reports zero as a known fee unless the server actually said zero', () => {
    // A genuine free-delivery promo must still be expressible.
    const v = resolveDeliveryFee({ delivery_fee_kobo: 0, flat_fallback: false });
    assert.equal(v.known, true);
    assert.equal(v.feeKobo, 0);
  });
});
