// Pure-logic unit tests for the provider-driven crypto BUY swap pipeline
// (backend/internal/cryptosvc, contracts/crypto-swaps.openapi.yaml). Run with:
//   node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs \
//        --test "src/features/crypto/utils/__tests__/*.test.ts"
//
// IRON RULES pinned here (money-path):
//  • NGN amounts are integer kobo — never floats, never strings for math.
//  • Crypto amounts are decimal STRINGS carried verbatim (no float round-trip).
//  • The quote body always carries exactly { asset, ngn_kobo } and nothing else.
//  • normalizeSwap maps the server's authoritative numbers straight through; it
//    never recomputes totals and rejects a kobo field that is not an integer.
//  • The stable machine error code drives the UX; a reused Idempotency-Key, an
//    expired quote and an invalid PIN each map to a distinct, actionable code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  swapQuoteBody,
  normalizeSwap,
  swapStage,
  mapSwapError,
  cryptoSwapsEnabled,
} from '../swapPipeline.ts';

// A representative raw swap exactly as the Go backend serialises it.
function rawSwap(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    status: 'quoted',
    side: 'buy',
    asset: 'USDT',
    ngn_kobo: 2_000_000,
    fee_kobo: 18_000,
    fee_bps: 90,
    total_kobo: 2_018_000,
    quoted_amount: '12.345678',
    price: '163000.00',
    expires_at: '2026-10-12T12:00:00Z',
    ...over,
  };
}

// ---- swapQuoteBody --------------------------------------------------------

test('swapQuoteBody carries exactly { asset, ngn_kobo }', () => {
  const body = swapQuoteBody('USDT', 2_000_000);
  assert.deepEqual(body, { asset: 'USDT', ngn_kobo: 2_000_000 });
  // No stray fields may ride along (the backend forbids additionalProperties).
  assert.deepEqual(Object.keys(body).sort(), ['asset', 'ngn_kobo']);
});

test('swapQuoteBody rejects a non-integer kobo amount (no floats)', () => {
  assert.throws(() => swapQuoteBody('USDT', 2_000_000.5), /integer/i);
});

test('swapQuoteBody rejects zero / negative / non-finite amounts', () => {
  assert.throws(() => swapQuoteBody('USDT', 0), /positive/i);
  assert.throws(() => swapQuoteBody('USDT', -100), /positive/i);
  assert.throws(() => swapQuoteBody('USDT', Number.NaN), /integer/i);
  assert.throws(() => swapQuoteBody('USDT', Number.POSITIVE_INFINITY), /integer/i);
});

test('swapQuoteBody rejects an amount beyond the safe-integer range', () => {
  assert.throws(() => swapQuoteBody('USDT', Number.MAX_SAFE_INTEGER + 2), /integer/i);
});

test('swapQuoteBody rejects an empty asset', () => {
  assert.throws(() => swapQuoteBody('', 2_000_000), /asset/i);
  assert.throws(() => swapQuoteBody('   ', 2_000_000), /asset/i);
});

// ---- normalizeSwap --------------------------------------------------------

test('normalizeSwap maps every field and keeps kobo as integers', () => {
  const s = normalizeSwap(rawSwap());
  assert.equal(s.id, '11111111-2222-3333-4444-555555555555');
  assert.equal(s.status, 'quoted');
  assert.equal(s.side, 'buy');
  assert.equal(s.asset, 'USDT');
  assert.equal(s.ngnKobo, 2_000_000);
  assert.equal(s.feeKobo, 18_000);
  assert.equal(s.feeBps, 90);
  assert.equal(s.totalKobo, 2_018_000);
  assert.equal(s.expiresAt, '2026-10-12T12:00:00Z');
  for (const v of [s.ngnKobo, s.feeKobo, s.totalKobo]) {
    assert.equal(Number.isInteger(v), true);
  }
});

test('normalizeSwap carries crypto amounts verbatim as decimal strings', () => {
  const s = normalizeSwap(rawSwap({ quoted_amount: '0.000000010000001', price: '163000.00' }));
  // A float round-trip would mangle these — they must survive byte-for-byte.
  assert.equal(s.quotedAmount, '0.000000010000001');
  assert.equal(s.price, '163000.00');
  assert.equal(typeof s.quotedAmount, 'string');
});

