/**
 * FIN-003 — tiers & limits.
 *
 * Tier model (backend/internal/finance/tiers/service.go):
 *   Tier0 → wallet DISABLED for cash-out (EnforceWalletDebitLimit → 403
 *           wallet_disabled); Tier1 → ₦50,000/day debit cap
 *           (5,000,000 kobo); Tier3 → unlimited. The check is fail-closed:
 *           a tier-lookup error refuses the debit (code-level note in results).
 *
 * Journey: funded Tier-0 sender attempts a P2P transfer → 403. Raised to
 * Tier-1 → same transfer succeeds. A transfer over the Tier-1 daily cap →
 * 403 daily_limit_exceeded.
 *
 * Bypass probe: the SAME Tier-0 wallet is then driven through the social
 * cashtag send and the savings vault deposit — sibling money rails that move
 * the same kobo. Whatever they answer is recorded verbatim; the verdict and
 * the severity live in results/finance.md.
 *
 * Fixture-only: funding journal, kyc_tier, recipient phone via psql.
 */

import { expect, test } from '@playwright/test';

import {
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

const SEND_KOBO = 100_000; // ₦1,000 — under the free-fee band (fee = 0)

test.describe('FIN-003 tiers & limits', () => {
  test('tier 0 transfer → 403; tier 1 → allowed; over daily cap → 403', async ({ request }) => {
    const sender = await provisionVerifiedUser(request, 'fin003a');
    const recipient = await provisionVerifiedUser(request, 'fin003b');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    const phone = uniquePhone();
    setProfilePhone(recipient.userId, phone);
    fundWallet(sender.userId, 500_000, `fin003-${Date.now()}`);

    // ── Tier 0 (default for provisioned users): wallet disabled ───────────
    setKycTier(sender.userId, 0);
    const blocked = await goFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('t0') },
      data: { recipient_phone: phone, amount_kobo: SEND_KOBO },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('wallet_disabled');
    expect(walletBalanceSql(sender.userId)).toBe(500_000); // nothing moved

    // ── Tier 1: same transfer succeeds ─────────────────────────────────────
    setKycTier(sender.userId, 1);
    const allowed = await goFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('t1') },
      data: { recipient_phone: phone, amount_kobo: SEND_KOBO },
    });
    expect(allowed.status).toBe(201);
    expect(allowed.body.status).toBe('successful');
    expect(allowed.body.fee_kobo).toBe(0); // ≤ ₦5,000 is free
    expect(walletBalanceSql(sender.userId)).toBe(500_000 - SEND_KOBO);
    expect(walletBalanceSql(recipient.userId)).toBe(SEND_KOBO);

    // ── Over the Tier-1 daily cap (₦50,000 = 5,000,000 kobo) → 403 ────────
    const over = await goFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('cap') },
      data: { recipient_phone: phone, amount_kobo: 5_100_000 },
    });
    expect(over.status).toBe(403);
    expect(over.body.code).toBe('daily_limit_exceeded');
    expect(walletBalanceSql(sender.userId)).toBe(500_000 - SEND_KOBO);
  });

  test('PROBE: does the tier-0 gate hold on sibling money rails?', async ({ request }) => {
    // A Tier-0 wallet cannot SEND via /api/finance/transfers — but sibling
    // rails (social cashtag send, savings vault deposit) move the same kobo
    // through ledger.Debit directly. This test RECORDS what they answer;
    // results/finance.md carries the verdict.
    const sender = await provisionVerifiedUser(request, 'fin003c');
    const recipient = await provisionVerifiedUser(request, 'fin003d');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    const recipientToken = await goTrueToken(request, recipient.email, recipient.password);
    const phone = uniquePhone();
    setProfilePhone(recipient.userId, phone);
    fundWallet(sender.userId, 500_000, `fin003bypass-${Date.now()}`);
    setKycTier(sender.userId, 0);

    // Recipient claims a cashtag so social send can address them.
    const claim = await goFetch(request, '/api/finance/social/social/handle', {
      method: 'POST',
      token: recipientToken,
      data: { handle: `fin003d${Date.now() % 100000}` },
    });
    expect(claim.status).toBe(201);
    const handle = claim.body?.handle?.handle ?? claim.body?.handle?.tag;
    expect(handle).toBeTruthy();

    // Social P2P send as Tier 0 — is the tier gate enforced here?
    const social = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('s0') },
      data: { handle, amount_kobo: SEND_KOBO, note: 'tier0 probe' },
    });
    test.info().annotations.push({
      type: 'observation',
      description: `Tier-0 social send → ${social.status} ${JSON.stringify(social.body)}`,
    });

    // Savings vault deposit as Tier 0 — same question.
    const vault = await goFetch(request, '/api/finance/savings/vaults', {
      method: 'POST',
      token: senderToken,
      data: { name: 'Tier0 probe', kind: 'FLEX' },
    });
    expect(vault.status).toBe(201);
    const dep = await goFetch(request, `/api/finance/savings/vaults/${vault.body.vault.id}/deposit`, {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('d0') },
      data: { amount_kobo: SEND_KOBO },
    });
    test.info().annotations.push({
      type: 'observation',
      description: `Tier-0 savings deposit → ${dep.status} ${JSON.stringify(dep.body)}`,
    });

    // Hard assertions only on what the contract guarantees: the canonical
    // transfer rail stays refused for this same wallet.
    const canon = await goFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('canon0') },
      data: { recipient_phone: phone, amount_kobo: SEND_KOBO },
    });
    expect(canon.status).toBe(403);
  });
});
