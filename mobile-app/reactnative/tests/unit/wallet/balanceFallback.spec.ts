// Pure-logic tests for the mobile wallet balance fallback's derivation —
// resolveFallbackBalanceKobo mirrors the server's getBalance()
// (frontend-web/src/server/wallet/service.ts, ADR-045) so the figure shown
// when the API is unreachable or KYC-gated is the SAME one the API reports.
//
// Regression: the old fallback read wallet_balance via an unfiltered
// maybeSingle(), which errored the moment a user held >1 ledger account —
// producing a fabricated ₦0.00 that masked a real ₦499,900 balance.
//   node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test tests/unit/wallet/*.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFallbackBalanceKobo } from '@/api/mappers/wallet.mapper';

test('sums available_kobo across both spendable planes', () => {
  const kobo = resolveFallbackBalanceKobo({
    spendableRows: [
      { account_type: 'user_wallet', available_kobo: 40_000_000 },
      { account_type: 'wallet',      available_kobo:  9_990_000 },
    ],
    unifiedHasEntries: true,
    legacyBalanceNaira: null,
  });
  assert.equal(kobo, 49_990_000); // ₦499,900
});

test('a nonzero net (incl. negative) is the balance — never dips into legacy', () => {
  const kobo = resolveFallbackBalanceKobo({
    spendableRows: [{ available_kobo: -5_000 }],
    unifiedHasEntries: true,
    legacyBalanceNaira: 499_900,
  });
  assert.equal(kobo, -5_000);
});

test('net zero WITH ledger entries is a real ₦0 — legacy is not consulted', () => {
  const kobo = resolveFallbackBalanceKobo({
    spendableRows: [{ account_type: 'user_wallet', available_kobo: 0 }],
    unifiedHasEntries: true,
    legacyBalanceNaira: 499_900,
  });
  assert.equal(kobo, 0);
});

test('net zero and NO ledger entries → legacy mobile_fintech_accounts (naira → kobo)', () => {
  const kobo = resolveFallbackBalanceKobo({
    spendableRows: [],
    unifiedHasEntries: false,
    legacyBalanceNaira: 499_900,
  });
  assert.equal(kobo, 49_990_000);
});

test('no ledger rows and no legacy balance → genuine ₦0 (new account)', () => {
  assert.equal(
    resolveFallbackBalanceKobo({ spendableRows: [], unifiedHasEntries: false, legacyBalanceNaira: null }),
    0,
  );
  assert.equal(
    resolveFallbackBalanceKobo({ spendableRows: [], unifiedHasEntries: false, legacyBalanceNaira: 0 }),
    0,
  );
});

test('legacy naira amounts are rounded to integer kobo', () => {
  const kobo = resolveFallbackBalanceKobo({
    spendableRows: [],
    unifiedHasEntries: false,
    legacyBalanceNaira: 1234.567,
  });
  assert.equal(kobo, 123_457);
});
