/**
 * CMS-012 — restaurant merchant bank-account capture surface (the
 * bank-accounts residual from the restaurant lane): add (10-digit account,
 * provider soft-verify, first account auto-default, upsert idempotent on
 * (user,bank,number)) → list (masked) → verify probe → set-default → delete.
 * Capture-only: no ledger legs are posted by these endpoints (asserted).
 */

import { expect, test } from '@playwright/test';

import {
  goFetch,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
} from './helpers';

const ACCT = { bank_name: 'GTBank', bank_code: '058', account_number: '0123456789', account_name: 'E2E Merchant' };
const ACCT2 = { bank_name: 'Access', bank_code: '044', account_number: '0987654321', account_name: 'E2E Merchant' };

test.describe('CMS-012 restaurant bank-accounts: capture → default → delete', () => {
  test('add/list/default/delete + verify + masking + validation', async ({ request }) => {
    const owner = await provisionVerifiedUser(request, 'cms-rbank');
    const token = await goTrueToken(request, owner.email, owner.password);

    // Validation: non-10-digit account → 400.
    const bad = await goFetch(request, '/api/finance/restaurant/bank-accounts', {
      method: 'POST',
      token,
      data: { ...ACCT, account_number: '123' },
    });
    expect(bad.status).toBe(400);

    // Add — provider may be absent locally; either way the account saves
    // (verification is soft-fail by design).
    const add = await goFetch(request, '/api/finance/restaurant/bank-accounts', {
      method: 'POST',
      token,
      data: ACCT,
    });
    expect(add.status).toBe(201);
    const acctId = add.body?.id;
    expect(acctId).toBeTruthy();
    expect(add.body?.is_default).toBe(true); // first account auto-default
    // Number must be masked in the response — the raw PAN must never echo.
    expect(add.body?.account_number ?? add.body?.accountNumber ?? '').not.toContain(ACCT.account_number.slice(0, 6));

    // Idempotent re-add of the same (user, bank, number) → same row, 201.
    const again = await goFetch(request, '/api/finance/restaurant/bank-accounts', {
      method: 'POST',
      token,
      data: ACCT,
    });
    expect(again.status).toBe(201);
    expect(again.body?.id).toBe(acctId);

    // Second account → not default; then set-default flips.
    const add2 = await goFetch(request, '/api/finance/restaurant/bank-accounts', {
      method: 'POST',
      token,
      data: ACCT2,
    });
    expect(add2.status).toBe(201);
    const acct2Id = add2.body?.id;
    expect(add2.body?.is_default).toBe(false);

    const setDef = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acct2Id}/default`, {
      method: 'PATCH',
      token,
    });
    expect(setDef.status).toBe(200);

    const list = await goFetch(request, '/api/finance/restaurant/bank-accounts', { token });
    expect(list.status).toBe(200);
    const rows = list.body?.data ?? [];
    expect(rows.length).toBe(2);
    expect(rows[0].is_default).toBe(true);
    expect(rows[0].id).toBe(acct2Id);

    // Verify probe (real-time provider check; soft-fail when no disbursement
    // provider is wired locally — must still answer cleanly).
    const verify = await goFetch(request, '/api/finance/restaurant/bank-accounts/verify', {
      method: 'POST',
      token,
      data: ACCT,
    });
    expect([200, 400, 503]).toContain(verify.status);

    // Owner scoping: another user cannot see/delete the account.
    const stranger = await provisionVerifiedUser(request, 'cms-rbank2');
    const sToken = await goTrueToken(request, stranger.email, stranger.password);
    const sList = await goFetch(request, '/api/finance/restaurant/bank-accounts', { token: sToken });
    expect(sList.status).toBe(200);
    expect((sList.body?.data ?? []).length).toBe(0);
    const sDel = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acct2Id}`, {
      method: 'DELETE',
      token: sToken,
    });
    expect([403, 404]).toContain(sDel.status);

    // Delete own account; delete again → not found.
    const del = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acct2Id}`, {
      method: 'DELETE',
      token,
    });
    expect(del.status).toBe(200);
    const delAgain = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acct2Id}`, {
      method: 'DELETE',
      token,
    });
    expect([403, 404]).toContain(delAgain.status);

    // Capture-only invariant: no ledger legs for bank-account writes.
    const legs = ledgerSums(`%restaurant%bank%`);
    const mine = legs.filter((l) => l.accountUserId === owner.userId);
    expect(mine.length).toBe(0);
  });
});
