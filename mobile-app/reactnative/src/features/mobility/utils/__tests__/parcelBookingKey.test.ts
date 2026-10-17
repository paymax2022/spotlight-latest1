// Pure-logic unit test for the parcel booking Idempotency-Key lifecycle — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelBookingKey.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBookingKey } from '../parcelBookingKey.ts';

const booking = {
  pickup: { lat: 6.5, lng: 3.4, address: 'A' },
  dropoff: { lat: 6.6, lng: 3.35, address: 'B' },
  category: 'documents', size: 'small', speed: 'standard', declaredValueKobo: 0,
  receiverName: 'Ada', receiverPhone: '+2348000000000',
};
let n = 0;
const mint = () => `parcel-${++n}`;

test('a retry of the SAME booking reuses its key (so a lost response cannot book twice)', () => {
  const first = nextBookingKey(null, booking, mint);
  const retry = nextBookingKey(first, { ...booking }, mint);
  assert.equal(retry.key, first.key);
});

test('any change to what is being booked mints a new key', () => {
  const first = nextBookingKey(null, booking, mint);
  for (const changed of [
    { ...booking, receiverPhone: '+2348111111111' },
    { ...booking, receiverName: 'Bola' },
    { ...booking, size: 'large' },
    { ...booking, speed: 'express' },
    { ...booking, category: 'other' },
    { ...booking, declaredValueKobo: 500000 },
    { ...booking, dropoff: { ...booking.dropoff, lat: 6.61 } },
  ]) {
    assert.notEqual(nextBookingKey(first, changed, mint).key, first.key, JSON.stringify(changed));
  }
});

test('the first booking always mints', () => {
  assert.match(nextBookingKey(null, booking, mint).key, /^parcel-\d+$/);
});
