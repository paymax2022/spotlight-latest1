// Pure-logic unit test for the wallet parcel fare-drift handling — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelFareDrift.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedFareFor } from '../parcelFareDrift.ts';

test('the expected fare is the FARE the customer saw, never the total with the premium', () => {
  assert.equal(expectedFareFor({ fareKobo: 300000, insuranceKobo: 200000, totalKobo: 500000 }), 300000);
  assert.equal(expectedFareFor(undefined), undefined);
});
