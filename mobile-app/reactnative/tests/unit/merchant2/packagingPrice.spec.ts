// Pure-logic unit tests for the owner's packaging-price input.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/merchant2/*.spec.ts"
//
// The owner types NAIRA; the column, the wire and every calculation are integer
// KOBO. This is the conversion, and it sets a price every future customer pays,
// so it is tested rather than trusted to an inline Number(x) * 100.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePackagingPrice,
  packagingPriceInput,
  MAX_PACKAGING_KOBO,
  buildUpdateStoreBody,
} from '@/features/restaurantmerchant/packagingPrice';

const ok = (s: string) => {
  const r = parsePackagingPrice(s);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(s)} to parse, got: ${r.error}`);
  return r.kobo;
};
const err = (s: string) => {
  const r = parsePackagingPrice(s);
  if (r.ok) throw new Error(`expected ${JSON.stringify(s)} to be rejected, got ${r.kobo}`);
  return r.error;
};

describe('parsePackagingPrice', () => {
  it('converts naira to integer kobo', () => {
    assert.equal(ok('200'), 20000); // the platform default
    assert.equal(ok('350'), 35000);
    assert.equal(ok('0'), 0);
  });

  it('handles kobo decimals without floating-point drift', () => {
    assert.equal(ok('200.10'), 20010);
    assert.equal(ok('200.5'), 20050);
    assert.equal(ok('0.01'), 1);

    // The values that actually expose the trap: in binary floating point
    // 8.29 * 100 is 828.9999999999999, so truncating charges a kobo less per
    // pack, forever. (200.10 does NOT drift — it was the wrong example.)
    assert.equal(ok('8.29'), 829);
    assert.equal(ok('1.13'), 113);
    assert.equal(ok('2.01'), 201);
  });

  it('always yields an integer', () => {
    for (const s of ['200', '200.10', '0.01', '1500.99']) {
      assert.ok(Number.isInteger(ok(s)), `${s} produced a non-integer`);
    }
  });

  it('accepts what an owner actually types', () => {
    assert.equal(ok(' 200 '), 20000);
    assert.equal(ok('1,500'), 150000);
    assert.equal(ok('₦200'), 20000);
  });

  it('treats 0 as a real price, not as unset', () => {
    // An owner who does not charge for packaging must be able to say so.
    assert.equal(ok('0'), 0);
    assert.equal(ok('0.00'), 0);
  });

  it('rejects a negative price', () => {
    // Server-side this would subtract from the escrowed order total.
    assert.match(err('-1'), /negative/i);
    assert.match(err('-200'), /negative/i);
  });

  it('rejects blank rather than assuming free', () => {
    assert.match(err(''), /Enter a price/i);
    assert.match(err('   '), /Enter a price/i);
  });

  it('rejects non-numeric input', () => {
    for (const s of ['abc', '20a', '.', '-', '1.2.3']) {
      assert.match(err(s), /number/i);
    }
  });

  it('rejects sub-kobo precision', () => {
    assert.match(err('200.123'), /2 decimal places/i);
  });

  it('enforces the same ceiling as the server', () => {
    assert.equal(ok(String(MAX_PACKAGING_KOBO / 100)), MAX_PACKAGING_KOBO);
    assert.match(err(String(MAX_PACKAGING_KOBO / 100 + 1)), /limit/i);
    // The classic slip: typing a kobo figure into a naira field.
    assert.match(err('20000'), /limit/i);
  });
});

describe('packagingPriceInput', () => {
  it('seeds the field without trailing-zero noise', () => {
    assert.equal(packagingPriceInput(20000), '200');
    assert.equal(packagingPriceInput(20050), '200.50');
    assert.equal(packagingPriceInput(0), '0');
  });

  it('round-trips through the parser', () => {
    for (const kobo of [0, 1, 20000, 20050, MAX_PACKAGING_KOBO]) {
      assert.equal(ok(packagingPriceInput(kobo)), kobo, `round trip failed for ${kobo}`);
    }
  });
});

describe('buildUpdateStoreBody', () => {
  it('sends a zero packaging price instead of dropping it', () => {
    // The trap this function exists for: with a truthiness check, an owner
    // switching packaging to free taps Save, sees success, and keeps charging.
    const body = buildUpdateStoreBody({ packagingFeeKobo: 0 });
    assert.equal(body.packaging_fee_kobo, 0);
    assert.ok('packaging_fee_kobo' in body);
  });

  it('maps the price to the snake_case key the API expects', () => {
    assert.deepEqual(buildUpdateStoreBody({ packagingFeeKobo: 35000 }), { packaging_fee_kobo: 35000 });
  });

  it('omits fields the owner is not changing', () => {
    // A partial patch must not blank out the rest of the profile.
    assert.deepEqual(buildUpdateStoreBody({ name: 'Blue Yam' }), { name: 'Blue Yam' });
    assert.deepEqual(buildUpdateStoreBody({}), {});
  });

  it('keeps an empty description, which is a real edit', () => {
    assert.deepEqual(buildUpdateStoreBody({ description: '' }), { description: '' });
  });
});
