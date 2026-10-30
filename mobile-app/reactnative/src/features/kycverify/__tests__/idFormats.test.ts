// Pure-logic tests for what we send Dojah. The Go adapter
// (backend/internal/provider/dojah/mappers.go) maps each ID type to one Dojah
// path + query parameter; these tests lock the client side to that same shape so
// a formatted-but-wrong identifier can't reach the provider.
//
// Run with `npm run test:kyc-verify` (node --test, strip-types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ID_FORMATS,
  dojahLookup,
  formatIdNumberForDisplay,
  maskIdNumber,
  normalizeIdNumber,
  validateIdNumber,
} from '../idFormats.ts';

test('BVN and NIN are exactly 11 digits — separators and letters are stripped', () => {
  assert.equal(normalizeIdNumber('BVN', '222 123-456 78'), '22212345678');
  assert.equal(normalizeIdNumber('BVN', '22212345678abc'), '22212345678');
  assert.equal(normalizeIdNumber('NIN', '70-1234-56789'), '70123456789');
  assert.equal(normalizeIdNumber('BVN', '2221234567'), '2221234567');
});

test('an 11-digit BVN/NIN validates; a 10-digit one is rejected with the count', () => {
  assert.equal(validateIdNumber('BVN', '22212345678').ok, true);
  assert.equal(validateIdNumber('NIN', '70123456789').ok, true);

  const short = validateIdNumber('BVN', '2221234567');
  assert.equal(short.ok, false);
  assert.match(short.error ?? '', /11 digits/);
  assert.match(short.error ?? '', /10/);
});

test('an empty value is not ready but not an error', () => {
  const v = validateIdNumber('NIN', '  ');
  assert.equal(v.ok, false);
  assert.equal(v.error, undefined);
  assert.equal(v.normalized, '');
});

test('passport and licence are uppercased alphanumerics', () => {
  assert.equal(normalizeIdNumber('PASSPORT', 'a12-345 678'), 'A12345678');
  assert.equal(normalizeIdNumber('DRIVERS_LICENSE', 'abc 1234-56789'), 'ABC123456789');
  assert.equal(validateIdNumber('PASSPORT', 'A123').ok, false);
  assert.equal(validateIdNumber('PASSPORT', 'A12345678').ok, true);
});

test("voter's card VIN keeps letters and digits only", () => {
  assert.equal(normalizeIdNumber('VOTERS_CARD', '90f5 b123-456789'), '90F5B123456789');
  assert.equal(validateIdNumber('VOTERS_CARD', '90F5B12345').ok, true);
});

test('numeric display is grouped but the submitted value is not', () => {
  assert.equal(formatIdNumberForDisplay('BVN', '22212345678'), '222 123 456 78');
  assert.equal(normalizeIdNumber('BVN', formatIdNumberForDisplay('BVN', '22212345678')), '22212345678');
  assert.equal(formatIdNumberForDisplay('PASSPORT', 'a12345678'), 'A12345678');
});

test('masking keeps the first three and last two characters', () => {
  assert.equal(maskIdNumber('22212345678'), '222••••••78');
  assert.equal(maskIdNumber('A12345678'), 'A12••••78');
  assert.equal(maskIdNumber('123'), '•••');
});

test('each ID type targets the Dojah path and query parameter the adapter uses', () => {
  assert.equal(dojahLookup('BVN', '22212345678').path, '/api/v1/kyc/bvn/full');
  assert.equal(dojahLookup('BVN', '22212345678').param, 'bvn');
  assert.equal(dojahLookup('NIN', '70123456789').path, '/api/v1/kyc/nin');
  assert.equal(dojahLookup('NIN', '70123456789').param, 'nin');
  assert.equal(dojahLookup('PASSPORT', 'A12345678').param, 'passport_number');
  assert.equal(dojahLookup('DRIVERS_LICENSE', 'ABC123456789').param, 'license_number');
  assert.equal(dojahLookup('VOTERS_CARD', '90F5B123456789').param, 'vin');
});

test('the lookup preview masks the identifier', () => {
  const lookup = dojahLookup('BVN', '22212345678');
  assert.equal(lookup.value, '222••••••78');
  assert.ok(lookup.requestLine.startsWith('GET /api/v1/kyc/bvn/full?bvn='));
  assert.ok(lookup.requestLine.endsWith('78'));
  assert.equal(lookup.requestLine.includes('22212345678'), false);
});

test('every format carries a requirement and a syntactically valid example', () => {
  for (const [idType, format] of Object.entries(ID_FORMATS)) {
    assert.ok(format.requirement.length > 20, `${idType} needs requirement copy`);
    const v = validateIdNumber(idType as keyof typeof ID_FORMATS, format.example);
    assert.equal(v.ok, true, `${idType} example should validate`);
  }
});
