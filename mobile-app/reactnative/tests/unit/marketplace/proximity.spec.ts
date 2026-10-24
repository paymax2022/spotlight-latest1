// Pure-logic tests for the marketplace proximity helpers. Two regressions this pins:
// a listing with no recorded location arrives with no distance at all, and formatting
// it as "0.0 km" would tell the buyer the seller is next door; and the radius chips
// must stay in step with the backend's default, or "Near you" means two different
// distances on the two screens.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RADIUS_KM, RADIUS_CHOICES_KM, formatDistanceKm } from '@/features/marketplace/proximity';

describe('formatDistanceKm', () => {
  it('shows nothing when the server measured nothing', () => {
    // The two shapes Go actually produces: field absent (omitempty) and explicit null.
    assert.equal(formatDistanceKm(undefined), null);
    assert.equal(formatDistanceKm(null), null);
  });

  it('refuses to round a broken measurement down to "0.0 km"', () => {
    for (const bad of [NaN, Infinity, -3]) {
      assert.equal(formatDistanceKm(bad), null, `${bad} must not render as a distance`);
    }
  });

  it('uses metres under a kilometre and one decimal above it', () => {
    assert.equal(formatDistanceKm(0.4), '400 m');
    // The floor keeps a same-block pair ("1 m") rather than the dishonest "0 m".
    assert.equal(formatDistanceKm(0.0003), '1 m');
    assert.equal(formatDistanceKm(0), '1 m');
    assert.equal(formatDistanceKm(1), '1.0 km');
    assert.equal(formatDistanceKm(3.6479), '3.6 km');
    assert.equal(formatDistanceKm(701.42), '701.4 km');
  });
});

describe('radius choices', () => {
  it('offers ascending, whole-kilometre chips', () => {
    assert.deepEqual(RADIUS_CHOICES_KM, [5, 10, 25, 50, 100]);
    assert.ok(RADIUS_CHOICES_KM.every((km) => Number.isInteger(km) && km > 0));
  });

  it('defaults to a radius that is one of the chips', () => {
    // Otherwise the first "Near you" load asks for a radius no chip can re-select,
    // and the rail looks broken after the user touches one.
    assert.ok(RADIUS_CHOICES_KM.includes(DEFAULT_RADIUS_KM));
  });
});
