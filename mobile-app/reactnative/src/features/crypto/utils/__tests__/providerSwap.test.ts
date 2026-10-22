// Provider-rail trading helpers: the app shows the SERVER's quote and follows the swap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSwap, secondsLeft, phaseOf, pollDelayMs, swapErrorCode, isSwapPinError, swapErrorMessage,
  normaliseUnits, compareUnits, setSwapPin, takeSwapPin, clearSwapPin, newSwapKey,
  isRefusedBeforeExecution, isUnmountedRoute404, providerNetwork, isAddressPending,
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
  for (const code of ['quote_expired', 'insufficient_funds', 'limit_exceeded', 'step_up_unavailable', 'trading_paused', 'market_disabled']) {
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

test('the swap PIN is handed off once, to the same swap and side, while fresh', () => {
  setSwapPin('4821', 'sw1', 'buy', 1000);
  assert.equal(takeSwapPin('sw1', 'buy', 2000), '4821');
  assert.equal(takeSwapPin('sw1', 'buy', 2000), null, 'consumed once');
  setSwapPin('4821', 'sw1', 'buy', 1000);
  assert.equal(takeSwapPin('sw2', 'buy', 2000), null, 'never confirms a different swap');
  assert.equal(takeSwapPin('sw1', 'buy', 2000), null, 'a mismatched read discards it');
  setSwapPin('4821', 'sw1', 'sell', 1000);
  assert.equal(takeSwapPin('sw1', 'buy', 2000), null, 'never the other side');
  setSwapPin('4821', 'sw1', 'buy', 0);
  assert.equal(takeSwapPin('sw1', 'buy', 61_000), null, 'stale PINs expire');
  setSwapPin('', 'sw1', 'buy');
  assert.equal(takeSwapPin('sw1', 'buy'), null);
  setSwapPin('4821', 'sw1', 'buy');
  clearSwapPin();
  assert.equal(takeSwapPin('sw1', 'buy'), null);
});

test('only pre-execution refusals may say nothing was charged', () => {
  for (const c of ['pin_invalid', 'quote_expired', 'insufficient_funds', 'limit_exceeded', 'rate_limited']) assert.equal(isRefusedBeforeExecution(c), true, c);
  for (const c of ['internal', 'swap_not_confirmable', 'provider_unavailable', null]) assert.equal(isRefusedBeforeExecution(c), false, String(c));
});

test('only the Go API\'s own no-route 404 means the legacy rail', () => {
  assert.equal(isUnmountedRoute404({ response: { status: 404, data: { success: false, error: 'No API route matches GET /api/v1/crypto/swaps/config' } } }), true);
  assert.equal(isUnmountedRoute404({ response: { status: 404, data: '<html>Not Found</html>' } }), false);
  assert.equal(isUnmountedRoute404({ response: { status: 404, data: { error: 'not_found' } } }), false);
  assert.equal(isUnmountedRoute404({ response: { status: 502 } }), false);
});

test('each quote gets its own idempotency key', () => {
  let n = 0;
  const rand = () => `r${++n}`;
  assert.notEqual(newSwapKey(rand), newSwapKey(rand));
  assert.match(newSwapKey(), /^swq-[A-Za-z0-9-]+$/);
});

test('deposit networks are named the way the provider names them', () => {
  assert.equal(providerNetwork('tron'), 'trc20');
  assert.equal(providerNetwork('Ethereum'), 'erc20');
  assert.equal(providerNetwork('bitcoin'), 'btc');
  assert.equal(providerNetwork('polygon'), 'polygon');
  assert.equal(isAddressPending({ swapCode: 'address_pending' }), true);
  assert.equal(isAddressPending({ response: { data: { error: 'provider_unavailable' } } }), false);
});
