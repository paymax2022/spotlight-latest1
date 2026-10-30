import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPins } from '../mapPins.ts';

test('places pins by real coordinates: north is up, east is right', () => {
  const pins = projectPins([
    { id: 'sw', label: 'SW', lat: 6.40, lng: 3.30 },
    { id: 'ne', label: 'NE', lat: 6.60, lng: 3.50 },
  ]);
  const sw = pins.find((p) => p.id === 'sw')!;
  const ne = pins.find((p) => p.id === 'ne')!;
  assert.ok(ne.x > sw.x, 'east pin is further right');
  assert.ok(ne.y < sw.y, 'north pin is higher on screen');
  for (const p of pins) {
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  }
});

test('drops points with no coordinates instead of inventing a position', () => {
  const pins = projectPins([
    { id: 'a', label: 'A', lat: 6.5, lng: 3.4 },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C', lat: 0, lng: 0 },
  ]);
  assert.deepEqual(pins.map((p) => p.id), ['a']);
});

test('a single point is centred and an empty list yields no pins', () => {
  assert.deepEqual(projectPins([]), []);
  const [only] = projectPins([{ id: 'x', label: 'X', lat: 6.5, lng: 3.4, active: true }]);
  assert.equal(only.x, 0.5);
  assert.equal(only.y, 0.5);
  assert.equal(only.active, true);
});
