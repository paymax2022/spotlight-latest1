// Pure-logic tests for the KYC spend pre-check that runs before either payment rail.
//   npm run test:payments
//
// This decision is what stops the card rail from charging Paystack for a spend the
// server's fail-closed tier gate will refuse — so the cases below mirror
// backend/internal/finance/tiers EnforceWalletDebitLimit exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpendLimit, type SpendLimit } from '@/features/payments/paymentFlow';

// Tier 1: ₦50,000/day (5,000,000 kobo), ₦20,000 already spent → ₦30,000 left.
const tier1: SpendLimit = {
  tier: 1,
  dailyLimitKobo: 5_000_000,
  dailyUsedKobo: 2_000_000,
  remainingKobo: 3_000_000,
  walletDisabled: false,
};

const tier0: SpendLimit = {
  tier: 0,
  dailyLimitKobo: 0,
  dailyUsedKobo: 0,
  remainingKobo: 0,
  walletDisabled: true,
};

// Tier 3 is unlimited; the server encodes that as remaining = -1.
const tier3: SpendLimit = {
  tier: 3,
  dailyLimitKobo: 0,
  dailyUsedKobo: 900_000_000,
  remainingKobo: -1,
  walletDisabled: false,
};

test('a spend inside the remaining allowance is allowed', () => {
  assert.equal(evaluateSpendLimit(tier1, 1_000_000).allowed, true);
});

test('a spend equal to the remaining allowance is allowed (matches the server boundary)', () => {
  // Server: used + amount > cap → reject. 2,000,000 + 3,000,000 = 5,000,000 is NOT
  // greater than the 5,000,000 cap, so the server accepts it and so must we.
  assert.equal(evaluateSpendLimit(tier1, 3_000_000).allowed, true);
});

test('one kobo past the remaining allowance is declined', () => {
  const d = evaluateSpendLimit(tier1, 3_000_001);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'daily_limit');
});

test('the daily-limit message names both the cap and what is left', () => {
  const d = evaluateSpendLimit(tier1, 4_000_000);
  assert.equal(d.allowed, false);
  if (d.allowed === false) {
    assert.match(d.message, /50,000/); // the ₦50,000 cap
    assert.match(d.message, /30,000/); // the ₦30,000 remaining
  }
});

test('Tier 0 is declined as wallet_disabled, whatever the amount', () => {
  for (const amount of [1, 100_000, 50_000_000]) {
    const d = evaluateSpendLimit(tier0, amount);
    assert.equal(d.allowed, false, `amount ${amount} should be declined`);
    assert.equal(d.allowed === false && d.reason, 'wallet_disabled');
  }
});

test('Tier 0 declines even when a limit row would otherwise look permissive', () => {
  // walletDisabled wins over the numbers — it is checked first, exactly as the
  // server checks ErrWalletDisabled before the daily cap.
  const odd: SpendLimit = { ...tier0, dailyLimitKobo: 9_000_000, remainingKobo: 9_000_000 };
  const d = evaluateSpendLimit(odd, 1_000);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'wallet_disabled');
});

test('an unlimited tier allows any amount', () => {
  assert.equal(evaluateSpendLimit(tier3, 900_000_000).allowed, true);
});

test('an unknown allowance is ALLOWED — the server gate is the authority', () => {
  // Failing closed here would block checkout on a network hiccup while protecting
  // nothing: the escrow still refuses the debit server-side.
  assert.equal(evaluateSpendLimit(null, 5_000_000).allowed, true);
  assert.equal(evaluateSpendLimit(undefined, 5_000_000).allowed, true);
});

test('a fully-spent allowance declines any positive amount', () => {
  const spent: SpendLimit = { ...tier1, dailyUsedKobo: 5_000_000, remainingKobo: 0 };
  const d = evaluateSpendLimit(spent, 1);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'daily_limit');
});

test('a zero-amount purchase is never declined', () => {
  // Not a debit — nothing for the cap to price.
  const spent: SpendLimit = { ...tier1, dailyUsedKobo: 5_000_000, remainingKobo: 0 };
  assert.equal(evaluateSpendLimit(spent, 0).allowed, true);
});
