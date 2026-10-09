/**
 * FIN-001 — wallet surface.
 *
 * The web product has NO wallet UI page (mobile owns the wallet screens), so
 * this journey is exercised at the real API surface — the same Go endpoints
 * and BFF proxies the clients consume:
 *
 *   - GET :8080/api/finance/wallet/balance       (Go direct)
 *   - GET :3000/api/finance/wallet/balance        (BFF catch-all proxy → same Go route)
 *   - GET :3000/api/v1/wallet/balance             (Next-side wallet service, tier-1 gated)
 *   - GET :8080/api/finance/wallet/transactions   (ledger projection as tx list)
 *
 * Asserts: funded amount reads back as integer kobo; the funding journal is
 * visible in the transaction list; every *_kobo payload field is an integer;
 * SQL sum-of-entries == reported balance (ledger is the only source of truth).
 *
 * Fixture-only: the balanced provider_clearing/user_wallet funding journal and
 * kyc_tier are seeded via psql (no local PSP/KYC rail).
 */

import { expect, test } from '@playwright/test';

import {
  assertKoboIntegers,
  bffFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  provisionVerifiedUser,
  setKycTier,
  walletBalanceSql,
} from './helpers';

const FUND_KOBO = 1_000_000; // ₦10,000

test.describe('FIN-001 wallet surface', () => {
  test('balance + transactions reflect the funding journal as integer kobo', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin001');
    const token = await goTrueToken(request, user.email, user.password);
    const tag = `fin001-${Date.now()}`;
    fundWallet(user.userId, FUND_KOBO, tag);

    // ── Go direct ──────────────────────────────────────────────────────────
    const bal = await goFetch(request, '/api/finance/wallet/balance', { token });
    expect(bal.status).toBe(200);
    expect(bal.body.user_id).toBe(user.userId);
    expect(bal.body.balance_kobo).toBe(FUND_KOBO);
    expect(Number.isInteger(bal.body.balance_kobo)).toBe(true);
    // NOTE: balance_naira is a documented float convenience field (display only).
    expect(bal.body.balance_naira).toBe(FUND_KOBO / 100);

    // ── BFF catch-all proxy → identical Go route ───────────────────────────
    const balBff = await bffFetch(request, '/api/finance/wallet/balance', { token });
    expect(balBff.status).toBe(200);
    expect(balBff.body.balance_kobo).toBe(FUND_KOBO);

    // ── Transaction list shows the funding journal leg ─────────────────────
    const txns = await goFetch(request, '/api/finance/wallet/transactions?limit=20', { token });
    expect(txns.status).toBe(200);
    const credit = (txns.body.transactions ?? []).find(
      (t: any) => t.reference === `e2e-${tag}` && t.type === 'credit',
    );
    expect(credit, 'funding credit leg missing from transaction list').toBeTruthy();
    expect(credit.amount_kobo).toBe(FUND_KOBO);
    expect(assertKoboIntegers(txns.body)).toEqual([]);

    // ── SQL cross-check: sum-of-entries == reported balance ────────────────
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO);
  });

  test('BFF /api/v1/wallet/balance is tier-1 gated and reads the same pot', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin001b');
    const token = await goTrueToken(request, user.email, user.password);
    fundWallet(user.userId, 250_000, `fin001b-${Date.now()}`);

    // Tier 0 → requireKycTier(1) refuses before the balance read.
    const tier0 = await bffFetch(request, '/api/v1/wallet/balance', { token });
    expect(tier0.status).toBe(403);

    // Tier 1 → same user_wallet pot, integer kobo.
    setKycTier(user.userId, 1);
    const tier1 = await bffFetch(request, '/api/v1/wallet/balance', { token });
    expect(tier1.status).toBe(200);
    expect(tier1.body.available_kobo).toBe(250_000);
    expect(Number.isInteger(tier1.body.available_kobo)).toBe(true);
  });
});
