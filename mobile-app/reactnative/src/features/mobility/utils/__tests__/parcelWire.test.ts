// Parcel wire-shape normaliser — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelWire.test.ts
// The fixtures under fixtures/parcel-e2e are real response bodies, captured with
// PARCEL_E2E_DUMP from TestLiveDB_ParcelCustomerAndRiderEndToEnd (PR #841).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  courierLeg,
  courierStepFor,
  hasCoords,
  summariseCourierEarnings,
  toCourierActionPhase,
  toCourierHistory,
  toCourierRequests,
  toParcel,
  toParcelList,
} from '../parcelWire.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, 'fixtures', 'parcel-e2e', `${name}.json`), 'utf8'));

// ── Today's flat server shape (real bodies) ─────────────────────────────────

test('book: status → phase, flat addresses → pickup/dropoff places, PINs for the sender', () => {
  const p = toParcel(fixture('02-customer-book'));
  assert.equal(p.id, 'b4c70cf6-caf9-4a9b-a939-86815610722a');
  assert.equal(p.phase, 'created');
  assert.deepEqual(p.pickup, { address: 'A, Lagos', lat: 0, lng: 0 });
  assert.deepEqual(p.dropoff, { address: 'B, Lagos', lat: 0, lng: 0 });
  assert.equal(hasCoords(p.pickup), false);
  assert.equal(p.fareKobo, 233719);
  assert.equal(p.declaredValueKobo, 10000000);
  assert.equal(p.receiverName, 'Chioma Eze');
  assert.equal(p.pickupPin, '6687');
  assert.equal(p.dropoffPin, '7040');
  assert.equal(p.paymentStatus, 'escrowed');
  assert.equal(p.courier, null);
  assert.equal(p.rated, false);
  assert.equal(p.deliveredAt, null);
  assert.equal(p.insuranceOpted, true);
  assert.equal(p.insurancePaidKobo, 200000);
  assert.equal(p.insuranceStatus, 'held');
});

test('accept (rider view): no PINs, courier_assigned, a bare courierId is not a Courier', () => {
  const p = toParcel(fixture('04-rider-accept'));
  assert.equal(p.phase, 'courier_assigned');
  assert.equal(p.pickupPin, null);
  assert.equal(p.dropoffPin, null);
  assert.equal(p.courier, null);
  assert.equal(p.insuranceStatus, 'bound');
  assert.equal(p.receiverName, 'Chioma Eze');
});

test('customer views through the lifecycle map status → phase', () => {
  assert.equal(toParcel(fixture('07-customer-after-accept')).phase, 'courier_assigned');
  assert.equal(toParcel(fixture('11-customer-in-transit')).phase, 'in_transit');
  const done = toParcel(fixture('14-customer-delivered'));
  assert.equal(done.phase, 'delivered');
  assert.equal(done.paymentStatus, 'settled'); // implied: delivery settles the courier
  assert.equal(done.photoUrl, 'https://example.test/pickup.jpg');
  assert.equal(done.proofUrl, 'https://example.test/proof.jpg');
});

test('list: {parcels:[…]} → Parcel[] (bare array still works)', () => {
  const list = toParcelList(fixture('15-customer-list'));
  assert.equal(list.length, 1);
  assert.equal(list[0].phase, 'delivered');
  assert.equal(list[0].dropoff.address, 'B, Lagos');
  assert.equal(list[0].speed, 'standard'); // not on the list row; defaulted
  assert.equal(toParcelList([fixture('02-customer-book')]).length, 1);
  assert.deepEqual(toParcelList({ parcels: null }), []);
  assert.deepEqual(toParcelList(null), []);
});

test('requests: {requests:[…]} → id becomes parcelId, flat addresses nest, no invented net', () => {
  const reqs = toCourierRequests(fixture('03-rider-requests'));
  assert.equal(reqs.length, 1);
  const r = reqs[0];
  assert.equal(r.parcelId, 'b4c70cf6-caf9-4a9b-a939-86815610722a');
  assert.equal(r.pickup.address, 'A, Lagos');
  assert.equal(r.dropoff.address, 'B, Lagos');
  assert.equal(r.distanceM, 16141);
  assert.equal(r.fareKobo, 233719);
  assert.equal(r.estCourierNetKobo, null); // never fare × 0.8 on the client
  assert.equal(r.expiresAt, null);
});

test('rider actions: {ok,status} → the new phase', () => {
  assert.equal(toCourierActionPhase(fixture('09-rider-pickup-pin'), 'courier_assigned'), 'pickup_pin_verified');
  assert.equal(toCourierActionPhase(fixture('10-rider-picked-up'), 'pickup_pin_verified'), 'in_transit');
  assert.equal(toCourierActionPhase(fixture('13-rider-dropoff'), 'in_transit'), 'delivered');
  assert.equal(toCourierActionPhase({ ok: true }, 'in_transit'), 'in_transit');
  assert.equal(toCourierActionPhase(toParcel(fixture('14-customer-delivered')), 'in_transit'), 'delivered');
});

// ── The enriched shape the backend is adding ────────────────────────────────

