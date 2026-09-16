// Pure-logic unit tests for what the checkout estimate may contain.
// Run: npm run test:food
//
// The defect this pins: checkout added `Math.round(subtotal * 0.05)` as a
// "Service fee". The server prices service fee from the restaurant's own
// service_fee_bp — 0 for all 44 restaurants, and not exposed to the client at
// all — so the estimate was ₦560 above the ₦12,801.40 the server actually
// charged on order d3eb3edd. The customer topped their wallet up to the
// inflated number five seconds before paying, so the invented line drove a real
// funding decision rather than merely displaying wrong.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTotalKobo } from '@/features/food/estimate';

describe('estimateTotalKobo', () => {
  it('reproduces the real order exactly', () => {
    // Order d3eb3edd: subtotal ₦11,200 + delivery ₦1,201.40 + packaging ₦400.
    // The server charged 1,280,140 kobo and the wallet was debited the same.
    assert.equal(
      estimateTotalKobo({ subtotalKobo: 1120000, deliveryKobo: 120140, packagingKobo: 40000 }),
      1280140,
    );
  });

  it('adds NO service fee — the 5% that caused the mismatch', () => {
    // If a percentage ever creeps back in, this is the test that fails.
    const subtotalKobo = 1120000;
    const total = estimateTotalKobo({ subtotalKobo, deliveryKobo: 0, packagingKobo: 0 });
    assert.equal(total, subtotalKobo);
    assert.notEqual(total, subtotalKobo + Math.round(subtotalKobo * 0.05));
  });

  it('is exactly the sum of its three named parts, for any values', () => {
    const cases = [
      { subtotalKobo: 0, deliveryKobo: 0, packagingKobo: 0 },
      { subtotalKobo: 350000, deliveryKobo: 148520, packagingKobo: 20000 },
      { subtotalKobo: 999999, deliveryKobo: 1, packagingKobo: 0 },
    ];
    for (const c of cases) {
      assert.equal(estimateTotalKobo(c), c.subtotalKobo + c.deliveryKobo + c.packagingKobo);
    }
  });

  it('treats an unquoted component as zero, not as a guess', () => {
    // Delivery before an address is picked, packaging before the restaurant
    // loads. Both resolve to 0 here and are rendered as "—" by the caller, which
    // is the honest presentation: unknown, not free.
    assert.equal(estimateTotalKobo({ subtotalKobo: 1120000, deliveryKobo: 0, packagingKobo: 0 }), 1120000);
  });

  it('keeps kobo integral and survives a non-finite input', () => {
    assert.equal(estimateTotalKobo({ subtotalKobo: 100.7, deliveryKobo: 0, packagingKobo: 0 }), 100);
    assert.equal(
      estimateTotalKobo({ subtotalKobo: 1000, deliveryKobo: Number.NaN, packagingKobo: 40000 }),
      41000,
    );
  });
});
