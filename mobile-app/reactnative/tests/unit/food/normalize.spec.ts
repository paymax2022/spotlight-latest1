// Pure-logic unit tests for the Restaurant & Delivery live-payload normalizer.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/food/*.spec.ts"
// (node:test + assert — this app has no vitest; matches the other unit suites.)
//
// The fixtures below are the LITERAL shapes emitted by
// backend/internal/restaurant/model.go (Restaurant, MenuCategory, MenuItem) and
// delivery.go (RestaurantDetail), so these fail if the client and the Go handler
// drift apart again.
//
// They exist because the previous code CAST the Go rows to `Restaurant` instead
// of mapping them. A cast is compile-time only and the interface declares `tags`
// required, so tsc happily believed a field the server never sends — and
// RestaurantCard died on `item.tags.map` the first time the list loaded live.
// Type-level agreement proved nothing here; only running the real payload does.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapRestaurant,
  mapRestaurants,
  mapRestaurantDetail,
  mapMenuItem,
} from '@/features/food/normalize';

/** Verbatim row from ListOpenRestaurants (model.go Restaurant json tags). */
const GO_ROW = {
  id: 'b3f1c2e4-0000-4000-8000-000000000001',
  owner_id: 'owner-1',
  name: 'Mama Cass',
  description: 'Home-style Nigerian cooking',
  address: '14 Adeola Odeku, Victoria Island',
  logo_url: null,
  is_open: true,
  rating: 4.8,
  cuisine: 'local',
  created_at: '2026-08-15T10:00:00Z',
  min_order_kobo: 250000,
  packaging_fee_kobo: 18000,
  prep_time_minutes: 20,
  geo_lat: 6.4281,
  geo_lng: 3.4219,
};

describe('mapRestaurant — fields the screens read without guarding', () => {
  it('always produces the arrays and strings the card dereferences', () => {
    const r = mapRestaurant(GO_ROW);

    // The exact crash: RestaurantCard does item.tags.map, and the search filter
    // does r.tags.some. Both need a real array, never undefined.
    assert.ok(Array.isArray(r.tags), 'tags must be an array');
    assert.deepEqual(r.tags, ['Local']);

    assert.equal(typeof r.etaLabel, 'string');
    assert.equal(typeof r.icon, 'string');
    assert.equal(typeof r.iconColor, 'string');
    assert.equal(typeof r.iconBg, 'string');
    assert.equal(typeof r.rating, 'number'); // StarRow calls .toFixed(1)
  });

  it('survives a payload with every optional field missing', () => {
    // The real regression risk: a row the server trims. Nothing may come back
    // undefined for a required field, or the whole tree unmounts again.
    const r = mapRestaurant({ id: 'x', name: 'Bare' });

    assert.deepEqual(r.tags, []);
    assert.equal(r.etaLabel, '—');
    assert.equal(r.rating, 0);
    assert.equal(r.minOrderKobo, 0);
    assert.equal(r.location, null);
    assert.equal(typeof r.icon, 'string');
    assert.doesNotThrow(() => r.tags.map((t) => t));
    assert.doesNotThrow(() => r.rating.toFixed(1));
  });

  it('maps snake_case money to integer kobo', () => {
    const r = mapRestaurant(GO_ROW);
    assert.equal(r.minOrderKobo, 250000);
    assert.equal(r.packagingFeeKobo, 18000);
    assert.ok(Number.isInteger(r.minOrderKobo));
  });

  it('never lets a float through as kobo', () => {
    const r = mapRestaurant({ ...GO_ROW, min_order_kobo: 2500.7 });
    assert.ok(Number.isInteger(r.minOrderKobo), 'kobo must stay an integer');
    assert.equal(r.minOrderKobo, 2500);
  });

  it('derives the ETA window from prep time, not from an invented constant', () => {
    assert.equal(mapRestaurant({ ...GO_ROW, prep_time_minutes: 20 }).etaLabel, '20–30 min');
    assert.equal(mapRestaurant({ ...GO_ROW, prep_time_minutes: 45 }).etaLabel, '45–55 min');
    assert.equal(mapRestaurant({ ...GO_ROW, prep_time_minutes: 0 }).etaLabel, '—');
  });

  it('honours an explicit closed flag but defaults to open', () => {
    // Discovery serves ListOpenRestaurants; defaulting closed would stamp
    // "Closed" across a working storefront whenever the payload shifts.
    assert.equal(mapRestaurant({ ...GO_ROW, is_open: false }).isOpen, false);
    assert.equal(mapRestaurant({ id: 'x', name: 'n' }).isOpen, true);
  });

  it('gives each cuisine a distinct visual and falls back safely', () => {
    const local = mapRestaurant({ ...GO_ROW, cuisine: 'local' });
    const grills = mapRestaurant({ ...GO_ROW, cuisine: 'grills' });
    assert.notEqual(local.icon, grills.icon);
    assert.match(local.iconBg, /^rgba\(\d+,\d+,\d+,[\d.]+\)$/);

    const unknown = mapRestaurant({ ...GO_ROW, cuisine: 'martian' });
    assert.equal(typeof unknown.icon, 'string');
    assert.ok(unknown.icon.length > 0);
    assert.deepEqual(unknown.tags, [], 'no label invented for an unknown cuisine');
  });

  it('keeps cuisine comparable to the filter chips', () => {
    // The screen filters with `r.cuisine === cuisine` against lowercase keys.
    assert.equal(mapRestaurant({ ...GO_ROW, cuisine: 'Local' }).cuisine, 'local');
    assert.equal(mapRestaurant({ ...GO_ROW, cuisine: ' GRILLS ' }).cuisine, 'grills');
  });
});

