// Pure-logic unit tests for the Paystack gateway helpers.
// Run with Node's native TS type-stripping:
//   node --test src/features/payments/__tests__/paystackGateway.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAccessCode, buildPaystackMetadata } from '../paystackGateway.ts';

// ── extractAccessCode ─────────────────────────────────────────────────────────
test('extracts the access code from a standard authorization_url', () => {
  assert.equal(
    extractAccessCode('https://checkout.paystack.com/abc123XYZ'),
    'abc123XYZ',
  );
});

test('ignores a trailing slash', () => {
  assert.equal(
    extractAccessCode('https://checkout.paystack.com/abc123/'),
    'abc123',
  );
});

test('ignores query string and hash', () => {
  assert.equal(
    extractAccessCode('https://checkout.paystack.com/abc123?foo=bar#top'),
    'abc123',
  );
});

test('works without an explicit protocol', () => {
  assert.equal(extractAccessCode('checkout.paystack.com/zzz999'), 'zzz999');
});

test('returns null when the URL has a host but no code', () => {
  assert.equal(extractAccessCode('https://checkout.paystack.com/'), null);
  assert.equal(extractAccessCode('https://checkout.paystack.com'), null);
});

test('returns null for non-Paystack hosts', () => {
  assert.equal(extractAccessCode('https://example.com/abc123'), null);
  assert.equal(extractAccessCode('https://evil.test/checkout.paystack.com'), null);
});

test('returns null for empty or non-string input', () => {
  assert.equal(extractAccessCode(''), null);
  // @ts-expect-error deliberately passing a non-string
  assert.equal(extractAccessCode(undefined), null);
  // @ts-expect-error deliberately passing a non-string
  assert.equal(extractAccessCode(null), null);
});

// ── buildPaystackMetadata ─────────────────────────────────────────────────────
test('always tags the charge for the gateway webhook', () => {
  const meta = buildPaystackMetadata({
    email: 'a@b.com',
    amountKobo: 1000,
    domain: 'wallet_topup',
    onSuccess: () => {},
  });
  assert.equal(meta.purpose, 'paymax_gateway');
  assert.equal(meta.domain, 'wallet_topup');
  assert.equal('custom_fields' in meta, false);
});

test('includes custom_fields only when metadataFields are provided', () => {
  const meta = buildPaystackMetadata({
    email: 'a@b.com',
    amountKobo: 1000,
    domain: 'bills',
    metadataFields: [{ display_name: 'Ref', variable_name: 'ref', value: 'X1' }],
    onSuccess: () => {},
  });
  assert.deepEqual(meta.custom_fields, [
    { display_name: 'Ref', variable_name: 'ref', value: 'X1' },
  ]);
});
