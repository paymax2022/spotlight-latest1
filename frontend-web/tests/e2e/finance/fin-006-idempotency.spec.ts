/**
 * FIN-006 — idempotency under retry.
 *
 * Replays the SAME Idempotency-Key money mutation twice on each rail and
 * asserts the second call cannot double-debit:
 *   - POST /api/finance/transfers/paymax  → 201 first; 200 already_processed
 *     on replay; exactly one ledger journal pair for the key.
 *   - POST /api/finance/savings/vaults/:id/deposit → first posts wallet→escrow;
 *     replay must NOT post a second leg (response semantics recorded verbatim).
 *   - POST /api/finance/social/social/send → replay returns the recorded payment, no
 *     second debit.
 *   - BFF parity: the catch-all proxy must forward Idempotency-Key verbatim —
 *     proven by replaying a transfer key THROUGH :3000 and still seeing
 *     already_processed.
 *
 * Ledger-row uniqueness is asserted in SQL (count of legs per derived key).
 */

import { expect, test } from '@playwright/test';

import {
  bffFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  provisionVerifiedUser,
  psql,
  setKycTier,
  setProfilePhone,
  uniquePhone,
  walletBalanceSql,
} from './helpers';

const SEND_KOBO = 200_000; // ₦2,000 — free-fee band

function legCount(idemKeyLike: string): number {
  return Number(
    psql(
      `select count(*) from ledger_entries where idempotency_key like '${idemKeyLike}';`,
    ) || '0',
  );
}

test.describe('FIN-006 idempotency under retry', () => {
  test('wallet transfer replay → already_processed, single journal', async ({ request }) => {
    const sender = await provisionVerifiedUser(request, 'fin006a');
    const recipient = await provisionVerifiedUser(request, 'fin006b');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    setKycTier(sender.userId, 1);
    const phone = uniquePhone();
    setProfilePhone(recipient.userId, phone);
    fundWallet(sender.userId, 500_000, `fin006-${Date.now()}`);

    const key = idemKey('xfer');
    const first = await goFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { recipient_phone: phone, amount_kobo: SEND_KOBO, narration: 'first' },
    });
    expect(first.status).toBe(201);
    expect(first.body.already_processed).toBeFalsy();
    const ref = first.body.reference as string;
    expect(ref).toBeTruthy();

    // Replay: same key, same body → prior result, not a second debit.
    const replay = await goFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { recipient_phone: phone, amount_kobo: SEND_KOBO, narration: 'first' },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.already_processed).toBe(true);
    expect(replay.body.reference).toBe(ref);

    // BFF parity: same key through :3000 also replays (proxy forwards the key).
    const replayBff = await bffFetch(request, '/api/finance/transfers/paymax', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { recipient_phone: phone, amount_kobo: SEND_KOBO },
    });
    expect(replayBff.status).toBe(200);
    expect(replayBff.body.already_processed).toBe(true);

    // Exactly one journal for the key: :debit + :credit legs (fee=0 → no :fee leg).
    expect(legCount(`${key}:%`)).toBe(2);
    expect(walletBalanceSql(sender.userId)).toBe(500_000 - SEND_KOBO);
    expect(walletBalanceSql(recipient.userId)).toBe(SEND_KOBO);
  });

  test('savings deposit replay → no second ledger leg', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'fin006c');
    const token = await goTrueToken(request, user.email, user.password);
    setKycTier(user.userId, 1);
    fundWallet(user.userId, 500_000, `fin006s-${Date.now()}`);

    const vault = await goFetch(request, '/api/finance/savings/vaults', {
      method: 'POST',
      token,
      data: { name: 'E2E idem', kind: 'FLEX' },
    });
    const vaultId = vault.body?.vault?.id;

    const key = idemKey('svdep');
    const first = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { amount_kobo: SEND_KOBO },
    });
    expect(first.status).toBe(200);
    expect(first.body.balance_kobo).toBe(SEND_KOBO);

    const replay = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/deposit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { amount_kobo: SEND_KOBO },
    });
    // Response semantics recorded — the HARD invariant is no second leg.
    test.info().annotations.push({
      type: 'observation',
      description: `savings deposit replay → ${replay.status} ${JSON.stringify(replay.body)}`,
    });
    expect(legCount(`${key}:%`)).toBe(2); // :wallet ledger pair …
    const vaultRows = psql(
      `select count(*) from savings_vault_ledger where idempotency_key like '${key}:%';`,
    );
    expect(Number(vaultRows)).toBe(1); // … and one vault sub-ledger row
    expect(walletBalanceSql(user.userId)).toBe(500_000 - SEND_KOBO);

    const bal = await goFetch(request, `/api/finance/savings/vaults/${vaultId}/balance`, { token });
    expect(bal.body.balance_kobo).toBe(SEND_KOBO);
  });

  test('social send replay → recorded payment, single debit', async ({ request }) => {
    const sender = await provisionVerifiedUser(request, 'fin006d');
    const recipient = await provisionVerifiedUser(request, 'fin006e');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    const recipientToken = await goTrueToken(request, recipient.email, recipient.password);
    setKycTier(sender.userId, 1);
    fundWallet(sender.userId, 500_000, `fin006so-${Date.now()}`);

    const handle = `fin006e${Date.now() % 1000000}`;
    const claim = await goFetch(request, '/api/finance/social/social/handle', {
      method: 'POST',
      token: recipientToken,
      data: { handle },
    });
    expect(claim.status).toBe(201);

    const key = idemKey('social');
    const first = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { handle, amount_kobo: SEND_KOBO },
    });
    expect(first.status).toBe(200);
    const paymentId = first.body?.payment?.id ?? first.body?.id;

    const replay = await goFetch(request, '/api/finance/social/social/send', {
      method: 'POST',
      token: senderToken,
      headers: { 'Idempotency-Key': key },
      data: { handle, amount_kobo: SEND_KOBO },
    });
    expect(replay.status).toBe(200);
    const replayId = replay.body?.payment?.id ?? replay.body?.id;
    if (paymentId) expect(replayId).toBe(paymentId);

    // Two balanced journals: K:dr:{debit,credit} (wallet→escrow) and
    // K:cr:{debit,credit} (escrow→recipient) — 4 rows, no duplication on replay.
    expect(legCount(`${key}:%`)).toBe(4);
    expect(walletBalanceSql(sender.userId)).toBe(500_000 - SEND_KOBO);
    expect(walletBalanceSql(recipient.userId)).toBe(SEND_KOBO);
  });
});
