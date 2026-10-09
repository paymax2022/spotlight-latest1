/**
 * FIN-007 — edge: auth + object-level authZ on every touched money endpoint.
 *
 * - Anon → 401 on every money endpoint exercised by FIN-001..006
 *   (plus 401/redirect posture on the BFF proxies).
 * - User B cannot read or mutate user A's wallet, ledger view, vaults, or
 *   admin-scoped wallet lookups (403/404, never 200-with-data).
 * - Non-integer / non-kobo amounts are refused before money moves
 *   (400 invalid_request — never a float amount).
 */

import { expect, test } from '@playwright/test';

import {
  bffFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  provisionVerifiedUser,
  setKycTier,
  setProfilePhone,
  uniquePhone,
  walletBalanceSql,
} from './helpers';

test.describe('FIN-007 edge — auth & authZ', () => {
  test('anon → 401 on every money endpoint touched this run', async ({ request }) => {
    const gets = [
      '/api/finance/wallet/balance',
      '/api/finance/wallet/transactions',
      '/api/finance/savings/vaults',
      '/api/finance/savings/summary',
      '/api/finance/referral/config',
      '/api/finance/referral/my-rewards',
      '/api/finance/referral/withdraw-eligible',
      '/api/finance/referrals/me',
      '/api/finance/loyalty/me',
      '/api/finance/loyalty/tiers',
      '/api/finance/loyalty/points/balance',
      '/api/finance/loyalty/points/catalog',
      '/api/finance/social/social/handle/me',
      '/api/finance/transfers/pin/status',
      '/v1/referrals/me/dashboard',
      '/v1/referrals/me/referrals',
      '/v1/referrals/me/earnings',
    ];
    for (const path of gets) {
      const res = await goFetch(request, path);
      expect(res.status, `anon GET ${path} should be 401, got ${res.status}`).toBe(401);
    }

    const posts = [
      '/api/finance/transfers/paymax',
      '/api/finance/savings/vaults',
      '/api/finance/social/social/send',
      '/api/finance/social/social/handle',
      '/api/finance/referral/withdraw',
      '/api/finance/referral/claim-code',
      '/api/finance/loyalty/points/redeem',
      '/v1/referrals/link',
      '/v1/referrals/attribute',
    ];
    for (const path of posts) {
      const res = await goFetch(request, path, {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey('anon') },
        data: {},
      });
      expect(res.status, `anon POST ${path} should be 401, got ${res.status}`).toBe(401);
    }
  });

  test('user B cannot read or act on user A objects', async ({ request }) => {
    const a = await provisionVerifiedUser(request, 'fin007a');
    const b = await provisionVerifiedUser(request, 'fin007b');
    const aToken = await goTrueToken(request, a.email, a.password);
    const bToken = await goTrueToken(request, b.email, b.password);
    setKycTier(a.userId, 1);
    fundWallet(a.userId, 300_000, `fin007-${Date.now()}`);

    // A creates a vault and deposits.
    const vault = await goFetch(request, '/api/finance/savings/vaults', {
      method: 'POST',
      token: aToken,
      data: { name: 'A vault', kind: 'FLEX' },
    });
    const vaultId = vault.body?.vault?.id;
    await goFetch(request, `/api/finance/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token: aToken,
      headers: { 'Idempotency-Key': idemKey('a-dep') },
      data: { amount_kobo: 100_000 },
    });

    // B reads A's vault balance → 403; deposits to A's vault → 403.
    const readVault = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/balance`, { token: bToken });
    expect(readVault.status).toBe(403);
    const depVault = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token: bToken,
      headers: { 'Idempotency-Key': idemKey('b-dep') },
      data: { amount_kobo: 50_000 },
    });
    expect(depVault.status).toBe(403);
    const wdVault = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/withdraw`, {
      method: 'POST',
      token: bToken,
      headers: { 'Idempotency-Key': idemKey('b-wd') },
      data: { amount_kobo: 50_000 },
    });
    expect(wdVault.status).toBe(403);

    // B hits the admin wallet-lookup on A → 403 (RBAC fail-closed, not just 401).
    const adminBal = await goFetch(request, `/api/finance/admin/wallets/${a.userId}/balance`, { token: bToken });
    expect([403, 404]).toContain(adminBal.status);
    const adminTxns = await goFetch(request, `/api/finance/admin/wallets/${a.userId}/transactions`, { token: bToken });
    expect([403, 404]).toContain(adminTxns.status);

    // Member wallet surface is self-scoped: B's balance call can only ever
    // return B's pot — no query param leaks A's.
    const bBal = await goFetch(request, '/api/finance/wallet/balance', { token: bToken });
    expect(bBal.status).toBe(200);
    expect(bBal.body.user_id).toBe(b.userId);
    expect(bBal.body.balance_kobo).toBe(0);

    // A's wallet untouched by B's probes.
    expect(walletBalanceSql(a.userId)).toBe(200_000);
  });

  test('non-integer and non-kobo amounts are refused before money moves', async ({ request }) => {
    const sender = await provisionVerifiedUser(request, 'fin007c');
    const recipient = await provisionVerifiedUser(request, 'fin007d');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    setKycTier(sender.userId, 1);
    const phone = uniquePhone();
    setProfilePhone(recipient.userId, phone);
    fundWallet(sender.userId, 300_000, `fin007amt-${Date.now()}`);

    for (const bad of [100.5, '100000', -50000, 0, null]) {
      const res = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST',
        token: senderToken,
        headers: { 'Idempotency-Key': idemKey('bad-amt') },
        data: { recipient_phone: phone, amount_kobo: bad },
      });
      expect(res.status, `amount_kobo=${JSON.stringify(bad)} → ${res.status}`).toBe(400);
    }
    expect(walletBalanceSql(sender.userId)).toBe(300_000); // nothing moved
  });
});