const enriched = {
  id: 'p1',
  status: 'in_transit',
  pickupAddress: 'A, Lagos',
  dropoffAddress: 'B, Lagos',
  pickupLat: 6.5,
  pickupLng: 3.4,
  dropoffLat: 6.45,
  dropoffLng: 3.39,
  courierId: 'c1',
  courier: { id: 'c1', name: 'Rider A', rating: 4.8, vehicle: 'Bike • LND-1', photoUrl: null, phoneMasked: '+234 ••• 0001' },
  paymentStatus: 'escrowed',
  deliveredAt: null,
  rated: false,
  fareKobo: 1000,
};

test('enriched detail: coordinates, courier object, paymentStatus pass through', () => {
  const p = toParcel(enriched);
  assert.deepEqual(p.pickup, { address: 'A, Lagos', lat: 6.5, lng: 3.4 });
  assert.equal(hasCoords(p.dropoff), true);
  assert.deepEqual(p.courier, { id: 'c1', name: 'Rider A', photoUrl: null, rating: 4.8, vehicle: 'Bike • LND-1', phoneMasked: '+234 ••• 0001' });
  assert.equal(p.paymentStatus, 'escrowed');
});

test('nested pickup/dropoff objects and a delivered+rated parcel', () => {
  const p = toParcel({
    id: 'p2', status: 'delivered', fareKobo: 1,
    pickup: { address: 'X', lat: 1, lng: 2 }, dropoff: { address: 'Y', lat: 3, lng: 4 },
    deliveredAt: '2026-10-18T01:00:00Z', rated: true, paymentStatus: 'settled',
  });
  assert.deepEqual(p.pickup, { address: 'X', lat: 1, lng: 2 });
  assert.equal(p.deliveredAt, '2026-10-18T01:00:00Z');
  assert.equal(p.rated, true);
});

test('an already-normalised Parcel round-trips (mocks and new servers both work)', () => {
  const once = toParcel(enriched);
  assert.deepEqual(toParcel(once), once);
});

test('enriched requests carry the server net and expiry', () => {
  const [r] = toCourierRequests({ requests: [{ id: 'p1', pickupAddress: 'A', dropoffAddress: 'B', fareKobo: 1000, courierNetKobo: 800, expiresAt: '2026-10-18T01:00:45Z' }] });
  assert.equal(r.estCourierNetKobo, 800);
  assert.equal(r.expiresAt, '2026-10-18T01:00:45Z');
});

test('unknown status falls back to created; a cancelled parcel is refunded', () => {
  assert.equal(toParcel({ id: 'x', status: 'teleported' }).phase, 'created');
  assert.equal(toParcel({ id: 'x', status: 'cancelled' }).paymentStatus, 'refunded');
});

// ── Rider step (resumes from the server) ────────────────────────────────────

test('courier step derives from the server phase, so a restart resumes', () => {
  assert.equal(courierStepFor('courier_assigned', false), 'navigate_pickup');
  assert.equal(courierStepFor('courier_assigned', true), 'verify_pickup');
  assert.equal(courierStepFor('pickup_pin_verified', false), 'photo');
  assert.equal(courierStepFor('in_transit', false), 'navigate_dropoff');
  assert.equal(courierStepFor('in_transit', true), 'verify_dropoff');
  assert.equal(courierStepFor('delivered', false), 'done');
  assert.equal(courierStepFor('cancelled', true), 'closed');
  assert.equal(courierLeg('courier_assigned'), 'pickup');
  assert.equal(courierLeg('in_transit'), 'dropoff');
  assert.equal(courierLeg('pickup_pin_verified'), null);
  // Driven from the real bodies:
  assert.equal(courierStepFor(toParcel(fixture('04-rider-accept')).phase, false), 'navigate_pickup');
  assert.equal(courierStepFor(toCourierActionPhase(fixture('09-rider-pickup-pin'), 'created'), false), 'photo');
});

// ── Courier history / earnings ──────────────────────────────────────────────

test('earnings total only server-reported nets; a missing net makes the total unknown', () => {
  const hist = toCourierHistory({
    parcels: [
      { id: 'a', status: 'delivered', fareKobo: 1000, courierNetKobo: 800, dropoffAddress: 'B' },
      { id: 'b', status: 'delivered', fareKobo: 2000, courierNetKobo: 1700, dropoffAddress: 'C' },
      { id: 'c', status: 'in_transit', fareKobo: 5000, dropoffAddress: 'D' },
    ],
  });
  const s = summariseCourierEarnings(hist);
  assert.equal(s.delivered.length, 2);
  assert.equal(s.grossKobo, 3000);
  assert.equal(s.netKobo, 2500);

  const partial = summariseCourierEarnings(toCourierHistory({ deliveries: [{ id: 'a', status: 'delivered', fareKobo: 1000 }] }));
  assert.equal(partial.netKobo, null);
  assert.equal(partial.grossKobo, 1000);
  assert.deepEqual(summariseCourierEarnings([]), { delivered: [], netKobo: 0, grossKobo: 0 });
});
