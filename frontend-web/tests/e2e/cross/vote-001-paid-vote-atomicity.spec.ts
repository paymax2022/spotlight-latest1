/**
 * VOTE-001 / AUD-DB-002 re-verification — paid-vote crediting atomicity.
 *
 * Original finding: a wallet/Paystack purchase could land
 * vote_transactions.vote_credit_status='credited' with NO votes row, and a
 * replay reported success without ever fulfilling the vote.
 *
 * What this spec verifies against the live stack:
 *   - v1 POST /api/votes/paid/wallet (the ONLY paid-vote money rail drivable
 *     locally — Paystack initialize+callback needs a reachable PSP):
 *       wallet debit (atomic RPC + tier gate) → vote_transactions insert
 *       (credited) → votes insert → totals → audit.
 *   - Replay under the SAME Idempotency-Key → alreadyProcessed, heals any
 *     missing votes row, never double-debits.
 *   - Insufficient funds → refusal leaves NO transaction/vote rows and an
 *     untouched balance.
 *   - No credited-but-empty transaction exists after the flow.
 *   - uq_votes_paid_transaction unique index exists (DB backstop).
 *   - v2 POST /api/v2/votes/wallet is probed — the remediated bridge route
 *     (assertKycTier + server-side quote + Go debit + creditWalletVotes) — and
 *     its reachability is recorded (schema/flag gates inspected at runtime).
 *
 * Fixture-only: wallet funding journal, kyc_tier, contestants roster row.
 */

import { expect, test } from '@playwright/test';
import {
  fundWallet,
  goTrueToken,
  provisionVerifiedUser,
  psql,
  setKycTier,
  setupVotableContest,
  walletBalance,
} from './helpers';

