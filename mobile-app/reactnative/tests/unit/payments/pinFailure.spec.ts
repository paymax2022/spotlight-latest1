// The sheet rendered all five 403 causes as "Incorrect PIN. Please try again."
// — which pushed a locked-out or PIN-less customer to keep guessing, and every
// guess is scored against the lockout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePinFailure } from '@/features/payments/pinFailure';

const err = (code: string, extra: Record<string, unknown> = {}, message = 'server text') => ({
  message,
  response: { data: { code, ...extra } },
});

test('a wrong PIN is retryable and warns before the lock', () => {
  const r = describePinFailure(err('pin_invalid', { attempts_remaining: 2 }));
  assert.equal(r.retryable, true);
  assert.match(r.message, /Incorrect PIN/);
  assert.match(r.message, /2 attempts left/);
});

test('the last attempt is phrased in the singular', () => {
  assert.match(describePinFailure(err('pin_invalid', { attempts_remaining: 1 })).message, /1 attempt left/);
});

test('a wrong PIN with no count still reads correctly', () => {
  const r = describePinFailure(err('pin_invalid'));
  assert.equal(r.retryable, true);
  assert.equal(r.message, 'Incorrect PIN.');
  assert.doesNotMatch(r.message, /undefined|NaN/);
});

test('a locked PIN stops the guessing and offers a way out', () => {
  const r = describePinFailure(err('pin_locked'));
  assert.equal(r.retryable, false);
  assert.match(r.message, /locked for 15 minutes/);
});

test('a PIN that was never set says so instead of calling it wrong', () => {
  const r = describePinFailure(err('pin_not_set'));
  assert.equal(r.retryable, false);
  assert.match(r.message, /not set a transaction PIN/);
});

test('a wallet or tier block keeps the server\'s specific wording', () => {
  for (const code of ['wallet_disabled', 'daily_limit_exceeded']) {
    const r = describePinFailure(err(code, {}, 'This feature requires KYC Tier 1.'));
    assert.equal(r.retryable, false, code);
    assert.equal(r.message, 'This feature requires KYC Tier 1.', code);
  }
});

test('an unrecognised failure does not invite more guesses', () => {
  const r = describePinFailure(err('something_new', {}, 'Weird failure.'));
  assert.equal(r.retryable, false);
  assert.equal(r.message, 'Weird failure.');
});

test('a network failure IS retryable — no attempt was scored', () => {
  const r = describePinFailure(new Error('Network Error'));
  assert.equal(r.retryable, true);
  assert.match(r.message, /could not reach the server/);
});

test('never claims the PIN is wrong for a cause that is not a wrong PIN', () => {
  for (const code of ['pin_locked', 'pin_not_set', 'wallet_disabled', 'daily_limit_exceeded']) {
    assert.doesNotMatch(describePinFailure(err(code)).message, /Incorrect PIN/, code);
  }
});
