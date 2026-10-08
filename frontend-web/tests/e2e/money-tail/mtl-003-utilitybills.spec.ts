/**
 * MTL-003 — Utility Bills member money path (/api/finance/utilitybills/*).
 *
 * FEATURE_UTILITY_BILLS_ENABLED=true in backend/.env; the catalogue is seeded
 * (vtpass-* billers/products/mappings). VTPASS_API_KEY is UNSET so the provider
 * call fails at transport — but the money path is fully exercised: wallet
 * debit posts balanced legs, the failed provider leg auto-reverses, and the
 * idempotent replay returns the original transaction. That is the honest
 * behaviour this environment can prove (psp-unverified: no live VTpass vend
 * is possible without credentials).
 *
 * Asserts:
 *   - catalogue reads (categories/billers/products) + validate + quote
 *   - pay REQUIRES Idempotency-Key (400 without)
 *   - pay debits the wallet (DR user_wallet / CR provider_clearing legs)
 *   - provider failure → auto-reversal legs (REVERSAL_DEBIT on user_wallet),
 *     status 'reversed', wallet restored
 *   - replay → already_processed:true, zero additional legs
 *   - tier gate fail-closed: a tier-0 funded wallet → 403 wallet_disabled,
 *     ZERO ledger legs
 *   - transactions/attempts/requery/dispute + beneficiaries CRUD
 */

import { expect, test } from '@playwright/test';

import {
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
  walletBalanceSql,
} from './helpers';

const AIRTIME_BILLER = '65f0e55a-a2db-40d1-a7c7-fc9dcd385ce2'; // Airtel Airtime (seeded)
const AIRTIME_PRODUCT = '89bef569-6198-4fbb-a35d-4655c8d5c7a2'; // vtpass-airtel-airtime-variable
const PAY_BODY = {
  category: 'airtime',
  biller_id: AIRTIME_BILLER,
  product_id: AIRTIME_PRODUCT,
  customer_reference: '08030000001',
  amount_kobo: 10_000,
};

