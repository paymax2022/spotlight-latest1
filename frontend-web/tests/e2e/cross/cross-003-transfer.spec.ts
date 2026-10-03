/**
 * CROSS-003 — user→user money transfer (wallet-to-wallet / Paymax handle).
 *
 * Chains the real surfaces:
 *   - recipient discovery  GET /api/finance/transfers/paymax/resolve?phone=
 *     (NSN-normalised match on user_profiles.phone, masked-phone response)
 *   - transfer             POST /api/finance/transfers/paymax
 *     (idempotency-replay-first, tier guard, atomic pgx journal:
 *      DR sender / CR recipient (+ CR paymax_revenue fee when fee > 0))
 *   - balances             wallet projection over ledger_entries for BOTH users
 *   - recipient safety     B cannot spend funds it does not hold (402)
 *   - error vocabulary     self-transfer 422, unknown phone 404, ambiguous 409,
 *     insufficient 402, replay → 200 already_processed
 *
 * Fixture-only: wallet funding journal (Paystack top-up unreachable locally),
 * user_profiles.phone + kyc_tier rows (no local KYC provider). All money
 * movement goes through the real Go API.
 */

import { expect, test } from '@playwright/test';
import {
  fundWallet,
  goFetch,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
  setProfilePhone,
  walletBalance,
} from './helpers';

/** Unique 0-prefixed Nigerian mobile per run (NSN = last 10 digits). */
function phone(): string {
  return `080${String(Math.floor(10000000 + Math.random() * 89999999))}`;
}

test.describe('CROSS-003: wallet-to-wallet transfer between users', () => {
  test('resolve → transfer → ledger-consistent balances → replay/negative gates', async ({
    request,
  }) => {
    const sender = await provisionVerifiedUser(request, 'x-send');
    const receiver = await provisionVerifiedUser(request, 'x-recv');
    const senderToken = await goTrueToken(request, sender.email, sender.password);
    const receiverToken = await goTrueToken(request, receiver.email, receiver.password);

    const senderPhone = phone();
    const receiverPhone = phone();

    await test.step('fixture: phones resolvable + sender tier 1 + funded', () => {
      setProfilePhone(sender.userId, senderPhone);
      setProfilePhone(receiver.userId, receiverPhone);
      setKycTier(sender.userId, 1);
      setKycTier(receiver.userId, 1);
      fundWallet(sender.userId, 500_000, `xww-${Date.now()}`); // ₦5,000
      expect(walletBalance(sender.userId)).toBe('500000');
      // Never-funded wallet → no projection row yet; empty means 0.
      expect(Number(walletBalance(receiver.userId) || 0)).toBe(0);
    });

    await test.step('recipient resolution returns the right user, masked phone only', async () => {
      const res = await goFetch(request,
        `/api/finance/transfers/paymax/resolve?phone=${encodeURIComponent(receiverPhone)}`,
        { token: senderToken });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.user_id).toBe(receiver.userId);
      // Never the full number back.
      expect(res.body.masked_phone ?? '').not.toBe(receiverPhone);
      expect(JSON.stringify(res.body)).not.toContain(receiverPhone);

      // Unknown number → 404, not an empty 200.
      const miss = await goFetch(request, '/api/finance/transfers/paymax/resolve?phone=08000000001', { token: senderToken });
      expect(miss.status).toBe(404);
    });

    let reference = '';
    const key = `xww-pay-${Date.now()}`;

    await test.step('transfer ₦2,000 → balanced journal, both balances move', async () => {
      const res = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST',
        token: senderToken,
        data: { recipient_phone: receiverPhone, amount_kobo: 200_000, narration: 'E2E cross', idempotency_key: key },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.status).toBe('successful');
      expect(res.body.fee_kobo).toBe(0); // ≤ ₦5,000 is free
      reference = res.body.reference;
      expect(reference).toMatch(/^ww-/);

      expect(walletBalance(sender.userId)).toBe('300000');
      expect(walletBalance(receiver.userId)).toBe('200000');

      const legs = ledgerSums(reference);
      const dr = legs.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.total, 0);
      const cr = legs.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.total, 0);
      expect(dr).toBe(200_000);
      expect(dr).toBe(cr);

      // Durable transfer record.
      expect(psql(`select status || '|' || sender_id || '|' || receiver_id from wallet_transfers where idempotency_key='${key}';`))
        .toBe(`successful|${sender.userId}|${receiver.userId}`);
    });

    await test.step('idempotent replay: same key → 200 already_processed, no second debit', async () => {
      const replay = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST',
        token: senderToken,
        data: { recipient_phone: receiverPhone, amount_kobo: 200_000, idempotency_key: key },
      });
      expect(replay.status).toBe(200);
      expect(replay.body.already_processed).toBe(true);
      expect(psql(`select count(*) from wallet_transfers where idempotency_key='${key}';`)).toBe('1');
      expect(walletBalance(sender.userId)).toBe('300000');
      expect(walletBalance(receiver.userId)).toBe('200000');
    });

    await test.step('negative gates: self-transfer 422, over-balance 402, tier-0 403', async () => {
      const self = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST', token: senderToken,
        data: { recipient_phone: senderPhone, amount_kobo: 10_000, idempotency_key: `xww-self-${Date.now()}` },
      });
      expect(self.status).toBe(422);
      expect(self.body.code).toBe('self_transfer_not_allowed');

      const over = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST', token: senderToken,
        data: { recipient_phone: receiverPhone, amount_kobo: 999_999_900, idempotency_key: `xww-over-${Date.now()}` },
      });
      // Daily tier cap (₦50k/day tier-1) fires BEFORE the balance check in the
      // preflight order — either refusal is correct, both prove fail-closed.
      expect([402, 403]).toContain(over.status);
      expect(walletBalance(sender.userId)).toBe('300000');

      // Tier-0 sender is wallet-disabled — downgrade a fresh user and probe.
      const poor = await provisionVerifiedUser(request, 'x-poor');
      const poorToken = await goTrueToken(request, poor.email, poor.password);
      const denied = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST', token: poorToken,
        data: { recipient_phone: receiverPhone, amount_kobo: 1_000, idempotency_key: `xww-t0-${Date.now()}` },
      });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('wallet_disabled');
    });

    await test.step('recipient B can spend what it holds but not a kobo more', async () => {
      const tooMuch = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST', token: receiverToken,
        data: { recipient_phone: senderPhone, amount_kobo: 200_001, idempotency_key: `xww-b1-${Date.now()}` },
      });
      expect(tooMuch.status).toBe(402);
      expect(tooMuch.body.code).toBe('insufficient_funds');
      expect(walletBalance(receiver.userId)).toBe('200000');

      // And a real B→A send proves the received funds are spendable.
      const back = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST', token: receiverToken,
        data: { recipient_phone: senderPhone, amount_kobo: 50_000, idempotency_key: `xww-b2-${Date.now()}` },
      });
      expect(back.status, JSON.stringify(back.body)).toBe(201);
      expect(walletBalance(receiver.userId)).toBe('150000');
      expect(walletBalance(sender.userId)).toBe('350000');
    });

    await test.step('ambiguous recipient → 409 (refuse, never guess)', async () => {
      const dup = await provisionVerifiedUser(request, 'x-dup');
      setProfilePhone(dup.userId, receiverPhone); // second profile with B's number
      const res = await goFetch(request,
        `/api/finance/transfers/paymax/resolve?phone=${encodeURIComponent(receiverPhone)}`,
        { token: senderToken });
      expect(res.status).toBe(409);
    });
  });
});