describe('mapRestaurants — envelope handling', () => {
  it('peels the {restaurants: [...]} envelope the Go handler sends', () => {
    const out = mapRestaurants({ restaurants: [GO_ROW, { ...GO_ROW, id: 'r2' }] });
    assert.equal(out.length, 2);
    assert.equal(out[0].name, 'Mama Cass');
  });

  it('accepts a bare array, and never returns a non-array', () => {
    assert.equal(mapRestaurants([GO_ROW]).length, 1);
    // Callers do .filter() straight off this; null/garbage must degrade to [].
    assert.deepEqual(mapRestaurants(null), []);
    assert.deepEqual(mapRestaurants({}), []);
    assert.deepEqual(mapRestaurants({ restaurants: null }), []);
  });
});

describe('mapRestaurantDetail — flattening the nested detail body', () => {
  const GO_DETAIL = {
    restaurant: GO_ROW,
    categories: [
      {
        id: 'c1',
        restaurant_id: GO_ROW.id,
        name: 'Soups',
        items: [
          {
            id: 'i1',
            category_id: 'c1',
            name: 'Egusi Soup',
            description: 'Melon seed soup',
            price_kobo: 320000,
            is_available: true,
          },
        ],
      },
    ],
  };

  it('lifts the nested restaurant up and renames categories to menu', () => {
    const d = mapRestaurantDetail(GO_DETAIL);
    assert.equal(d.name, 'Mama Cass'); // was undefined under the old cast
    assert.equal(d.menu.length, 1);
    assert.equal(d.menu[0].name, 'Soups');
    assert.equal(d.menu[0].items[0].priceKobo, 320000);
    assert.equal(d.menu[0].items[0].available, true);
  });

  it('tolerates an already-flat body', () => {
    const d = mapRestaurantDetail({ ...GO_ROW, menu: [] });
    assert.equal(d.name, 'Mama Cass');
    assert.deepEqual(d.menu, []);
  });

  it('always yields a menu array', () => {
    assert.deepEqual(mapRestaurantDetail({ restaurant: GO_ROW }).menu, []);
    assert.deepEqual(mapRestaurantDetail(null).menu, []);
  });
});

describe('mapMenuItem', () => {
  it('reads is_available, and hides an item on a malformed row', () => {
    assert.equal(mapMenuItem({ id: 'i', name: 'n', is_available: true }).available, true);
    // Safe direction: never offer something the kitchen may have switched off.
    assert.equal(mapMenuItem({ id: 'i', name: 'n' }).available, false);
  });

  it('keeps prices as integer kobo', () => {
    assert.equal(mapMenuItem({ price_kobo: 320000 }).priceKobo, 320000);
    assert.equal(mapMenuItem({ price_kobo: 'nonsense' }).priceKobo, 0);
  });
});
