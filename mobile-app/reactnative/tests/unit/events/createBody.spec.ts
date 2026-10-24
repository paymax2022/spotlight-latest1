// The POST /events body. Venue coordinates ride along only when a place was
// picked (both numbers set); they are never sent as nulls, and a blank place id
// is left out. createEventBody is pure so it runs without the API client.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBody } from '@/features/events/createBody';

const base = {
  title: 'Show', description: 'd', venue: 'Eko Hotel', category: 'music',
  starts_at: '2027-01-01T18:00:00Z', ends_at: '2027-01-01T22:00:00Z',
};

test('createEventBody: no coordinates leaves the venue fields out', () => {
  const body = createEventBody(base);
  assert.deepEqual(body, { ...base, fee_bps: 500 });
  assert.ok(!('venue_lat' in body) && !('venue_lng' in body) && !('venue_place_id' in body));
});

test('createEventBody: picked coordinates and place id are sent', () => {
  const body = createEventBody({ ...base, fee_bps: 700, venue_lat: 6.43, venue_lng: 3.42, venue_place_id: 'abc' });
  assert.equal(body.venue_lat, 6.43);
  assert.equal(body.venue_lng, 3.42);
  assert.equal(body.venue_place_id, 'abc');
  assert.equal(body.fee_bps, 700);
});

test('createEventBody: zero coordinates are a real place and are sent', () => {
  const body = createEventBody({ ...base, venue_lat: 0, venue_lng: 0 });
  assert.equal(body.venue_lat, 0);
  assert.equal(body.venue_lng, 0);
  assert.ok(!('venue_place_id' in body));
});

test('createEventBody: a half pair or nulls are not sent', () => {
  for (const extra of [{ venue_lat: 6.4 }, { venue_lng: 3.4 }, { venue_lat: null, venue_lng: null, venue_place_id: null }]) {
    const body = createEventBody({ ...base, ...extra });
    assert.ok(!('venue_lat' in body) && !('venue_lng' in body) && !('venue_place_id' in body), JSON.stringify(extra));
  }
});

test('createEventBody: a blank place id is left out', () => {
  const body = createEventBody({ ...base, venue_lat: 1, venue_lng: 2, venue_place_id: '  ' });
  assert.ok(!('venue_place_id' in body));
});