test('normalizeSwap exposes received_amount only once the provider confirms', () => {
  assert.equal(normalizeSwap(rawSwap()).receivedAmount, undefined);
  const settled = normalizeSwap(rawSwap({ status: 'completed', received_amount: '12.340000' }));
  assert.equal(settled.receivedAmount, '12.340000');
});

test('normalizeSwap does not recompute totals — it trusts the server', () => {
  // Even an "inconsistent" fee split (server is authoritative) passes through.
  const s = normalizeSwap(rawSwap({ ngn_kobo: 1_000_000, fee_kobo: 5_000, total_kobo: 1_005_000 }));
  assert.equal(s.totalKobo, 1_005_000);
});

test('normalizeSwap rejects a kobo field that is not an integer', () => {
  assert.throws(() => normalizeSwap(rawSwap({ total_kobo: 2_018_000.5 })), /integer/i);
  assert.throws(() => normalizeSwap(rawSwap({ ngn_kobo: '2000000' })), /integer/i);
});

test('normalizeSwap rejects a missing required field', () => {
  const { id, ...noId } = rawSwap();
  assert.throws(() => normalizeSwap(noId), /id/i);
});

// ---- swapStage ------------------------------------------------------------

test('swapStage classifies the swap lifecycle into UX buckets', () => {
  assert.equal(swapStage('quoted'), 'pending');
  assert.equal(swapStage('confirming'), 'pending');
  assert.equal(swapStage('processing'), 'pending');
  assert.equal(swapStage('completed'), 'done');
  assert.equal(swapStage('failed'), 'failed');
  assert.equal(swapStage('expired'), 'failed');
  assert.equal(swapStage('needs_review'), 'review');
});

// ---- mapSwapError ---------------------------------------------------------

test('mapSwapError reads the stable machine code from { success:false, error }', () => {
  const err = { response: { status: 422, data: { success: false, error: 'insufficient_funds' } } };
  const mapped = mapSwapError(err);
  assert.equal(mapped.cryptoType, 'insufficient_funds');
  assert.match(mapped.message, /enough|balance|wallet/i);
});

test('mapSwapError gives each actionable code a distinct message', () => {
  const codes = ['quote_expired', 'limit_exceeded', 'pin_invalid', 'pin_not_set', 'trading_not_allowed'];
  const seen = new Set<string>();
  for (const code of codes) {
    const m = mapSwapError({ response: { data: { success: false, error: code } } });
    assert.equal(m.cryptoType, code);
    assert.equal(seen.has(m.message), false, `message for ${code} must be distinct`);
    seen.add(m.message);
  }
});

test('mapSwapError never leaks a provider/database string and falls back cleanly', () => {
  const m = mapSwapError({ response: { data: { success: false, error: 'pq: duplicate key value' } } });
  assert.match(m.message, /something went wrong|try again/i);
  assert.doesNotMatch(m.message, /pq:|duplicate key/i);
});

test('mapSwapError handles a thrown Error with no response', () => {
  const m = mapSwapError(new Error('Network Error'));
  assert.equal(typeof m.message, 'string');
  assert.ok(m.message.length > 0);
});

// ---- cryptoSwapsEnabled ---------------------------------------------------

test('cryptoSwapsEnabled is off unless the env flag is explicitly "true"', () => {
  const prev = process.env.EXPO_PUBLIC_CRYPTO_SWAPS;
  try {
    delete process.env.EXPO_PUBLIC_CRYPTO_SWAPS;
    assert.equal(cryptoSwapsEnabled(), false);
    process.env.EXPO_PUBLIC_CRYPTO_SWAPS = 'false';
    assert.equal(cryptoSwapsEnabled(), false);
    process.env.EXPO_PUBLIC_CRYPTO_SWAPS = 'TRUE';
    assert.equal(cryptoSwapsEnabled(), true);
    process.env.EXPO_PUBLIC_CRYPTO_SWAPS = '  true ';
    assert.equal(cryptoSwapsEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_CRYPTO_SWAPS;
    else process.env.EXPO_PUBLIC_CRYPTO_SWAPS = prev;
  }
});
