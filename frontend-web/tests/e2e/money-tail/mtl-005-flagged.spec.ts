/**
 * MTL-005 — Flagged money-gap paths + flag-gate evidence.
 *
 * Flagged surfaces exercised:
 *   - POST /api/finance/transfers/resolve-account  (NUBAN name enquiry; the
 *     disbursement registry degrades to a deterministic mock on transport
 *     error, so the path answers whether or not the Paystack key is live —
 *     psp-unverified for the real network call)
 *   - /api/finance/restaurant/bank-accounts*       (merchant settlement-account
 *     capture + verify + default + delete; not money-path itself, feeds the
 *     withdrawal rail)
 *   - flag-gate evidence: every module in this lane whose feature flag is OFF
 *     in backend/.env must 404 — an unmounted route cannot move money.
 */

import { expect, test } from '@playwright/test';

import {
  goFetch,
  goTrueToken,
  provisionVerifiedUser,
} from './helpers';

const FLAG_GATED: { path: string; flag: string; note?: string }[] = [
  { path: '/api/v1/crypto/assets', flag: 'FEATURE_CRYPTO_ENABLED' },
  { path: '/api/v1/admin/crypto/orders', flag: 'FEATURE_CRYPTO_ENABLED' },
  { path: '/api/v1/invest/profile', flag: 'FEATURE_INVEST_ENABLED' },
  { path: '/api/v1/stocks', flag: 'FEATURE_INVEST_ENABLED' },
  { path: '/api/v1/admin/invest/overview', flag: 'FEATURE_INVEST_ENABLED' },
  { path: '/api/v1/trading/kyc/status', flag: 'FEATURE_TRADING_ENABLED' },
  { path: '/api/v1/admin/trading/kyc/queue', flag: 'FEATURE_TRADING_ENABLED' },
  { path: '/api/finance/fractionalre/offerings', flag: 'FEATURE_FRACTIONAL_RE_ENABLED' },
  { path: '/api/finance/fractionalre/admin/dashboard', flag: 'FEATURE_FRACTIONAL_RE_ENABLED' },
  { path: '/api/v1/spotlight/videos', flag: 'FEATURE_SPOTLIGHTWEALTH_ENABLED' },
  { path: '/api/arena/competitions', flag: 'FEATURE_ARENA_ENABLED' },
  { path: '/api/finance/fx/history', flag: 'FEATURE_FX_ENABLED+MAPLERAD_SECRET_KEY', note: 'flag ON but fxHandler nil — no Maplerad key' },
  { path: '/api/finance/admin/fx/markup', flag: 'MAPLERAD_SECRET_KEY', note: 'markup store built only with a Maplerad client' },
  { path: '/api/finance/maplerad/customer', flag: 'FEATURE_MAPLERAD_ENABLED' },
  { path: '/api/v1/doctor/profile', flag: 'FEATURE_DOCTOR_ENABLED' },
];

test.describe('MTL-005 flagged money-gap paths', () => {
  test('transfers/resolve-account resolves a NUBAN and refuses malformed input', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl005a');
    const token = await goTrueToken(request, user.email, user.password);

    const ok = await goFetch(request, '/api/finance/transfers/resolve-account', {
      method: 'POST', token, data: { account_number: '0000000000', bank_code: '058' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.account_number).toBe('0000000000');
    expect(ok.body.account_name).toBeTruthy();

    // non-10-digit → malformed request: 400 invalid_account_number
    // (E2E-MTL-003 fixed — validation failure is distinct from a 404
    // lookup-miss on a well-formed NUBAN)
    const bad = await goFetch(request, '/api/finance/transfers/resolve-account', {
      method: 'POST', token, data: { account_number: '123', bank_code: '058' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body?.code).toBe('invalid_account_number');

    // missing bank_code → binding/validation refusal
    const noBank = await goFetch(request, '/api/finance/transfers/resolve-account', {
      method: 'POST', token, data: { account_number: '0000000000' },
    });
    expect(noBank.status).toBe(400);

    // anonymous → 401
    const anon = await goFetch(request, '/api/finance/transfers/resolve-account', {
      method: 'POST', data: { account_number: '0000000000', bank_code: '058' },
    });
    expect(anon.status).toBe(401);
  });

  test('restaurant bank-accounts: verify → add → list → default → delete', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl005b');
    const token = await goTrueToken(request, user.email, user.password);
    const acct = { bank_name: 'GTBank', bank_code: '058', account_number: '0123456789', account_name: 'E2E Merchant' };

    const verify = await goFetch(request, '/api/finance/restaurant/bank-accounts/verify', {
      method: 'POST', token, data: acct,
    });
    // Restaurant is wired with the RAW paystack client (no mock fallback, unlike
    // the transfers registry's liveWrap) and PAYSTACK_SECRET_KEY is a placeholder
    // (sk_test_xxx…) — the real resolve call cannot complete → 400.
    // psp-unverified: a live key would return is_verified + authoritative name.
    expect([200, 400]).toContain(verify.status);
    if (verify.status === 200) {
      expect(verify.body.is_verified).toBe(true);
      expect(verify.body.account_name).toBeTruthy();
    } else {
      expect(String(verify.body.error)).toContain('verification failed');
    }

    const bad = await goFetch(request, '/api/finance/restaurant/bank-accounts/verify', {
      method: 'POST', token, data: { ...acct, account_number: '123' },
    });
    expect(bad.status).toBe(400);

    const created = await goFetch(request, '/api/finance/restaurant/bank-accounts', {
      method: 'POST', token, data: acct,
    });
    expect(created.status).toBe(201);
    const acctId = created.body.id ?? created.body.data?.id;
    expect(acctId).toBeTruthy();
    // masked — full PAN never leaves the API
    expect(String(created.body.account_number_masked ?? created.body.data?.account_number_masked)).toContain('****');

    const listed = await goFetch(request, '/api/finance/restaurant/bank-accounts', { token });
    expect(listed.status).toBe(200);
    const rows = (listed.body.data ?? listed.body) as any[];
    expect(rows.some((b) => b.id === acctId)).toBe(true);

    const second = await goFetch(request, '/api/finance/restaurant/bank-accounts', {
      method: 'POST', token, data: { ...acct, account_number: '0987654321', bank_code: '033' },
    });
    expect(second.status).toBe(201);
    const acct2 = second.body.id ?? second.body.data?.id;

    const def = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acct2}/default`, {
      method: 'PATCH', token, data: {},
    });
    expect(def.status).toBe(200);

    const del = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acctId}`, { method: 'DELETE', token });
    expect(del.status).toBe(200);

    // object authz: deleting a non-existent/other id is a clean error, not a 500
    const del2 = await goFetch(request, `/api/finance/restaurant/bank-accounts/${acctId}`, { method: 'DELETE', token });
    expect([400, 404]).toContain(del2.status);
  });

  test('flag-gated modules are unmounted: 404 evidence per module', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'mtl005c');
    const token = await goTrueToken(request, user.email, user.password);
    const results: Record<string, number> = {};
    for (const g of FLAG_GATED) {
      const res = await goFetch(request, g.path, { token });
      results[g.path] = res.status;
      expect(res.status, `${g.path} (${g.flag}) should be unmounted`).toBe(404);
    }
    test.info().annotations.push({ type: 'flag-gated', description: JSON.stringify(results) });
  });
});
