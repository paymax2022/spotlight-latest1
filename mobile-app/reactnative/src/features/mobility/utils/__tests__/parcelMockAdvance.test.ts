// The mock parcel's state machine must hand react-query a NEW object each time
// it moves: an in-place mutation is deep-equal to the (same, mutated) cached
// object, so the tracking screen never re-rendered. Run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/parcelMockAdvance.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceParcelPhase } from '../parcelMockAdvance.ts';
import type { Courier, Parcel } from '../../types/modes.types.ts';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const courier = { id: 'cou_1', name: 'Bashir', photoUrl: null, rating: 4.9, vehicle: 'Bike', phoneMasked: null } as Courier;
const parcel = (ageMs: number, extra: Partial<Parcel> = {}) => ({
  id: 'pcl_1', phase: 'created', courier: null, paymentStatus: 'escrowed', pickupPin: '1234', dropoffPin: '5678',
  proofUrl: null, deliveredAt: null, createdAt: new Date(NOW - ageMs).toISOString(), ...extra,
}) as Parcel;

test('moving returns a new object and leaves the previous snapshot untouched', () => {
  const before = parcel(7_000, { insuranceOpted: true, insuranceStatus: 'held' });
  const after = advanceParcelPhase(before, NOW, courier);
  assert.notEqual(after, before);
  assert.equal(before.phase, 'created');
  assert.equal(before.courier, null);
  assert.equal(before.insuranceStatus, 'held');
  assert.equal(after.phase, 'courier_assigned');
  assert.equal(after.courier, courier);
  assert.equal(after.insuranceStatus, 'bound');
});

test('an uninsured parcel keeps its insurance status on accept', () => {
  assert.equal(advanceParcelPhase(parcel(7_000, { insuranceStatus: 'declined' }), NOW, courier).insuranceStatus, 'declined');
});

test('a parcel walks to delivered after ~40s', () => {
  const p = advanceParcelPhase(parcel(41_000), NOW, courier);
  assert.equal(p.phase, 'delivered');
  assert.equal(p.paymentStatus, 'settled');
  assert.equal(p.pickupPin, null);
  assert.equal(p.deliveredAt, new Date(NOW).toISOString());
});

test('a parcel that has not moved, or has finished, comes back as the same object', () => {
  const fresh = parcel(1_000);
  assert.equal(advanceParcelPhase(fresh, NOW, courier), fresh);
  const done = parcel(90_000, { phase: 'delivered' });
  assert.equal(advanceParcelPhase(done, NOW, courier), done);
});
