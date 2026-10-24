// The event detail screen draws a map only when the venue has real coordinates.
// venueMapState decides that, so a missing or broken coordinate never reaches
// the map.

import test from 'node:test';
import assert from 'node:assert/strict';
import { venueMapState } from '@/features/events/venue';

test('venueMapState: a finite pair is a pin', () => {
  assert.equal(venueMapState({ venue_lat: 6.4541, venue_lng: 3.3947 }), 'pin');
});

test('venueMapState: zero and negative coordinates are valid', () => {
  assert.equal(venueMapState({ venue_lat: 0, venue_lng: 0 }), 'pin');
  assert.equal(venueMapState({ venue_lat: -33.86, venue_lng: -70.1 }), 'pin');
});

const bad: Array<[string, number | null | undefined]> = [
  ['null', null],
  ['undefined', undefined],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
];

for (const [name, value] of bad) {
  test(`venueMapState: ${name} latitude is none`, () => {
    assert.equal(venueMapState({ venue_lat: value, venue_lng: 3.39 }), 'none');
  });
  test(`venueMapState: ${name} longitude is none`, () => {
    assert.equal(venueMapState({ venue_lat: 6.45, venue_lng: value }), 'none');
  });
}

test('venueMapState: both fields missing is none', () => {
  assert.equal(venueMapState({}), 'none');
});
