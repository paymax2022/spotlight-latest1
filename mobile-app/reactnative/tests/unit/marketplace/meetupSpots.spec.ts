// Pure-logic tests for the meetup safe-spots normaliser. The regression it pins:
// the LIVE API returns { kind, lat, lng } with no `category` or `distanceKm`, and the
// sheet used to call `s.distanceKm.toFixed(1)` — so opening "Arrange meetup" crashed
// the app against the real backend (it only ever worked on the mock).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSafeSpots, haversineKm } from '@/features/marketplace/meetupSpots';

// Exactly what Go sends (after the client's snake→camel pass): no category, no distance.
const live = [
  { id: 'ss-lag-01', name: 'Police HQ Forecourt', kind: 'police_station', address: 'Ikeja', state: 'Lagos', lga: 'Ikeja', lat: 6.6018, lng: 3.3515, verified: true },
  { id: 'ss-lag-02', name: 'GTBank Branch', kind: 'bank_branch', address: 'Alausa', state: 'Lagos', lga: 'Ikeja', lat: 6.621, lng: 3.3573, verified: true },
  { id: 'ss-lag-03', name: 'Mall Security Point', kind: 'mall', address: 'Alausa', state: 'Lagos', lga: 'Ikeja', lat: 6.6142, lng: 3.3585, verified: true },
  { id: 'ss-x', name: 'Landmark', kind: 'public_landmark', address: 'Somewhere', state: 'Lagos', lga: 'X', lat: 6.5, lng: 3.3, verified: false },
];

describe('normalizeSafeSpots — live API shape', () => {
  it('does not throw and gives every spot a category and a null distance when location is unknown', () => {
    const spots = normalizeSafeSpots(live);
    assert.equal(spots.length, 4);
    assert.deepEqual(spots.map((s) => s.category), ['police', 'bank', 'mall', 'public']);
    assert.ok(spots.every((s) => s.distanceKm === null));
    assert.deepEqual(spots.map((s) => s.id), live.map((s) => s.id), 'server order kept when no distance');
  });

  it('computes distance from the user and sorts nearest-first', () => {
    const near = { lat: 6.6142, lng: 3.3585 }; // standing at the mall
    const spots = normalizeSafeSpots(live, near);
    assert.equal(spots[0].id, 'ss-lag-03');
    assert.ok(spots[0].distanceKm !== null && spots[0].distanceKm < 0.01);
    const d = spots.map((s) => s.distanceKm as number);
    assert.deepEqual([...d].sort((a, b) => a - b), d);
  });

  it('maps an unknown kind to public', () => {
    assert.equal(normalizeSafeSpots([{ id: 'a', name: 'A', kind: 'something_new' }])[0].category, 'public');
  });
});

describe('normalizeSafeSpots — mock shape and bad input', () => {
  it('passes the mock shape through (category + distanceKm already present)', () => {
    const [s] = normalizeSafeSpots([{ id: 'ss1', name: 'Area F', category: 'police', address: 'Ikeja', distanceKm: 1.2, verified: true }]);
    assert.deepEqual(s, { id: 'ss1', name: 'Area F', category: 'police', address: 'Ikeja', distanceKm: 1.2, verified: true });
  });
  it('is an empty list for a non-array body', () => {
    for (const bad of [null, undefined, {}, { data: [] }, 'x', 7]) assert.deepEqual(normalizeSafeSpots(bad), []);
  });
  it('skips entries without an id or a name, and non-objects', () => {
    assert.equal(normalizeSafeSpots([null, 1, 'x', {}, { id: 'a' }, { name: 'n' }, { id: 'ok', name: 'OK' }]).length, 1);
  });
  it('defaults a missing address to empty and verified to false', () => {
    const [s] = normalizeSafeSpots([{ id: 'a', name: 'A' }]);
    assert.equal(s.address, '');
    assert.equal(s.verified, false);
  });
  it('ignores a non-finite distance and falls back to computing it', () => {
    const [s] = normalizeSafeSpots([{ id: 'a', name: 'A', distanceKm: NaN, lat: 6.5, lng: 3.3 }], { lat: 6.5, lng: 3.3 });
    assert.equal(s.distanceKm, 0);
  });
});

describe('haversineKm', () => {
  it('is ~0 for the same point and ~111 km per degree of latitude', () => {
    assert.equal(haversineKm({ lat: 6, lng: 3 }, { lat: 6, lng: 3 }), 0);
    const d = haversineKm({ lat: 6, lng: 3 }, { lat: 7, lng: 3 });
    assert.ok(Math.abs(d - 111.19) < 0.5, String(d));
  });
});
