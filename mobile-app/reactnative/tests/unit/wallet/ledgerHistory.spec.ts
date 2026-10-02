// Pure-logic tests for the wallet ledger read path (AUD-FE-008).
//
// Regression: getWalletAccountId() ordered wallet_balance rows by account_type
// ascending and took the FIRST. Post-ADR-045 consolidation a user's pre-sweep
// history lives on the legacy 'wallet' plane while new activity lands on
// 'user_wallet' — so the transactions list and Income/Expenses silently
// under-reported every entry on the other plane. History must follow the USER.
//
//   node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test tests/unit/wallet/*.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_SWEEP_REFERENCE_LIKE,
  isCreditLedgerType,
  isInternalSweepReference,
  selectSpendableAccountIds,
  summarizeLedgerRows,
} from '@/api/mappers/walletLedger.mapper';

const SWEEP_DEBIT_REF = 'wallet-plane-consolidate:legacy-acct-1';

test('selectSpendableAccountIds returns BOTH planes, not the first row', () => {
  const ids = selectSpendableAccountIds([
    { account_id: 'acct-unified', account_type: 'user_wallet' },
    { account_id: 'acct-legacy',  account_type: 'wallet' },
  ]);
  assert.deepEqual(ids, ['acct-legacy', 'acct-unified'].sort());
});

test('selectSpendableAccountIds dedupes and drops empty ids', () => {
  const ids = selectSpendableAccountIds([
    { account_id: 'a' },
    { account_id: 'a' },
    { account_id: '' },
    {},
    { account_id: 'b' },
  ]);
  assert.deepEqual(ids, ['a', 'b']);
});

test('selectSpendableAccountIds on no rows → [] (screen degrades to empty)', () => {
  assert.deepEqual(selectSpendableAccountIds([]), []);
});

test('sweep legs are identifiable by the consolidate reference prefix', () => {
  assert.equal(isInternalSweepReference(SWEEP_DEBIT_REF), true);
  assert.equal(isInternalSweepReference('wallet-plane-consolidate:legacy-acct-1'), true);
  assert.equal(isInternalSweepReference('paystack:topup:123'), false);
  assert.equal(isInternalSweepReference('wallet-plane-consolidation:x'), false);
  assert.equal(isInternalSweepReference(''), false);
  assert.equal(isInternalSweepReference(null), false);
  assert.equal(isInternalSweepReference(undefined), false);
});

test('INTERNAL_SWEEP_REFERENCE_LIKE is a prefix LIKE for the PostgREST NOT filter', () => {
  assert.equal(INTERNAL_SWEEP_REFERENCE_LIKE, 'wallet-plane-consolidate:%');
});

test('direction: CREDIT + REVERSAL_DEBIT are money in; DEBIT + REVERSAL_CREDIT out', () => {
  assert.equal(isCreditLedgerType('CREDIT'), true);
  assert.equal(isCreditLedgerType('REVERSAL_DEBIT'), true);
  assert.equal(isCreditLedgerType('DEBIT'), false);
  assert.equal(isCreditLedgerType('REVERSAL_CREDIT'), false);
});

test('totals span both planes and exclude the sweep pair — reconciliation holds', () => {
  // Legacy plane: 500_000 real top-up + 200_000 real spend, then swept out.
  // Unified plane: sweep lands 300_000, then a 50_000 spend.
  const totals = summarizeLedgerRows([
    { type: 'CREDIT', amount_kobo: 500_000, reference: 'paystack:topup:1' },
    { type: 'DEBIT',  amount_kobo: 200_000, reference: 'transfer:1' },
    { type: 'DEBIT',  amount_kobo: 300_000, reference: SWEEP_DEBIT_REF },          // legacy sweep out
    { type: 'CREDIT', amount_kobo: 300_000, reference: SWEEP_DEBIT_REF },          // unified sweep in
    { type: 'DEBIT',  amount_kobo: 50_000,  reference: 'transfer:2' },
  ]);
  assert.equal(totals.incomeKobo, 500_000);
  assert.equal(totals.expensesKobo, 250_000);
  assert.equal(totals.entryCount, 3);
  // income − expenses = 250_000 = the real spendable balance across both planes:
  // (500k − 200k − 300k sweep) + (300k sweep − 50k) = 250k. The pair nets to zero.
  assert.equal(totals.incomeKobo - totals.expensesKobo, 250_000);
});

test('summarizeLedgerRows counts reversals under the balance formula', () => {
  const totals = summarizeLedgerRows([
    { type: 'CREDIT',          amount_kobo: 100_000, reference: 'r1' },
    { type: 'REVERSAL_CREDIT', amount_kobo: 100_000, reference: 'r1:rev' },
    { type: 'DEBIT',           amount_kobo: 40_000,  reference: 'r2' },
    { type: 'REVERSAL_DEBIT',  amount_kobo: 40_000,  reference: 'r2:rev' },
  ]);
  assert.equal(totals.incomeKobo, 140_000);   // CREDIT + REVERSAL_DEBIT
  assert.equal(totals.expensesKobo, 140_000); // DEBIT + REVERSAL_CREDIT
  assert.equal(totals.entryCount, 4);
});

test('a lone sweep leg still cannot leak into totals (defensive layer)', () => {
  const totals = summarizeLedgerRows([
    { type: 'CREDIT', amount_kobo: 300_000, reference: SWEEP_DEBIT_REF },
  ]);
  assert.deepEqual(totals, { incomeKobo: 0, expensesKobo: 0, entryCount: 0 });
});
