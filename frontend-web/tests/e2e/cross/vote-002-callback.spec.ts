/**
 * VOTE-002 / AUD-FE-007 re-verification — /vote-callback contract.
 *
 * Original finding: the Paystack redirect page dropped the transactionId the
 * verify route needed. Current code (app/vote-callback/page.tsx) reads
 * `transactionId` off the redirect URL AND the verify route resolves it from
 * `payment_reference` when absent — this spec proves both seams live:
 *
 *   1. Browser: /vote-callback?reference=R&transactionId=T sends
 *      { transactionId: T, paymentReference: R } to /api/v2/votes/paid/verify.
 *   2. Browser: /vote-callback?trxref=R (no transactionId) still sends the
 *      request with the reference — server-side fallback resolves the tx.
 *   3. API: paymentReference-only POST against a KNOWN vote_transactions row
 *      resolves the row (not a "missing field" rejection), i.e. the fallback
 *      lookup executes before bridging.
 *   4. Browser: bare /vote-callback renders the missing-params state, no call.
 *
 * Paystack itself is not reachable locally (placeholder keys), so verify
 * success is not asserted — the CONTRACT and the fallback are.
 */

import { expect, test } from '@playwright/test';
import { provisionVerifiedUser, psql, setupVotableContest } from './helpers';

test.describe('VOTE-002: /vote-callback forwards transactionId + reference (AUD-FE-007)', () => {
  test('callback page posts transactionId + paymentReference to the verify route', async ({ page }) => {
    const txId = 'e2e-tx-0000-0000-000000000001';
    const ref = 'E2E-REF-AUDFE007-1';

    const sent = page.waitForRequest(
      (r) => r.url().includes('/api/v2/votes/paid/verify') && r.method() === 'POST',
    );
    await page.goto(`/vote-callback?reference=${ref}&transactionId=${txId}`);
    const req = await sent;
    const payload = req.postDataJSON() as { transactionId: string; paymentReference: string };
    expect(payload.paymentReference).toBe(ref);
    expect(payload.transactionId).toBe(txId); // ← the field AUD-FE-007 reported missing
  });

  test('trxref-only callback still submits — server resolves transactionId by reference', async ({
    page,
    request,
  }) => {
    // Fixture row the reference fallback can resolve (vote_transactions insert
    // is fixture setup — it models a pre-redirect pending row, not product state).
    const owner = await provisionVerifiedUser(request, 'x2-owner');
    const { contestId, contestantId } = await setupVotableContest(request, owner.userId, 'VOTE2');
    const ref = `E2E-REF-CB-${Date.now()}`;
    const seededTx = psql(
      `insert into vote_transactions (contest_id, contestant_id, voter_user_id, payment_provider, payment_reference, ` +
        `amount_expected, currency, votes_purchased, total_votes_to_credit, payment_status, vote_credit_status) ` +
        `values ('${contestId}','${contestantId}','${owner.userId}','paystack','${ref}',1000,'NGN',5,5,'pending','pending') returning id;`,
    ).split('\n')[0];
    expect(seededTx).toBeTruthy();

    // API-level: reference-only body resolves the row instead of 400'ing.
    const res = await request.fetch('/api/v2/votes/paid/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { paymentReference: ref },
    });
    const body = await res.json().catch(() => null);
    test.info().annotations.push({ type: 'ref-only', description: `${res.status()} ${JSON.stringify(body).slice(0, 300)}` });
    // Resolution proof, not just "not 400": with the row seeded, the fallback
    // finds it and the bridge reaches the PSP-verify step — which fails at 400
    // 'Payment verification failed' because Paystack is unreachable locally.
    // Had the fallback not run, transactionId='' → 'Transaction not found' 404.
    expect(res.status()).toBe(400);
    expect(body?.error ?? '').toMatch(/verification failed/i);

    // Browser-level: trxref alias produces the same POST shape.
    const sent = page.waitForRequest(
      (r) => r.url().includes('/api/v2/votes/paid/verify') && r.method() === 'POST',
    );
    await page.goto(`/vote-callback?trxref=${ref}`);
    const req = await sent;
    const payload = req.postDataJSON() as { transactionId: string; paymentReference: string };
    expect(payload.paymentReference).toBe(ref);
    expect(payload.transactionId).toBe(''); // no transactionId in URL — fallback path
  });

  test('bare /vote-callback renders missing-params and never calls verify', async ({ page }) => {
    let called = false;
    await page.route('**/api/v2/votes/paid/verify', () => { called = true; });
    await page.goto('/vote-callback');
    await expect(page.getByText('Missing Payment Reference')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(called).toBe(false);
  });
});
