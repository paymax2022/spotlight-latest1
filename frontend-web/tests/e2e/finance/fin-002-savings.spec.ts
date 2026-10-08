/**
 * FIN-002 — savings vaults.
 *
 * Member surface: /api/finance/savings/vaults* (Go, FEATURE_SAVINGS_ENABLED)
 * proxied same-origin at /api/v1/savings/* (BFF). Journey: create a FLEX vault
 * → deposit (wallet → escrow hold) → read balances → withdraw back to wallet.
 * Ledger legs are asserted balanced via SQL (DR user_wallet / CR escrow on
 * deposit, DR escrow / CR user_wallet on withdraw). LOCK-vault early withdraw
 * is guarded (409); BOLA probes live in fin-007-edge.
 *
 * Fixture-only: funding journal + kyc_tier seeded via psql.
 */

import { expect, test } from '@playwright/test';

import {
  assertKoboIntegers,
  bffFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  setKycTier,
  walletBalanceSql,
} from './helpers';

const FUND_KOBO = 500_000; // ₦5,000
const DEPOSIT_KOBO = 200_000; // ₦2,000
const WITHDRAW_KOBO = 50_000; // ₦500

test.describe('FIN-002 savings vaults', () => {
  test('create → deposit → balance → withdraw keeps ledger balanced', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin002');
    setKycTier(user.userId, 1);
    const token = await goTrueToken(request, user.email, user.password);
    fundWallet(user.userId, FUND_KOBO, `fin002-${Date.now()}`);

    // ── create a FLEX vault through the BFF proxy ─────────────────────────
    const created = await bffFetch(request, '/api/v1/savings/vaults', {
      method: 'POST',
      token,
      data: { name: 'E2E Rainy Day', kind: 'FLEX', target_kobo: 400_000 },
    });
    expect(created.status).toBe(201);
    const vaultId = created.body?.vault?.id;
    expect(vaultId).toBeTruthy();

    // ── deposit without Idempotency-Key → refused ─────────────────────────
    const noKey = await bffFetch(request, `/api/v1/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token,
      data: { amount_kobo: DEPOSIT_KOBO },
    });
    expect([400, 401]).toContain(noKey.status);

    // ── deposit with key → wallet DR / escrow CR ──────────────────────────
    const dep = await bffFetch(request, `/api/v1/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('dep') },
      data: { amount_kobo: DEPOSIT_KOBO },
    });
    expect(dep.status).toBe(200);
    expect(dep.body.success).toBe(true);
    expect(dep.body.balance_kobo).toBe(DEPOSIT_KOBO);

    const legs = ledgerSums(`savings:deposit:${vaultId}`);
    expect(legs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountType: 'user_wallet', accountUserId: user.userId, side: 'DEBIT', total: DEPOSIT_KOBO }),
        expect.objectContaining({ accountType: 'escrow', side: 'CREDIT', total: DEPOSIT_KOBO }),
      ]),
    );
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO - DEPOSIT_KOBO);
    // NOTE: global escrow balance is not asserted — specs run fullyParallel and
    // sibling specs move the same standing account. Per-reference legs are
    // asserted via ledgerSums instead (reference-scoped, race-free).

    // ── reads reflect the deposit ─────────────────────────────────────────
    const bal = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/balance`, { token });
    expect(bal.status).toBe(200);
    expect(bal.body.balance_kobo).toBe(DEPOSIT_KOBO);

    const summary = await goFetch(request, '/api/finance/savings/summary', { token });
    expect(summary.status).toBe(200);
    expect(summary.body.summary.vault_balance_kobo).toBe(DEPOSIT_KOBO);
    expect(summary.body.summary.total_saved_kobo).toBe(DEPOSIT_KOBO);
    expect(assertKoboIntegers(summary.body)).toEqual([]);

    const wallet = await goFetch(request, '/api/finance/wallet/balance', { token });
    expect(wallet.body.balance_kobo).toBe(FUND_KOBO - DEPOSIT_KOBO);

    // ── withdraw → escrow DR / wallet CR ──────────────────────────────────
    const wd = await bffFetch(request, `/api/v1/savings/vaults/${vaultId}/withdraw`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('wd') },
      data: { amount_kobo: WITHDRAW_KOBO },
    });
    expect(wd.status).toBe(200);
    expect(wd.body.balance_kobo).toBe(DEPOSIT_KOBO - WITHDRAW_KOBO);

    const wdLegs = ledgerSums(`savings:withdraw:${vaultId}`);
    expect(wdLegs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountType: 'user_wallet', accountUserId: user.userId, side: 'CREDIT', total: WITHDRAW_KOBO }),
        expect.objectContaining({ accountType: 'escrow', side: 'DEBIT', total: WITHDRAW_KOBO }),
      ]),
    );
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO - DEPOSIT_KOBO + WITHDRAW_KOBO);

    // ── over-withdraw → refused, nothing moves ────────────────────────────
    const over = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/withdraw`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('over') },
      data: { amount_kobo: DEPOSIT_KOBO },
    });
    expect(over.status).toBe(409); // ErrInsufficientVault
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO - DEPOSIT_KOBO + WITHDRAW_KOBO);
  });

  test('LOCK vault refuses early withdrawal before maturity', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin002lock');
    setKycTier(user.userId, 1);
    const token = await goTrueToken(request, user.email, user.password);
    fundWallet(user.userId, FUND_KOBO, `fin002lock-${Date.now()}`);

    // Lock vault without a maturity date is a validation error.
    const bad = await goFetch(request, '/api/finance/savings/vaults', {
      method: 'POST',
      token,
      data: { name: 'No maturity', kind: 'LOCK' },
    });
    expect(bad.status).toBe(400);

    const maturesAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const created = await goFetch(request, '/api/finance/savings/vaults', {
      method: 'POST',
      token,
      data: { name: 'E2E Locked', kind: 'LOCK', target_kobo: 100_000, matures_at: maturesAt },
    });
    expect(created.status).toBe(201);
    const vaultId = created.body?.vault?.id;

    const dep = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('lockdep') },
      data: { amount_kobo: 100_000 },
    });
    expect(dep.status).toBe(200);

    const wd = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/withdraw`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('lockwd') },
      data: { amount_kobo: 50_000 },
    });
    expect(wd.status).toBe(409); // ErrLockedVault — early break guarded
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO - 100_000);
  });

  test('deposit beyond wallet balance is refused fail-closed', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin002poor');
    setKycTier(user.userId, 1);
    const token = await goTrueToken(request, user.email, user.password);
    fundWallet(user.userId, 100_000, `fin002poor-${Date.now()}`);

    const created = await goFetch(request, '/api/finance/savings/vaults', {
      method: 'POST',
      token,
      data: { name: 'E2E Overdraw', kind: 'FLEX' },
    });
    const vaultId = created.body?.vault?.id;
    const dep = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('poor') },
      data: { amount_kobo: 500_000 },
    });
    expect(dep.status).toBe(400); // ledger.ErrInsufficientFunds → default 400 in savings errMap
    expect(walletBalanceSql(user.userId)).toBe(100_000);
  });
});