test.describe('VOTE-001: paid-vote crediting atomicity (AUD-DB-002 re-verify)', () => {
  test('wallet paid vote lands tx+votes atomically; replay heals; no stranded credit', async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const contestant = await provisionVerifiedUser(request, 'x1-act');
    const voter = await provisionVerifiedUser(request, 'x1-voter');
    const voterToken = await goTrueToken(request, voter.email, voter.password);
    const voterAuth = { Authorization: `Bearer ${voterToken}`, 'Content-Type': 'application/json' };

    const { contestId, contestantId, packageId } = await setupVotableContest(request, contestant.userId, 'VOTE1');

    setKycTier(voter.userId, 1);
    fundWallet(voter.userId, 500_000, `xv1-${Date.now()}`);
    expect(walletBalance(voter.userId)).toBe('500000');

    const key = `xv1-pay-${Date.now()}`;
    let txId = '';

    await test.step('paid wallet vote → one tx + one votes row + debit + audit', async () => {
      const res = await request.fetch('/api/votes/paid/wallet', {
        method: 'POST',
        headers: { ...voterAuth, 'Idempotency-Key': key },
        data: { contestId, contestantId, packageId, voterEmail: voter.email, voterName: 'E2E Voter' },
      });
      const body = await res.json().catch(() => null);
      test.info().annotations.push({ type: 'v1-wallet', description: `${res.status()} ${JSON.stringify(body).slice(0, 300)}` });
      expect(res.status(), JSON.stringify(body)).toBe(201);
      txId = body.transactionId;
      expect(body.votesCredited).toBe(12); // 10 + 2 bonus

      // Atomicity surface: tx row credited AND votes row present for it.
      expect(psql(`select payment_status || '|' || vote_credit_status from vote_transactions where id='${txId}';`))
        .toBe('successful|credited');
      expect(
        psql(`select vote_type || '|' || vote_quantity || '|' || vote_status from votes where transaction_id='${txId}';`),
      ).toBe('paid|12|confirmed');

      // Money: ₦1,000 (100,000 kobo) left the wallet exactly once.
      expect(walletBalance(voter.userId)).toBe('400000');
      const txCount = psql(`select count(*) from vote_transactions where idempotency_key is not null and voter_user_id='${voter.userId}';`);
      expect(txCount).toBe('1');

      // Totals advanced.
      const totals = psql(
        `select coalesce(paid_votes,0) || '|' || coalesce(bonus_votes,0) from vote_totals where contest_id='${contestId}' and contestant_id='${contestantId}';`,
      );
      expect(totals).toBe('10|2');
    });

    await test.step('replay with the same Idempotency-Key → alreadyProcessed, no double-fund', async () => {
      const replay = await request.fetch('/api/votes/paid/wallet', {
        method: 'POST',
        headers: { ...voterAuth, 'Idempotency-Key': key },
        data: { contestId, contestantId, packageId, voterEmail: voter.email, voterName: 'E2E Voter' },
      });
      const body = await replay.json().catch(() => null);
      test.info().annotations.push({ type: 'replay', description: `${replay.status()} ${JSON.stringify(body).slice(0, 300)}` });
      expect(replay.status()).toBe(200);
      expect(body.alreadyProcessed).toBe(true);
      expect(body.transactionId).toBe(txId);

      expect(psql(`select count(*) from votes where transaction_id='${txId}';`)).toBe('1');
      expect(walletBalance(voter.userId)).toBe('400000'); // no second debit
      const totals = psql(
        `select coalesce(paid_votes,0) + coalesce(bonus_votes,0) from vote_totals where contest_id='${contestId}' and contestant_id='${contestantId}';`,
      );
      expect(totals).toBe('12'); // totals not double-counted
    });

    await test.step('insufficient funds → refusal leaves nothing behind', async () => {
      const broke = await provisionVerifiedUser(request, 'x1-broke');
      const brokeToken = await goTrueToken(request, broke.email, broke.password);
      setKycTier(broke.userId, 1); // tier ok, balance 0

      const res = await request.fetch('/api/votes/paid/wallet', {
        method: 'POST',
        headers: { Authorization: `Bearer ${brokeToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': `xv1-broke-${Date.now()}` },
        data: { contestId, contestantId, packageId, voterEmail: broke.email, voterName: 'Broke Voter' },
      });
      const body = await res.json().catch(() => null);
      test.info().annotations.push({ type: 'broke', description: `${res.status()} ${JSON.stringify(body).slice(0, 200)}` });
      expect([402, 403]).toContain(res.status());
      expect(psql(`select count(*) from vote_transactions where voter_user_id='${broke.userId}';`)).toBe('0');
      expect(psql(`select count(*) from votes where voter_user_id='${broke.userId}';`)).toBe('0');
    });

    await test.step('no credited-without-votes transactions for this contest (AUD-DB-002 backstop)', async () => {
      const stranded = psql(
        `select count(*) from vote_transactions vt where vt.contest_id='${contestId}' ` +
          `and vt.vote_credit_status='credited' and not exists (select 1 from votes v where v.transaction_id=vt.id);`,
      );
      expect(stranded).toBe('0');
      // The unique index that makes the heal deterministic exists.
      const idx = psql(
        `select count(*) from pg_indexes where tablename='votes' and indexname='uq_votes_paid_transaction';`,
      );
      expect(idx).toBe('1');
    });

    await test.step('probe the v2 bridge wallet route (remediated path reachability)', async () => {
      const res = await request.fetch('/api/v2/votes/wallet', {
        method: 'POST',
        headers: voterAuth,
        data: { contestId, contestantId, voteCount: 2, idempotencyKey: `xv2-${Date.now()}` },
      });
      const body = await res.json().catch(() => null);
      // Documented outcome is asserted softly — the report carries the detail.
      // 403 = flag-gated; 404 = assertKycTier reads profiles.kyc_tier /
      // contestants.competition_id / competitions.* — none exist in the schema,
      // so the remediated bridge credit path is unreachable in this build.
      test.info().annotations.push({ type: 'v2-probe', description: `${res.status()} ${JSON.stringify(body).slice(0, 300)}` });
      expect([200, 400, 403, 404, 429, 503]).toContain(res.status());
      if (res.status() !== 200) {
        test.info().annotations.push({ type: 'finding', description: `v2 /api/v2/votes/wallet unreachable: ${res.status()}` });
      }
    });
  });
});
