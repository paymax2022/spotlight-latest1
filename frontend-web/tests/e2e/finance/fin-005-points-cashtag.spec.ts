/**
 * FIN-005 — points / loyalty / cashtag.
 *
 * Surfaces probed live:
 *   Points ledger   GET /api/finance/loyalty/points/{balance,history,catalog}
 *                   POST /api/finance/loyalty/points/redeem   (member API is
 *                   read/redeem only — earn rules are bound internally, there
 *                   is NO member-facing "earn" endpoint)
 *   Loyalty         GET /api/finance/loyalty/{me,tiers,rewards}
 *   Cashtag (social)POST /api/finance/social/social/handle          claim
 *                   GET  /api/finance/social/social/handle/me       own handle
 *                   GET  /api/finance/social/social/handle/:handle  resolve → user_id
 *                   POST /api/finance/social/social/send            transfer by tag
 *
 * The cashtag send is a REAL wallet→wallet transfer (DR sender → CR escrow →
 * DR escrow → CR recipient) — ledger legs asserted balanced and the replay
 * path verified.
 */

import { expect, test } from '@playwright/test';

import {
  assertKoboIntegers,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  setKycTier,
  walletBalanceSql,
} from './helpers';

const SEND_KOBO = 50_000; // ₦500

test.describe('FIN-005 points / loyalty / cashtag', () => {
  test('points + loyalty member surfaces respond; redeem refuses empty balance', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin005');
    const token = await goTrueToken(request, user.email, user.password);

    const bal = await goFetch(request, '/api/finance/loyalty/points/balance', { token });
    expect(bal.status).toBe(200);
    expect(bal.body.balance_points).toBe(0);

    const hist = await goFetch(request, '/api/finance/loyalty/points/history', { token });
    expect(hist.status).toBe(200);

    const cat = await goFetch(request, '/api/finance/loyalty/points/catalog', { token });
    expect(cat.status).toBe(200);
    expect((cat.body.items ?? []).length).toBeGreaterThan(0);
    expect(assertKoboIntegers(cat.body)).toEqual([]);

    // Redeem with 0 points → refused, never a negative balance. The
    // Idempotency-Key is required on every redeem (iron rule) — without it the
    // handler 400s before the balance check and this assertion would pass for
    // the wrong reason.
    const sku = cat.body.items[0].sku;
    const redeem = await goFetch(request, '/api/finance/loyalty/points/redeem', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('redeem') },
      data: { sku },
    });
    expect([400, 402, 409, 422]).toContain(redeem.status);
    const balAfter = await goFetch(request, '/api/finance/loyalty/points/balance', { token });
    expect(balAfter.body.balance_points).toBe(0);

    const me = await goFetch(request, '/api/finance/loyalty/me', { token });
    expect(me.status).toBe(200);
    const tiers = await goFetch(request, '/api/finance/loyalty/tiers', { token });
    expect(tiers.status).toBe(200);
    const rewards = await goFetch(request, '/api/finance/loyalty/rewards', { token });
    expect(rewards.status).toBe(200);
  });

  test('cashtag claim → resolve → transfer by tag posts balanced legs', async ({ request }) => {
    const sender = await provisionVerifiedUser(request, 'fin005a');
    const recipient = await provisionVerifiedUser(request, 'fin005b');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    const recipientToken = await goTrueToken(request, recipient.email, recipient.password);
    setKycTier(sender.userId, 1);
    fundWallet(sender.userId, 300_000, `fin005-${Date.now()}`);

    const handle = `fin005b${Date.now() % 1000000}`;

    // Recipient claims the tag; double-claim and a second user's claim refused.
    const claim = await goFetch(request, '/api/finance/social/social/handle', {
      method: 'POST',
      token: recipientToken,
      data: { handle },
    });
    expect(claim.status).toBe(201);
    const reclaim = await goFetch(request, '/api/finance/social/social/handle', {
      method: 'POST',
      token: recipientToken,
      data: { handle: `other${Date.now() % 1000000}` },
    });
    expect(reclaim.status).toBe(409); // already claimed
    const steal = await goFetch(request, '/api/finance/social/social/handle', {
      method: 'POST',
      token: senderToken,
      data: { handle },
    });
    expect(steal.status).toBe(409); // taken

    // Resolve → recipient's user id (directory lookup is member-visible).
    const resolved = await goFetch(request, `/api/finance/social/social/handle/${handle}`, { token: senderToken });
    expect(resolved.status).toBe(200);
    expect(resolved.body.user_id).toBe(recipient.userId);
    const mine = await goFetch(request, '/api/finance/social/social/handle/me', { token: recipientToken });
    expect(mine.status).toBe(200);

    // Missing Idempotency-Key → refused.
    const noKey = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      data: { handle, amount_kobo: SEND_KOBO },
    });
    expect([400, 401]).toContain(noKey.status);

    // Send by tag.
    const key = idemKey('tag');
    const send = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { handle, amount_kobo: SEND_KOBO, note: 'cashtag e2e' },
    });
    expect(send.status).toBe(200);
    expect(send.body.success).toBe(true);

    // Balanced: sender -amt, recipient +amt, escrow transit net-zero.
    const legs = ledgerSums(`p2p:${key}`);
    expect(legs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountType: 'user_wallet', accountUserId: sender.userId, side: 'DEBIT', total: SEND_KOBO }),
        expect.objectContaining({ accountType: 'user_wallet', accountUserId: recipient.userId, side: 'CREDIT', total: SEND_KOBO }),
      ]),
    );
    const escrowLegs = legs.filter((l) => l.accountType === 'escrow');
    expect(escrowLegs.reduce((s, l) => s + (l.side === 'CREDIT' ? l.total : -l.total), 0)).toBe(0);
    expect(walletBalanceSql(sender.userId)).toBe(300_000 - SEND_KOBO);
    expect(walletBalanceSql(recipient.userId)).toBe(SEND_KOBO);

    // Replay same key → same result, no second debit.
    const replay = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { handle, amount_kobo: SEND_KOBO, note: 'cashtag e2e' },
    });
    expect(replay.status).toBe(200);
    expect(walletBalanceSql(sender.userId)).toBe(300_000 - SEND_KOBO);

    // Unknown tag → refused.
    const unknown = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': idemKey('nope') },
      data: { handle: 'no-such-handle-zzz', amount_kobo: SEND_KOBO },
    });
    expect(unknown.status).toBe(404);
  });
});
