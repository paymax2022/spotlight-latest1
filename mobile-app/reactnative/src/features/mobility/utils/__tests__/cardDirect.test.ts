// Pure-logic unit test for the Mobility card-direct helpers — run with Node's
// native TS type-stripping:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/cardDirect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParcelCardDirectBody,
  CARD_DIRECT_KEY_RE,
  cardDirectFailureMessage,
  isCardDirectFailure,
  isCardDirectRefunding,
  isCardDirectTerminal,
  normalizeParcelStatus,
  parcelCardDirectResolverRoute,
  parcelCardDirectStatusPath,
} from '../cardDirect.ts';

const input = {
  pickup: { address: 'A', lat: 6.5, lng: 3.4 },
  dropoff: { address: 'B', lat: 6.6, lng: 3.3 },
  category: 'documents',
  size: 'small',
  speed: 'standard',
  declaredValueKobo: 500_000,
  receiverName: 'Ada',
  receiverPhone: '+2348000000000',
  prohibitedAck: true,
};

test('the card-direct body NEVER carries an amount — the server owns the price', () => {
  const body = buildParcelCardDirectBody({ ...input, email: 'a@b.test', callbackUrl: 'https://cb' });
  for (const k of Object.keys(body)) {
    assert.ok(!/amount|total|fare|price/i.test(k) || k === 'declared_value_kobo', `unexpected money field "${k}"`);
  }
  assert.equal('amount_kobo' in body, false);
  assert.equal('payment_method' in body, false);
});

test('body is snake_case and mirrors the wallet booking fields', () => {
  const body = buildParcelCardDirectBody(input);
  assert.deepEqual(Object.keys(body).sort(), [
    'category', 'declared_value_kobo', 'dropoff', 'pickup', 'prohibited_ack',
    'receiver_name', 'receiver_phone', 'size', 'speed',
  ]);
  assert.equal(body.prohibited_ack, true);
  assert.equal(body.declared_value_kobo, 500_000);
});

test('declared value defaults to integer 0 and gateway fields appear only when given', () => {
  const body = buildParcelCardDirectBody({ ...input, declaredValueKobo: undefined });
  assert.equal(body.declared_value_kobo, 0);
  assert.equal('email' in body, false);
  assert.equal('callback_url' in body, false);
  assert.equal(buildParcelCardDirectBody({ ...input, email: 'a@b.test' }).email, 'a@b.test');
});

test('status path url-encodes the reference (it contains a colon)', () => {
  assert.equal(
    parcelCardDirectStatusPath('parcelorder:parcel-1-abc'),
    '/mobility/parcels/paystack/parcelorder%3Aparcel-1-abc/status',
  );
  assert.equal(parcelCardDirectResolverRoute('parcelorder:k'), '/mobility/paystack/parcel/parcelorder%3Ak');
});

test('terminal / failure classification matches the server state machine', () => {
  for (const s of ['confirmed', 'amount_mismatch', 'order_failed', 'refunded']) assert.ok(isCardDirectTerminal(s), s);
  for (const s of ['pending', 'processing', undefined, '']) assert.equal(isCardDirectTerminal(s as string), false, String(s));
  for (const s of ['amount_mismatch', 'order_failed', 'refunded']) assert.ok(isCardDirectFailure(s), s);
  for (const s of ['confirmed', 'pending', 'processing', undefined]) assert.equal(isCardDirectFailure(s), false, String(s));
});

test('only "refunded" claims the money is back; the others say it is being reversed', () => {
  assert.match(cardDirectFailureMessage('refunded', 'parcel delivery')!, /has been refunded/);
  assert.doesNotMatch(cardDirectFailureMessage('order_failed', 'parcel delivery')!, /has been refunded/);
  assert.match(cardDirectFailureMessage('amount_mismatch', 'ride')!, /being reversed/);
  assert.equal(cardDirectFailureMessage('confirmed', 'ride'), undefined);
  assert.equal(cardDirectFailureMessage(undefined, 'ride'), undefined);
});

test('client idempotency keys satisfy the server key pattern', () => {
  // mirrors newIdempotencyKey(prefix): `${prefix}-${Date.now()}-${random8}`
  const key = `parcel-paystack-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  assert.ok(CARD_DIRECT_KEY_RE.test(key), key);
  for (const bad of ['short', 'has space 12345', 'a/b/../c/d/e/f', 'x'.repeat(101), 'colon:inside-1234']) {
    assert.equal(CARD_DIRECT_KEY_RE.test(bad), false, bad);
  }
});

test('normalizeParcelStatus exposes the domain entity id as parcelId', () => {
  const s = normalizeParcelStatus({ reference: 'parcelorder:k', status: 'confirmed', amountKobo: 300_000, parcelId: 'p-1' });
  assert.deepEqual(s, { reference: 'parcelorder:k', status: 'confirmed', amountKobo: 300_000, parcelId: 'p-1' });
});

test('refunding is non-terminal, non-failure, has honest in-flight copy, and never claims money is back', () => {
  assert.equal(isCardDirectTerminal('refunding'), false);
  assert.equal(isCardDirectFailure('refunding'), false);
  assert.equal(isCardDirectRefunding('refunding'), true);
  for (const s of ['pending', 'processing', 'confirmed', 'refunded', 'order_failed', 'amount_mismatch', undefined]) {
    assert.equal(isCardDirectRefunding(s), false, String(s));
  }
  const msg = cardDirectFailureMessage('refunding', 'towing job')!;
  assert.ok(msg && msg.includes('towing job'));
  assert.match(msg, /being processed/);
  assert.doesNotMatch(msg, /has been refunded/);
});

test('every server status either routes to the screen or has copy', () => {
  const all = ['pending', 'processing', 'confirmed', 'amount_mismatch', 'order_failed', 'refunding', 'refunded'];
  for (const s of all) {
    const covered = ['pending', 'processing', 'confirmed'].includes(s) || cardDirectFailureMessage(s, 'ride') !== undefined;
    assert.ok(covered, `status ${s} has no user-facing copy`);
  }
});
