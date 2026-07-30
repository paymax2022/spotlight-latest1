// Pure-logic unit tests for the crypto quote/fee engine (money-path).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs \
//        --test "src/features/crypto/utils/__tests__/*.test.ts"
//
// BUG 1 (fiat-basis BUY overcharge): the entered fiat amount is the GROSS the
// user pays. Fees must be carved OUT of it, not added ON TOP — so the total to
// pay equals exactly what the user typed. These tests pin that invariant plus
// the sell / crypto-basis / swap behaviours that must stay correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildQuote, buildSwapQuote } from '../cryptoFormatters.ts';
import {
  PAYMAX_FEE_BPS,
  PROVIDER_FEE_BPS,
  SPREAD_BPS_BY_RISK,
  SWAP_SPREAD_BPS,
  SWAP_FEE_BPS,
} from '../../constants/crypto.constants.ts';
import type { CryptoAsset, QuoteRequest } from '../../types/crypto.types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────
// ₦1,000,000.00 per coin, 8-dp asset, low risk (50 bps spread).
const PRICE = 100_000_000; // kobo per whole coin
const DECIMALS = 8;

function makeAsset(over: Partial<CryptoAsset> = {}): CryptoAsset {
  return {
    id: 'cr_test',
    symbol: 'TST',
    decimals: DECIMALS,
    riskRating: 'low',
    price: { amount: PRICE, currency: 'NGN' },
    ...over,
  } as CryptoAsset;
}

function fee(q: ReturnType<typeof buildQuote>, type: string): number {
  return q.fees.find((f) => f.type === type)?.amount.amount ?? 0;
}

const ENTERED = 2_000_000; // ₦20,000.00 gross

// ── BUY · fiat basis — the reported bug ────────────────────────────────────────

test('BUG1: buy/fiat — total to pay equals the entered amount (fees carved out, not added on top)', () => {
  const req: QuoteRequest = { assetId: 'cr_test', side: 'buy', basis: 'fiat', amount: ENTERED, currency: 'NGN' };
  const q = buildQuote(makeAsset(), req);
  assert.equal(q.totalFiat.amount, ENTERED, 'total debit must equal the gross the user entered');
});

test('BUG1: buy/fiat — trade value + percentage fees reconcile to the entered gross', () => {
  const q = buildQuote(makeAsset(), { assetId: 'cr_test', side: 'buy', basis: 'fiat', amount: ENTERED, currency: 'NGN' });
  const feeSum = fee(q, 'paymax_fee') + fee(q, 'provider_fee');
  assert.ok(q.fiat.amount < ENTERED, 'reported trade value must be below the gross (fees live inside it)');
  assert.equal(q.fiat.amount + feeSum, ENTERED, 'trade value + Paymax + provider fees must sum to the entered gross');
  assert.ok(feeSum > 0, 'percentage fees must be non-zero');
});

test('BUG1: buy/fiat — entering your full available balance is never rejected (total ≤ entered)', () => {
  const q = buildQuote(makeAsset(), { assetId: 'cr_test', side: 'buy', basis: 'fiat', amount: ENTERED, currency: 'NGN' });
  // buy/index.tsx rejects when totalFiat > investable; with amount === balance this must not trip.
  assert.ok(q.totalFiat.amount <= ENTERED, 'total to pay must not exceed the entered amount');
});

// ── BUY · crypto basis — must stay: total = trade value + fees ──────────────────

test('buy/crypto — total = trade value + fees (unchanged; fees added on top of a crypto-denominated order)', () => {
  const cryptoMinor = 1_000_000; // 0.01 coin
  const q = buildQuote(makeAsset(), { assetId: 'cr_test', side: 'buy', basis: 'crypto', amount: cryptoMinor, currency: 'NGN' });
  const spreadUnit = Math.round(PRICE * (1 + SPREAD_BPS_BY_RISK.low / 10_000));
  const expectedTrade = Math.round((cryptoMinor / 10 ** DECIMALS) * spreadUnit);
  const feeSum = fee(q, 'paymax_fee') + fee(q, 'provider_fee');
  assert.equal(q.crypto.amount, cryptoMinor, 'crypto quantity is exactly what was requested');
  assert.equal(q.fiat.amount, expectedTrade, 'trade value derived from crypto qty at the all-in rate');
  assert.equal(q.totalFiat.amount, expectedTrade + feeSum, 'buy debit = trade value + fees');
});

// ── SELL — must stay: total credit = trade value − fees ─────────────────────────

test('sell/fiat — user receives trade value minus fees (net credit below the trade value)', () => {
  const q = buildQuote(makeAsset(), { assetId: 'cr_test', side: 'sell', basis: 'fiat', amount: ENTERED, currency: 'NGN' });
  const feeSum = fee(q, 'paymax_fee') + fee(q, 'provider_fee');
  assert.equal(q.fiat.amount, ENTERED, 'sell/fiat: entered amount is the trade value');
  assert.equal(q.totalFiat.amount, Math.max(0, ENTERED - feeSum), 'sell credit = trade value − fees');
  assert.ok(q.totalFiat.amount < ENTERED, 'net credit is below the trade value');
});

test('sell/crypto — user receives trade value minus fees', () => {
  const cryptoMinor = 1_000_000;
  const q = buildQuote(makeAsset(), { assetId: 'cr_test', side: 'sell', basis: 'crypto', amount: cryptoMinor, currency: 'NGN' });
  const feeSum = fee(q, 'paymax_fee') + fee(q, 'provider_fee');
  assert.equal(q.totalFiat.amount, Math.max(0, q.fiat.amount - feeSum), 'sell credit = trade value − fees');
});

// ── SWAP — the itemised fee must actually reduce the output ─────────────────────

test('BUG1(swap): buildSwapQuote — the swap fee is actually applied to the output, not just displayed', () => {
  const from = makeAsset({ id: 'from', symbol: 'FRM' });
  const to = makeAsset({ id: 'to', symbol: 'TOO' });
  const fromAmountMinor = 50_000_000; // 0.5 coin
  const q = buildSwapQuote(from, to, fromAmountMinor);

  const fromFiat = Math.round((fromAmountMinor / 10 ** DECIMALS) * PRICE);
  const feeFiat = Math.round((fromFiat * SWAP_FEE_BPS) / 10_000);
  const netFiat = Math.round(fromFiat * (1 - SWAP_SPREAD_BPS / 10_000)) - feeFiat;
  const expectedTo = Math.round((netFiat / to.price.amount) * 10 ** DECIMALS);

  const noFeeTo = Math.round((Math.round(fromFiat * (1 - SWAP_SPREAD_BPS / 10_000)) / to.price.amount) * 10 ** DECIMALS);

  assert.equal(q.fee.amount, feeFiat, 'itemised swap fee is unchanged');
  assert.equal(q.to.amount, expectedTo, 'output reflects spread AND fee');
  assert.ok(q.to.amount < noFeeTo, 'applying the fee must reduce the output vs. spread-only');
});
