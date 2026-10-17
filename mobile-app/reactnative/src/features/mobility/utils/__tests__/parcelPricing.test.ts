// Pure-logic unit test for the parcel option-price helpers — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelPricing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parcelOptionFare, parcelInsuranceLine, providerLabel } from '../parcelPricing.ts';

const options = [
  { size: 'small', speed: 'standard', fareKobo: 100000 },
  { size: 'small', speed: 'express', fareKobo: 180000 },
  { size: 'small', speed: 'same_day', fareKobo: 300000 },
  { size: 'large', speed: 'same_day', fareKobo: 600000 },
] as const;

test('the price of a size x speed comes from the server options', () => {
  assert.equal(parcelOptionFare({ options: [...options] }, 'small', 'express'), 180000);
  assert.equal(parcelOptionFare({ options: [...options] }, 'large', 'same_day'), 600000);
});

test('a missing option or an older server without options has no price', () => {
  assert.equal(parcelOptionFare({ options: [...options] }, 'medium', 'express'), undefined);
  assert.equal(parcelOptionFare({}, 'small', 'standard'), undefined);
  assert.equal(parcelOptionFare(undefined, 'small', 'standard'), undefined);
});

test('the insurer line names the cover, underwriter and provider', () => {
  assert.equal(
    parcelInsuranceLine({ productName: 'On Demand Goods In Transit', underwriter: 'Sovereign Trust Insurance Plc', provider: 'mycover' }),
    'On Demand Goods In Transit · Sovereign Trust Insurance Plc via MyCover',
  );
  assert.equal(parcelInsuranceLine({ productName: 'Goods-in-Transit cover', underwriter: '', provider: '' }), 'Goods-in-Transit cover');
  assert.equal(parcelInsuranceLine(undefined), null);
});

test('provider keys display with their brand casing', () => {
  assert.equal(providerLabel('mycover'), 'MyCover');
  assert.equal(providerLabel('octamile'), 'Octamile');
  assert.equal(providerLabel('acme'), 'acme');
});
