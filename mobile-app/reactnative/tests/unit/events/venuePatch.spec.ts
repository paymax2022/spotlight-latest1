// Picking an address on the event form fills the venue name and its map
// coordinates together. venuePatchFromSelection is the pure mapping; a cleared
// selection must wipe all four fields so a stale pin never survives an edit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { venuePatchFromSelection } from '@/features/events/venuePatch';

test('venuePatchFromSelection: a full selection maps all four fields', () => {
  assert.deepEqual(
    venuePatchFromSelection({ label: 'Landmark Centre, Victoria Island, Lagos', lat: 6.4281, lng: 3.4219, placeId: '6FR9+3Q' }),
    { venue: 'Landmark Centre, Victoria Island, Lagos', venue_lat: 6.4281, venue_lng: 3.4219, venue_place_id: '6FR9+3Q' },
  );
});

test('venuePatchFromSelection: a missing placeId becomes null', () => {
  const noId = venuePatchFromSelection({ label: 'Eko Hotel', lat: 6.43, lng: 3.43 });
  assert.equal(noId.venue_place_id, null);
  const nullId = venuePatchFromSelection({ label: 'Eko Hotel', lat: 6.43, lng: 3.43, placeId: null });
  assert.equal(nullId.venue_place_id, null);
});

test('venuePatchFromSelection: zero and negative coordinates are kept', () => {
  const p = venuePatchFromSelection({ label: 'Null Island', lat: 0, lng: -3.4 });
  assert.equal(p.venue_lat, 0);
  assert.equal(p.venue_lng, -3.4);
});

test('venuePatchFromSelection: a null selection clears all four fields', () => {
  assert.deepEqual(venuePatchFromSelection(null), {
    venue: '', venue_lat: null, venue_lng: null, venue_place_id: null,
  });
});
