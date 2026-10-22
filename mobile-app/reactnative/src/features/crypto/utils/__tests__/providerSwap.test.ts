// Provider-rail trading helpers: the app shows the SERVER's quote and follows the swap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSwap, secondsLeft, phaseOf, pollDelayMs, swapErrorCode, isSwapPinError, swapErrorMessage,
  normaliseUnits, compareUnits, setSwapPin, takeSwapPin, newSwapKey,
} from '../providerSwap.ts';

const view = {
  id: '6f1c', status: 'quoted', side: 'sell', asset: 'USDT', amount: '10',
  ngn_kobo: 1_500_000, fee_kobo: 11_250, fee_bps: 75, total_kobo: 1_488_750,
  quoted_amount: '15000', price: '1500', expires_at: '2026-10-21T10:00:15Z',
};

test('parseSwap maps the server view and keeps money as integer kobo / decimal strings', () => {
  const s = parseSwap(view);
  assert.equal(s.side, 'sell');
  assert.equal(s.amount, '10');
  assert.equal(s.totalKobo, 1_488_750);
  assert.equal(s.quotedAmount, '15000');
});

test('parseSwap refuses malformed money rather than guessing', () => {
  for (const bad of [
    { ...view, ngn_kobo: 1.5 },
    { ...view, total_kobo: '1488750' },
    { ...view, fee_kobo: -1 },
    { ...view, status: 'weird' },
    { ...view, side: 'swap' },
    { ...view, id: '' },
    null,
  ]) {
    assert.throws(() => parseSwap(bad));
  }
});

test('secondsLeft counts down from the server expiry and floors at zero', () => {
  const t = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(secondsLeft('2026-10-21T10:00:15Z', t), 15);
  assert.equal(secondsLeft('2026-10-21T10:00:15Z', t + 20_000), 0);
  assert.equal(secondsLeft(undefined, t), 0);
  assert.equal(secondsLeft('garbage', t), 0);
});

test('phaseOf: only completed is done; needs_review is not a failure', () => {
  assert.equal(phaseOf('completed'), 'done');
  assert.equal(phaseOf('failed'), 'failed');
  assert.equal(phaseOf('expired'), 'expired');
  assert.equal(phaseOf('needs_review'), 'review');
  for (const s of ['quoted', 'confirming', 'processing'] as const) assert.equal(phaseOf(s), 'pending');
});

test('poll back-off grows and caps at 5s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(pollDelayMs), [1000, 2000, 3000, 4000, 5000, 5000]);
});

test('swapErrorCode reads the cryptosvc `error` field', () => {
  assert.equal(swapErrorCode({ response: { data: { success: false, error: 'pin_invalid' } } }), 'pin_invalid');
  assert.equal(swapErrorCode({ swapCode: 'quote_expired' }), 'quote_expired');
  assert.equal(swapErrorCode(new Error('x')), null);
  assert.equal(isSwapPinError('pin_invalid'), true);
  assert.equal(isSwapPinError('quote_expired'), false);
});

test('every refusal message says whether money moved', () => {
  for (const code of ['quote_expired', 'insufficient_funds', 'limit_exceeded', 'step_up_unavailable']) {
    assert.match(swapErrorMessage(code, 'buy'), /nothing was charged/i, code);
  }
  assert.match(swapErrorMessage('boom', 'sell'), /history/i, 'an unknown error sends the user to history, not to retry blindly');
});

test('normaliseUnits accepts plain decimals only', () => {
  assert.equal(normaliseUnits('1,50'), '1.5');
  assert.equal(normaliseUnits('007.250'), '7.25');
  assert.equal(normaliseUnits(' 0.00012 '), '0.00012');
  for (const bad of ['', '0', '0.000', '-1', '1e3', 'abc', '1.2.3', '0.0000000000000000001']) {
    assert.equal(normaliseUnits(bad), null, bad);
  }
});

test('compareUnits is exact where floats are not', () => {
  assert.equal(compareUnits('0.3', '0.30'), 0);
  assert.equal(compareUnits('10', '9.999999999999999999'), 1);
  assert.equal(compareUnits('0.100000000000000001', '0.1'), 1);
  assert.equal(compareUnits('2', '12'), -1);
});

test('the swap PIN is handed off once and never stored empty', () => {
  setSwapPin('4821');
  assert.equal(takeSwapPin(), '4821');
  assert.equal(takeSwapPin(), null);
  setSwapPin('');
  assert.equal(takeSwapPin(), null);
});

test('each quote gets its own idempotency key', () => {
  let n = 0;
  const rand = () => `r${++n}`;
  assert.notEqual(newSwapKey(rand), newSwapKey(rand));
  assert.match(newSwapKey(), /^swq-[A-Za-z0-9-]+$/);
});
