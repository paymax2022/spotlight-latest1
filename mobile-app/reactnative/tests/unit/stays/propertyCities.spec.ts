// The city list is the vocabulary guest search matches against: `stays_property.city`
// is free text and discovery filters it with `city ILIKE '%query%'`, so a second
// spelling of a place ("Lagos State", "Lagos, Nigeria") splits the inventory and
// hides listings from the name guests actually type. These three invariants are
// what keeps one place = one value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPERTY_CITIES } from '@/features/stayshotelier/cities';

test('no duplicate city (SelectField keys its list rows by the name)', () => {
  assert.equal(new Set(PROPERTY_CITIES).size, PROPERTY_CITIES.length);
});

test('kept alphabetical, so a 40+ option picker stays scannable', () => {
  const sorted = [...PROPERTY_CITIES].sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(PROPERTY_CITIES, sorted);
});

test('one place name per option — no state suffix, no district comma', () => {
  for (const city of PROPERTY_CITIES) {
    assert.doesNotMatch(city, /,/, `${city} mixes a district into the city facet`);
    assert.doesNotMatch(city, /\bstate\b/i, `${city} spells the place two ways`);
    assert.equal(city, city.trim());
  }
});

test('the markets a host is most likely to list in are present', () => {
  for (const city of ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano']) {
    assert.ok(PROPERTY_CITIES.includes(city), `${city} missing`);
  }
});
