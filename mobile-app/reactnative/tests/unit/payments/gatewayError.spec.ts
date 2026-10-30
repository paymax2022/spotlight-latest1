// Food checkout on a build whose card rail is switched off showed the buyer, at
// the moment of payment, the Go router's own text:
// "No API route matches POST /api/finance/restaurant/<id>/orders/paystack/initiate".
// That is an internal API path, not a reason a customer can act on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerFacingInitError, RAIL_UNAVAILABLE } from '@/features/payments/gatewayError';

const httpErr = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status } });

test('a 404 from an unmounted rail never leaks the API path', () => {
  const msg = customerFacingInitError(
    httpErr(404, 'No API route matches POST /api/finance/restaurant/4609/orders/paystack/initiate'),
  );
  assert.equal(msg, RAIL_UNAVAILABLE);
  assert.doesNotMatch(msg, /\/api\/|route matches|restaurant/);
});

test('a 503 from the BFF reads the same way', () => {
  assert.equal(
    customerFacingInitError(httpErr(503, 'Paystack checkout is not available for food orders.')),
    RAIL_UNAVAILABLE,
  );
});

test('a leaked route string is caught even without a status code', () => {
  assert.equal(
    customerFacingInitError(new Error('No API route matches POST /api/finance/restaurant/x')),
    RAIL_UNAVAILABLE,
  );
  assert.equal(customerFacingInitError(new Error('POST /api/finance/events/quote')), RAIL_UNAVAILABLE);
});

test('a server-written refusal passes through untouched', () => {
  const kept = 'This feature requires KYC Tier 1. Complete verification to continue.';
  assert.equal(customerFacingInitError(httpErr(403, kept)), kept);
});

test('anything unrecognised still gives the buyer a sentence', () => {
  assert.equal(customerFacingInitError('boom'), 'Could not start payment. Please try again.');
  assert.equal(customerFacingInitError(new Error('   ')), 'Could not start payment. Please try again.');
});
