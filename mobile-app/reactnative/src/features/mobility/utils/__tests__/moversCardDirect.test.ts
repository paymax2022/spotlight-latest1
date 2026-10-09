// Pure-logic unit test for the MOVERS card-direct helpers — run with:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/moversCardDirect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMoversCardDirectBody,
  moversCardDirectResolverRoute,
  moversCardDirectStatusPath,
  moversConfirmedRoute,
  MOVERS_CARD_DIRECT_BASE,
  normalizeMoversStatus,
} from '../moversCardDirect.ts';
import { CARD_DIRECT_KEY_RE, cardDirectFailureMessage } from '../cardDirect.ts';

test('the card-direct body NEVER carries an amount — the server reads the accepted bid', () => {
  const body = buildMoversCardDirectBody({ jobId: 'job-1', bidId: 'bid-1', email: 'a@b.test', callbackUrl: 'https://cb' });
  for (const k of Object.keys(body)) {
    assert.ok(!/amount|total|fare|price|kobo/i.test(k), `unexpected money field "${k}"`);
  }
  assert.equal('payment_method' in body, false);
});

test('body is snake_case: job_id + bid_id only, gateway fields only when given', () => {
  assert.deepEqual(buildMoversCardDirectBody({ jobId: 'j', bidId: 'b' }), { job_id: 'j', bid_id: 'b' });
  const body = buildMoversCardDirectBody({ jobId: 'j', bidId: 'b', email: 'a@b.test', callbackUrl: 'https://cb' });
  assert.deepEqual(Object.keys(body).sort(), ['bid_id', 'callback_url', 'email', 'job_id']);
});

test('a body cannot be built without a job and a bid', () => {
  assert.throws(() => buildMoversCardDirectBody({ jobId: '', bidId: 'b' }));
  assert.throws(() => buildMoversCardDirectBody({ jobId: 'j', bidId: '' }));
});

test('status path url-encodes the reference (it contains a colon) under the movers base', () => {
  assert.equal(MOVERS_CARD_DIRECT_BASE, '/mobility/movers/paystack');
  assert.equal(
    moversCardDirectStatusPath('moversorder:mov-paystack-1-abc'),
    '/mobility/movers/paystack/moversorder%3Amov-paystack-1-abc/status',
  );
});

test('resolver route encodes the reference and matches the app/ route file', () => {
  assert.equal(
    moversCardDirectResolverRoute('moversorder:mov-paystack-1-abc'),
    '/mobility/paystack/movers/moversorder%3Amov-paystack-1-abc',
  );
});

test('confirmed route is the normal move screen', () => {
  assert.equal(moversConfirmedRoute('job-9'), '/mobility/movers/job-9');
});

test('status normalisation maps the server "moveId" entity key', () => {
  assert.deepEqual(
    normalizeMoversStatus({ reference: 'r', status: 'confirmed', amountKobo: 4_500_000, moveId: 'job-9' }),
    { reference: 'r', status: 'confirmed', amountKobo: 4_500_000, moveId: 'job-9' },
  );
  assert.equal(normalizeMoversStatus({ reference: 'r', status: 'pending' }).moveId, undefined);
});

test('idempotency keys the screen generates satisfy the server key shape', () => {
  assert.ok(CARD_DIRECT_KEY_RE.test('mov-paystack-1700000000000-abcd1234'));
  assert.ok(CARD_DIRECT_KEY_RE.test(`${'mov-paystack-'}${'x'.repeat(40)}`));
});

test('failure copy for a bid that could not be accepted never claims a booking', () => {
  const m = cardDirectFailureMessage('refunded', 'move booking');
  assert.ok(m && /refunded/.test(m) && /move booking/.test(m));
  assert.ok(cardDirectFailureMessage('order_failed', 'move booking'));
});
