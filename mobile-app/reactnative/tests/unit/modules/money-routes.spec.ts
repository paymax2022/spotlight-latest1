// Pure-logic tests for the transaction-PIN route gate.
// Run: npm run test:modules
//
// The gate used to fire on EVERY route, so a signed-in user without a PIN could
// not read their contest application, an announcement or a lab result without
// first creating a payment credential. Two failure directions are pinned here:
//   • a browse route gating again (the regression this replaced);
//   • a payment step NOT gating — which is only a worse prompt, never an
//     unprotected payment, because the server enforces `pin_not_set` on every
//     wallet debit, but is still the wrong experience.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requiresTransactionPin } from '@/features/security/moneyRoutes';

describe('transaction-PIN gate: browse routes stay open', () => {
  const browseRoutes: string[][] = [
    ['registration', '[id]', 'status'],
    ['registration', 'applications'],
    ['voting', 'contestant-profile'],
    ['voting', 'leaderboard'],
    ['voting', 'contest-details'],
    ['association', 'home'],
    ['association', 'announcements'],
    ['association', 'directory'],
    ['health', 'pharmacy'],
    ['health', 'lab'],
    ['food'],
    ['stays'],
    ['mobility'],
    ['marketplace'],
    ['services'],
    ['(tabs)', 'home'],
    ['profile'],
    ['learn', 'academy'],
    ['events'],
    ['crowdfunding', 'campaigns'],
    ['connect'],
    ['social'],
  ];

  for (const segments of browseRoutes) {
    test(`/${segments.join('/')} does not require a PIN`, () => {
      assert.equal(requiresTransactionPin(segments), false);
    });
  }
});

describe('transaction-PIN gate: money paths still gate', () => {
  const moneyRoutes: string[][] = [
    ['wallet'],
    ['wallet', 'topup'],
    ['savings', 'ajo'],
    ['dues'],
    ['crypto', 'withdraw'],
    ['fx', 'cards', '[id]'],
    ['invest'],
    ['ai-trading', 'fund'],
    ['association', 'pay', '[invoiceId]'],
    ['association', 'event-pay', '[id]'],
    ['registration', '[id]', 'payment'],
    ['voting', 'buy-votes'],
    ['events', 'checkout', 'tiers'],
    ['health', 'pharmacy', 'checkout'],
    ['insurance', 'pay'],
    ['learn', 'academy', 'fees', 'pay', '[invoiceId]'],
    ['crowdfunding', 'contribute', '[id]'],
    ['social', 'escrow', 'checkout'],
    ['connect', 'wallet', 'fund'],
    ['creators', 'payout'],
    ['services', 'airtime'],
  ];

  for (const segments of moneyRoutes) {
    test(`/${segments.join('/')} requires a PIN`, () => {
      assert.equal(requiresTransactionPin(segments), true);
    });
  }
});

describe('transaction-PIN gate: matching rules', () => {
  test('an empty segment list never gates (splash / pre-auth)', () => {
    assert.equal(requiresTransactionPin([]), false);
  });

  test('matches by prefix, so any deeper payment screen also gates', () => {
    assert.equal(requiresTransactionPin(['wallet', 'topup', 'amount', 'confirm']), true);
  });

  test('a prefix must align on segment boundaries, not substrings', () => {
    // 'wallet-history' is a different route from 'wallet'; matching on a raw
    // string prefix would wrongly gate it.
    assert.equal(requiresTransactionPin(['wallet-history']), false);
  });

  test('Expo route groups are ignored — /wallet is (tabs)/wallet.tsx', () => {
    // Regression: matching raw segments meant the wallet TAB never gated, which
    // is the most obvious money surface in the app. Caught by loading it.
    assert.equal(requiresTransactionPin(['(tabs)', 'wallet']), true);
  });

  test('groups are stripped anywhere in the path, not just the front', () => {
    assert.equal(requiresTransactionPin(['(tabs)', 'services', 'airtime']), true);
  });

  test('a group-only path does not gate', () => {
    assert.equal(requiresTransactionPin(['(auth)']), false);
  });

  test('a browse tab still does not gate', () => {
    assert.equal(requiresTransactionPin(['(tabs)', 'home']), false);
  });

  test('a money word deeper in a browse route does not gate the browse route', () => {
    // The entry is ['association','pay']; the roster screen is not it.
    assert.equal(requiresTransactionPin(['association', 'members', 'pay-history']), false);
  });
});
