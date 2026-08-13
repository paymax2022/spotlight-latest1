// Pure-logic unit tests for the money-path retry contract.
// Run with Node's native TS type-stripping (`npm run test:wallet-idempotency`):
//   node --experimental-strip-types --test src/features/connect/wallet/__tests__/idempotency.logic.test.ts
//
// What these guard: a retry of a money mutation must reuse the original
// Idempotency-Key, and a request whose outcome is unknown must not be reported
// to the user as "did not happen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyErrorMessage, isDuplicateReplay, isAmbiguousOutcome } from '../errors.ts';
import { generateIdempotencyKey } from '../../../../utils/idempotency.ts';

// Minimal axios-error shapes. axios.isAxiosError checks the isAxiosError flag.
function axiosError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('request failed'), { isAxiosError: true }, fields);
}

test('generateIdempotencyKey produces distinct keys per call', () => {
  const keys = new Set(Array.from({ length: 100 }, generateIdempotencyKey));
  assert.equal(keys.size, 100, 'keys must be unique — collisions would dedup unrelated payments');
});

test('a 409 is recognised as a deduped replay, not a failure', () => {
  const err = axiosError({ response: { status: 409, data: { error: 'already processed' } } });
  assert.equal(isDuplicateReplay(err), true);
  assert.equal(isAmbiguousOutcome(err), false);
  assert.match(moneyErrorMessage(err), /already completed/i);
  assert.doesNotMatch(moneyErrorMessage(err), /try again/i);
});

test('a client timeout is ambiguous and must not claim the money did not move', () => {
  const err = axiosError({ code: 'ECONNABORTED', response: undefined });
  assert.equal(isAmbiguousOutcome(err), true);

  const msg = moneyErrorMessage(err);
  assert.match(msg, /check your wallet history/i);
  // The dangerous wording: asserting failure invites a second debit.
  assert.doesNotMatch(msg, /did not|was not|failed to/i);
});

test('a network drop with no response is ambiguous', () => {
  assert.equal(isAmbiguousOutcome(axiosError({ code: 'ERR_NETWORK' })), true);
});

test('a server rejection is definite and surfaces the server reason verbatim', () => {
  const err = axiosError({
    response: { status: 403, data: { error: 'daily limit exceeded for your tier' } },
  });
  // The api client's interceptor copies the server reason onto error.message.
  err.message = 'daily limit exceeded for your tier';

  assert.equal(isAmbiguousOutcome(err), false);
  assert.equal(isDuplicateReplay(err), false);
  assert.equal(moneyErrorMessage(err), 'daily limit exceeded for your tier');
});

test('a non-axios error falls back to a safe generic message', () => {
  assert.equal(moneyErrorMessage(new Error('')), 'Please try again.');
  assert.equal(moneyErrorMessage('nope'), 'Please try again.');
});
