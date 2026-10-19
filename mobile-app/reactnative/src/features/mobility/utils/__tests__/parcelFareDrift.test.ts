// Pure-logic unit test for the wallet parcel fare-drift handling — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelFareDrift.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedFareFor, fareChangedFrom, fareChangedMessage } from '../parcelFareDrift.ts';

test('the expected fare is the FARE the customer saw, never the total with indicative insurance', () => {
  assert.equal(expectedFareFor({ fareKobo: 300000, insuranceKobo: 200000, totalKobo: 500000 }), 300000);
  assert.equal(expectedFareFor(undefined), undefined);
});

test('a 409 FARE_CHANGED (axios shape) yields the live fare', () => {
  const err = { response: { status: 409, data: { code: 'FARE_CHANGED', error: 'changed', fare_kobo: 660000, expected_fare_kobo: 300000 } } };
  assert.deepEqual(fareChangedFrom(err), { fareKobo: 660000, expectedFareKobo: 300000 });
});

test('other errors are not fare changes', () => {
  assert.equal(fareChangedFrom({ response: { status: 409, data: { code: 'AMOUNT_MISMATCH' } } }), null);
  assert.equal(fareChangedFrom({ response: { status: 402, data: { error: 'insufficient' } } }), null);
  assert.equal(fareChangedFrom(new Error('Network Error')), null);
  assert.equal(fareChangedFrom(undefined), null);
  // A FARE_CHANGED without a usable integer fare is still not trusted as one.
  assert.equal(fareChangedFrom({ response: { status: 409, data: { code: 'FARE_CHANGED', fare_kobo: '660000' } } }), null);
  assert.equal(fareChangedFrom({ response: { status: 409, data: { code: 'FARE_CHANGED', fare_kobo: 6600.5 } } }), null);
});

test('the message names the new price in whole naira and says nothing was charged', () => {
  const m = fareChangedMessage(660000);
  assert.match(m, /₦6,600/);
  assert.match(m, /not charged/i);
});