test.describe('MTL-003 utilitybills member', () => {
  test('catalogue → validate → quote', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl003a');
    const token = await goTrueToken(request, user.email, user.password);

    const cats = await goFetch(request, '/api/finance/utilitybills/categories', { token });
    expect(cats.status).toBe(200);
    expect((cats.body.categories as any[]).some((c) => c.id === 'airtime')).toBe(true);

    const billers = await goFetch(request, '/api/finance/utilitybills/billers?category=airtime', { token });
    expect(billers.status).toBe(200);
    expect((billers.body.billers as any[]).some((b) => b.id === AIRTIME_BILLER)).toBe(true);

    const products = await goFetch(request, `/api/finance/utilitybills/products?category=airtime&biller_id=${AIRTIME_BILLER}`, { token });
    expect(products.status).toBe(200);
    expect((products.body.products as any[]).some((p) => p.id === AIRTIME_PRODUCT)).toBe(true);

    const val = await goFetch(request, '/api/finance/utilitybills/validate', {
      method: 'POST', token,
      data: { category: 'airtime', biller_id: AIRTIME_BILLER, product_id: AIRTIME_PRODUCT, customer_reference: '08030000001' },
    });
    expect(val.status).toBe(200);
    expect(val.body.valid).toBe(true);

    const quote = await goFetch(request, '/api/finance/utilitybills/quote', {
      method: 'POST', token, data: { category: 'airtime', biller_id: AIRTIME_BILLER, product_id: AIRTIME_PRODUCT, amount_kobo: 10_000 },
    });
    expect(quote.status).toBe(200);
    expect(quote.body.quote.retail_amount_kobo).toBe(10_000);
    expect(Number.isInteger(quote.body.quote.retail_amount_kobo)).toBe(true);

    // amount below the seeded product minimum → refused before any money discussion
    const tooLow = await goFetch(request, '/api/finance/utilitybills/quote', {
      method: 'POST', token, data: { category: 'airtime', biller_id: AIRTIME_BILLER, product_id: AIRTIME_PRODUCT, amount_kobo: 100 },
    });
    expect(tooLow.status).toBe(400);
  });

  test('pay → provider failure auto-reverses; replay idempotent; wallet restored', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl003b');
    const token = await goTrueToken(request, user.email, user.password);
    setKycTier(user.userId, 3);
    const tag = `mtl003b-${Date.now()}`;
    fundWallet(user.userId, 100_000, tag);
    expect(walletBalanceSql(user.userId)).toBe(100_000);

    // missing Idempotency-Key → 400
    const noKey = await goFetch(request, '/api/finance/utilitybills/pay', { method: 'POST', token, data: PAY_BODY });
    expect(noKey.status).toBe(400);

    const key = idemKey('ub-pay');
    const pay = await goFetch(request, '/api/finance/utilitybills/pay', {
      method: 'POST', token, headers: { 'Idempotency-Key': key }, data: PAY_BODY,
    });
    expect(pay.status).toBe(200);
    const txn = pay.body.transaction;
    expect(pay.body.already_processed).toBe(false);
    // VTpass creds unset → provider leg fails → auto-reversal restores the wallet.
    expect(txn.status).toBe('reversed');

    const receipt: string = txn.receipt_number;
    const legs = ledgerSums(receipt);
    expect(legs.find((l) => l.accountType === 'user_wallet' && l.accountUserId === user.userId && l.side === 'DEBIT')?.total).toBe(10_000);
    expect(legs.find((l) => l.accountType === 'provider_clearing' && l.side === 'CREDIT')?.total).toBe(10_000);

    // reversal legs exist under their own reference and the wallet is whole
    const revLegs = psql(
      `select le.type || '|' || le.amount_kobo from ledger_entries le join ledger_accounts la on la.id=le.account_id ` +
        `where la.user_id='${user.userId}' and le.reference like 'utility:reversal:%' order by le.created_at desc limit 2;`,
    );
    expect(revLegs).toContain('REVERSAL_DEBIT|10000');
    expect(walletBalanceSql(user.userId)).toBe(100_000);

    // replay → same transaction, already_processed, no second debit
    const replay = await goFetch(request, '/api/finance/utilitybills/pay', {
      method: 'POST', token, headers: { 'Idempotency-Key': key }, data: PAY_BODY,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.already_processed).toBe(true);
    expect(replay.body.transaction.id).toBe(txn.id);
    expect(walletBalanceSql(user.userId)).toBe(100_000);

    // member reads on the transaction
    const list = await goFetch(request, '/api/finance/utilitybills/transactions', { token });
    expect(list.status).toBe(200);
    const detail = await goFetch(request, `/api/finance/utilitybills/transactions/${txn.id}`, { token });
    expect(detail.status).toBe(200);
    const attempts = await goFetch(request, `/api/finance/utilitybills/transactions/${txn.id}/attempts`, { token });
    expect(attempts.status).toBe(200);
    const req = await goFetch(request, `/api/finance/utilitybills/transactions/${txn.id}/requery`, { method: 'POST', token, data: {} });
    expect([200, 409]).toContain(req.status); // a reversed row may refuse requery
    const dispute = await goFetch(request, `/api/finance/utilitybills/transactions/${txn.id}/dispute`, {
      method: 'POST', token, data: { reason: 'e2e_probe' },
    });
    expect([200, 201, 409]).toContain(dispute.status); // disputed vs not-disputable state
  });

  test('tier gate fail-closed: tier-0 funded wallet → 403, zero ledger legs', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl003c');
    const token = await goTrueToken(request, user.email, user.password);
    // funded but kyc_tier stays 0 → wallet debit must be refused before money moves
    fundWallet(user.userId, 100_000, `mtl003c-${Date.now()}`);

    const legsBefore = Number(
      psql(`select count(*) from ledger_entries le join ledger_accounts la on la.id=le.account_id where la.user_id='${user.userId}' and le.reference like 'UTL-%';`) || '0',
    );
    const pay = await goFetch(request, '/api/finance/utilitybills/pay', {
      method: 'POST', token, headers: { 'Idempotency-Key': idemKey('ub-t0') }, data: PAY_BODY,
    });
    expect(pay.status).toBe(403);
    expect(pay.body?.code).toBe('wallet_disabled');
    const legsAfter = Number(
      psql(`select count(*) from ledger_entries le join ledger_accounts la on la.id=le.account_id where la.user_id='${user.userId}' and le.reference like 'UTL-%';`) || '0',
    );
    expect(legsAfter).toBe(legsBefore); // refused ⇒ ZERO legs
    expect(walletBalanceSql(user.userId)).toBe(100_000);

    // promote → same call now reaches the provider path
    setKycTier(user.userId, 3);
    const pay2 = await goFetch(request, '/api/finance/utilitybills/pay', {
      method: 'POST', token, headers: { 'Idempotency-Key': idemKey('ub-t3') }, data: PAY_BODY,
    });
    expect(pay2.status).toBe(200);
  });

  test('beneficiaries CRUD', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl003d');
    const token = await goTrueToken(request, user.email, user.password);

    const empty = await goFetch(request, '/api/finance/utilitybills/beneficiaries', { token });
    expect(empty.status).toBe(200);

    const created = await goFetch(request, '/api/finance/utilitybills/beneficiaries', {
      method: 'POST', token,
      data: {
        category: 'airtime', biller_id: AIRTIME_BILLER, product_id: AIRTIME_PRODUCT,
        customer_reference: '08030000001', label: 'E2E phone',
      },
    });
    expect([200, 201]).toContain(created.status);
    const benId = created.body?.beneficiary?.id ?? created.body?.id;

    const listed = await goFetch(request, '/api/finance/utilitybills/beneficiaries', { token });
    expect(listed.status).toBe(200);
    if (benId) {
      const del = await goFetch(request, `/api/finance/utilitybills/beneficiaries/${benId}`, { method: 'DELETE', token });
      expect([200, 204]).toContain(del.status);
    }
  });
});
