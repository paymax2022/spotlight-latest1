// The courier earnings screen against the REAL backend shape — GET
// /api/v1/driver/parcels (transport.CourierParcels) returns
//   { parcels: [{ id, status, pickup, dropoff, fareKobo, earnedKobo, deliveredAt, … }],
//     totals: { delivered, earnedKobo } }
// where earnedKobo is the settled provider leg actually paid to the courier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCourierHistory, summariseCourierEarnings } from '../parcelWire.ts';

const backendBody = {
  parcels: [
    { id: 'p1', status: 'delivered', dropoff: { address: 'B, Lagos', lat: 6.6, lng: 3.35 }, fareKobo: 300000, earnedKobo: 240000, deliveredAt: '2026-10-20T10:00:00Z' },
    { id: 'p2', status: 'in_transit', dropoff: { address: 'C, Lagos', lat: 6.5, lng: 3.3 }, fareKobo: 200000, earnedKobo: 0, deliveredAt: null },
  ],
  totals: { delivered: 1, earnedKobo: 240000 },
};

test('maps the backend earnedKobo (the settled payout) to the rider net', () => {
  const h = toCourierHistory(backendBody);
  assert.equal(h.length, 2);
  assert.equal(h[0].parcelId, 'p1');
  assert.equal(h[0].phase, 'delivered');
  assert.equal(h[0].netKobo, 240000);
});

test('earnings summary uses the server-reported nets for delivered jobs', () => {
  const s = summariseCourierEarnings(toCourierHistory(backendBody));
  assert.equal(s.delivered.length, 1);
  assert.equal(s.netKobo, 240000);
  assert.equal(s.grossKobo, 300000);
});
