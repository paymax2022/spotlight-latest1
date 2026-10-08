// Pure-logic unit test for secureRandom — run with Node's native TS type-stripping:
//   node --experimental-strip-types --test src/lib/__tests__/secureRandom.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secureRandomId, secureRandomInt, secureRandomDigits } from '../secureRandom.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('secureRandomId returns a real UUID (via the runtime crypto.randomUUID)', () => {
  const id = secureRandomId();
  assert.match(id, UUID_RE);
  assert.notEqual(id, secureRandomId());
});

test('secureRandomInt stays within [min, max] and is not constant', () => {
  const values = new Set<number>();
  for (let i = 0; i < 50; i += 1) {
    const v = secureRandomInt(100, 999);
    assert.ok(v >= 100 && v <= 999, `${v} out of range`);
    values.add(v);
  }
  assert.ok(values.size > 1, 'expected some variation across 50 draws');
});

test('secureRandomDigits pads to the requested length', () => {
  for (let i = 0; i < 20; i += 1) {
    const d = secureRandomDigits(5);
    assert.equal(d.length, 5);
    assert.match(d, /^\d{5}$/);
  }
});
