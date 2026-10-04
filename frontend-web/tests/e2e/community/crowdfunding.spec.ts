/**
 * CROWDFUNDING — create → review → publish → contribute → withdraw → refund.
 * Mounts: :8080/api/finance/crowdfunding/* (member+admin-ext reads),
 *         :8080/api/crowdfunding/admin/* (RBAC-gated admin console).
 *
 * Money invariants proven live:
 *   - contribute requires an idempotency key (body `idempotency_key`), is
 *     replay-safe, and posts balanced escrow legs;
 *   - a tier-0 contributor is refused (403) with ZERO ledger legs;
 *   - instant-settle credits the creator exactly 90% (platform fee 10%);
 *   - creator withdrawal posts a balanced DEBIT creator → CREDIT clearing and
 *     replays idempotently;
 *   - contributor refund-requests reach the admin refund queue, and an
 *     admin approval posts the clawback legs (DR creator 90% + DR
 *     paymax_revenue 10% / CR backer gross) — E2E-COM-001/004 fixed;
 */

import { test, expect } from '@playwright/test';
import {
  goFetch,
  adminCommunityGo,
  provisionVerifiedUser,
  goTrueToken,
  fundWallet,
  setKycVerified,
  assertKoboIntegers,
  walletBalanceSql,
  countLegsByRef,
  ledgerTotalsByRef,
  seedCfBankAccount,
  idemKey,
  psql,
} from './helpers';

const CF = '/api/finance/crowdfunding';
const CF_ADMIN = '/api/crowdfunding/admin';
const GOAL_KOBO = 150_000; // below CONTRIB so the campaign reaches 'funded'
const CONTRIB_KOBO = 200_000;

const IDEM = (k: string) => ({ 'Idempotency-Key': k });

async function createCampaign(
  request: Parameters<typeof goFetch>[0],
  token: string,
  title: string,
): Promise<string> {
  const res = await goFetch(request, `${CF}/campaigns`, {
    method: 'POST',
    token,
    data: {
      type: 'community',
      category: 'medical',
      title,
      summary: 'e2e community-finance campaign',
      story: 'A test campaign funded by the e2e suite.',
      goalKobo: GOAL_KOBO,
      deadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      submitForReview: true,
    },
  });
  expect(res.status).toBe(201);
  const id = res.body?.data?.campaignId ?? res.body?.campaignId ?? res.body?.data?.id ?? res.body?.id;
  expect(id, JSON.stringify(res.body)).toBeTruthy();
  return id;
}

/** create → publish → admin APPROVE so the campaign accepts contributions. */
async function createApprovedCampaign(
  request: Parameters<typeof goFetch>[0],
  creatorToken: string,
  title: string,
): Promise<string> {
  const id = await createCampaign(request, creatorToken, title);
  const publish = await goFetch(request, `${CF}/campaigns/${id}/publish`, {
    method: 'POST',
    token: creatorToken,
  });
  expect(publish.status).toBe(200);
  const decide = await adminCommunityGo(request, `${CF_ADMIN}/campaigns/${id}/decision`, {
    method: 'POST',
    data: { decision: 'APPROVE', note: 'e2e approval' },
  });
  expect(decide.status).toBe(200);
  return id;
}

test.describe('crowdfunding money journey', () => {
  test('contribute → instant settle (90/10) → withdrawal → refund-request; tier-0 refused zero legs', async ({
    request,
  }) => {
    const creator = await provisionVerifiedUser(request, 'cf-creator');
    const creatorToken = await goTrueToken(request, creator.email, creator.password);
    setKycVerified(creator.userId, 3);

    const backer = await provisionVerifiedUser(request, 'cf-backer');
    const backerToken = await goTrueToken(request, backer.email, backer.password);
    setKycVerified(backer.userId, 3);
    fundWallet(backer.userId, 5_000_000, `cf-b-${backer.userId}`);

    const poor = await provisionVerifiedUser(request, 'cf-poor');
    const poorToken = await goTrueToken(request, poor.email, poor.password);
    fundWallet(poor.userId, 5_000_000, `cf-p-${poor.userId}`); // funded but kyc_tier=0

    // ── Create → publish → admin review queue → approve ─────────────────────
    const campaignId = await createCampaign(request, creatorToken, `E2E CF ${Date.now()}`);

    const queue = await adminCommunityGo(request, `${CF_ADMIN}/campaigns?status=PENDING_REVIEW`);
    expect(queue.status).toBe(200);
    const adminDetail = await adminCommunityGo(request, `${CF_ADMIN}/campaigns/${campaignId}`);
    expect(adminDetail.status).toBe(200);

    const publish = await goFetch(request, `${CF}/campaigns/${campaignId}/publish`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(publish.status).toBe(200);
    const approve = await adminCommunityGo(request, `${CF_ADMIN}/campaigns/${campaignId}/decision`, {
      method: 'POST',
      data: { decision: 'APPROVE', note: 'e2e' },
    });
    expect(approve.status).toBe(200);

    const detail = await goFetch(request, `${CF}/campaigns/${campaignId}`, { token: creatorToken });
    expect(detail.status).toBe(200);
    expect(assertKoboIntegers(detail.body)).toEqual([]);
    const list = await goFetch(request, `${CF}/campaigns`, { token: creatorToken });
    expect(list.status).toBe(200);
    const cats = await goFetch(request, `${CF}/categories`, { token: creatorToken });
    expect(cats.status).toBe(200);

    // ── Tier-0 refusal: 403 and ZERO ledger legs ────────────────────────────
    // Ledger refs are escrow:/settle:-prefixed (escrow:campaign:... plus
    // settle:campaign:...:provider and :commission legs).
    const poorRef = `%campaign:${campaignId}:contributor:${poor.userId}%`;
    const refuse = await goFetch(request, `${CF}/campaigns/${campaignId}/contribute`, {
      method: 'POST',
      token: poorToken,
      data: { amount_kobo: CONTRIB_KOBO, idempotency_key: idemKey('cf-poor') },
    });
    expect(refuse.status).toBe(403);
    expect(countLegsByRef(poorRef)).toBe(0);
    expect(psql(`select count(*) from contributions where contributor_id='${poor.userId}'`)).toBe('0');

    // ── Contribute (idempotent) → escrow legs balanced ──────────────────────
    const contribIdem = idemKey('cf-contrib');
    const backerBefore = walletBalanceSql(backer.userId);
    const contrib = await goFetch(request, `${CF}/campaigns/${campaignId}/contribute`, {
      method: 'POST',
      token: backerToken,
      headers: IDEM(contribIdem),
      data: { amount_kobo: CONTRIB_KOBO, idempotency_key: contribIdem },
    });
    expect(contrib.status).toBe(201);
    const contributionId = contrib.body?.id ?? contrib.body?.data?.id;
    expect(contributionId).toBeTruthy();

    const replay = await goFetch(request, `${CF}/campaigns/${campaignId}/contribute`, {
      method: 'POST',
      token: backerToken,
      headers: IDEM(contribIdem),
      data: { amount_kobo: CONTRIB_KOBO, idempotency_key: contribIdem },
    });
    expect([200, 201]).toContain(replay.status);
    expect(replay.body?.id ?? replay.body?.data?.id).toBe(contributionId);

    // Escrow legs: DR wallet / CR escrow under `escrow:` ref (contribution).
    const escrowLegs = ledgerTotalsByRef(`escrow:campaign:${campaignId}:contributor:${backer.userId}`);
    expect(escrowLegs.debits).toBe(CONTRIB_KOBO);
    expect(escrowLegs.credits).toBe(CONTRIB_KOBO);
    // Settle legs: DR escrow / CR creator + platform fee under `settle:` ref.
    const settleLegs = ledgerTotalsByRef(`settle:campaign:${campaignId}:contributor:${backer.userId}%`);
    expect(settleLegs.debits).toBe(CONTRIB_KOBO);
    expect(settleLegs.credits).toBe(CONTRIB_KOBO);
    expect(walletBalanceSql(backer.userId)).toBe(backerBefore - CONTRIB_KOBO);

    // Instant settle: creator wallet credited exactly 90% (10% platform fee).
    expect(walletBalanceSql(creator.userId)).toBe((CONTRIB_KOBO * 90) / 100);

    // ── Campaign wallet + projected ledger + creator surfaces ───────────────
    const bankId = seedCfBankAccount(creator.userId, 'creator');
    const banks = await goFetch(request, `${CF}/bank-accounts`, { token: creatorToken });
    expect(banks.status).toBe(200);

    const wallet = await goFetch(request, `${CF}/campaigns/${campaignId}/wallet`, {
      token: creatorToken,
    });
    expect(wallet.status).toBe(200);
    expect(assertKoboIntegers(wallet.body)).toEqual([]);
    expect(wallet.body.availableKobo ?? wallet.body.data?.availableKobo).toBeGreaterThanOrEqual(
      (CONTRIB_KOBO * 90) / 100,
    );

    const proj = await goFetch(request, `${CF}/campaigns/${campaignId}/ledger`, {
      token: creatorToken,
    });
    expect(proj.status).toBe(200);
    const entries = proj.body?.data ?? proj.body ?? [];
    expect(entries.length).toBeGreaterThan(0);
    const entryId = entries[0]?.id;
    if (entryId) {
      const one = await goFetch(request, `${CF}/ledger/${entryId}`, { token: creatorToken });
      expect(one.status).toBe(200);
    }

    // ── Withdrawal: balanced payout to clearing, idempotent replay ──────────
    const wdIdem = idemKey('cf-wd');
    const wd = await goFetch(request, `${CF}/campaigns/${campaignId}/withdrawal-request`, {
      method: 'POST',
      token: creatorToken,
      headers: IDEM(wdIdem),
      data: { amountKobo: 100_000, bankAccountId: bankId, reason: 'e2e withdrawal' },
    });
    expect([200, 201]).toContain(wd.status);
    expect(wd.body.status).toBe('COMPLETED');
    const wdRef = wd.body.reference;
    expect(wdRef).toMatch(/^SPL-CFWD-/);

    const wdLegs = ledgerTotalsByRef(`cf:withdraw:${wdRef}`);
    expect(wdLegs.debits).toBe(100_000);
    expect(wdLegs.credits).toBe(100_000);
    expect(walletBalanceSql(creator.userId)).toBe((CONTRIB_KOBO * 90) / 100 - 100_000);

    const wdReplay = await goFetch(request, `${CF}/campaigns/${campaignId}/withdrawal-request`, {
      method: 'POST',
      token: creatorToken,
      headers: IDEM(wdIdem),
      data: { amountKobo: 100_000, bankAccountId: bankId, reason: 'e2e withdrawal' },
    });
    expect([200, 201]).toContain(wdReplay.status);
    expect(wdReplay.body.id).toBe(wd.body.id);
    expect(ledgerTotalsByRef(`cf:withdraw:${wdRef}`).debits).toBe(100_000); // no extra legs

    const creatorWithdrawals = await goFetch(request, `${CF}/creator/withdrawals`, {
      token: creatorToken,
    });
    expect(creatorWithdrawals.status).toBe(200);

    // ── Contributor surfaces + refund-request → admin queue (E2E-COM-001) ───
    const myContribs = await goFetch(request, `${CF}/contributions`, { token: backerToken });
    expect(myContribs.status).toBe(200);
    const mine = await goFetch(request, `${CF}/contributions/${contributionId}`, {
      token: backerToken,
    });
    expect(mine.status).toBe(200);

    const rr = await goFetch(request, `${CF}/contributions/${contributionId}/refund-request`, {
      method: 'POST',
      token: backerToken,
      data: { reason: 'e2e refund request' },
    });
    expect(rr.status).toBe(200);
    expect(psql(`select status from cf_refund_requests where contribution_id='${contributionId}'`))
      .toBe('REFUND_REQUESTED');

    // Someone else's contribution reads as 404 (ownership-scoped lookup).
    const foreign = await goFetch(request, `${CF}/contributions/${contributionId}/refund-request`, {
      method: 'POST',
      token: creatorToken,
      data: { reason: 'not mine' },
    });
    expect(foreign.status).toBe(404);

    // E2E-COM-001 FIXED: the admin refund queue unions the live
    // cf_refund_requests rows — the member's request reaches ops (the queue
    // row's id IS the request id; cf_refunds rows never carry one).
    const refundRequestId = psql(
      `select id from cf_refund_requests where contribution_id='${contributionId}'`,
    );
    const adminRefunds = await adminCommunityGo(request, `${CF_ADMIN}/refunds`);
    expect(adminRefunds.status).toBe(200);
    const refundRows = JSON.stringify(adminRefunds.body);
    expect(refundRows).toContain(refundRequestId);

    // A REJECT decision writes no money: request flips to REJECTED, the
    // contribution stays 'released', and no refund legs appear.
    const reject = await adminCommunityGo(request, `${CF_ADMIN}/refunds/${refundRequestId}/reject`, {
      method: 'POST',
      data: { note: 'e2e reject' },
    });
    expect(reject.status).toBe(200);
    expect(psql(`select status from cf_refund_requests where id='${refundRequestId}'`)).toBe(
      'REJECTED',
    );
    expect(psql(`select status from contributions where id='${contributionId}'`)).toBe('released');
    expect(countLegsByRef(`cf:refund:${contributionId}%`)).toBe(0);

    // E2E-COM-004 FIXED — the full member→admin PAYOUT journey on a second
    // campaign: contribute (instant-settles) → member refund-request →
    // admin APPROVE → the clawback makes the backer whole at gross.
    const refundCampaign = await createApprovedCampaign(
      request,
      creatorToken,
      `E2E Refund ${Date.now()}`,
    );
    const backerAtRefund = walletBalanceSql(backer.userId);
    const give2 = await goFetch(request, `${CF}/campaigns/${refundCampaign}/contribute`, {
      method: 'POST',
      token: backerToken,
      headers: IDEM(idemKey('cf-refund-contrib')),
      data: { amount_kobo: 100_000, idempotency_key: idemKey('cf-refund-contrib') },
    });
    expect(give2.status).toBe(201);
    const contrib2Id = give2.body?.id ?? give2.body?.data?.id;
    const rr2 = await goFetch(request, `${CF}/contributions/${contrib2Id}/refund-request`, {
      method: 'POST',
      token: backerToken,
      data: { reason: 'e2e approve journey' },
    });
    expect(rr2.status).toBe(200);
    const refundRequest2 = psql(
      `select id from cf_refund_requests where contribution_id='${contrib2Id}'`,
    );

    const refundApprove = await adminCommunityGo(
      request,
      `${CF_ADMIN}/refunds/${refundRequest2}/approve`,
      { method: 'POST', data: { note: 'e2e approve' } },
    );
    expect(refundApprove.status).toBe(200);

    // Money actually moved: the gross is back in the backer's wallet and the
    // reversal legs balance (DR creator 90k + DR paymax_revenue 10k / CR
    // backer 100k).
    expect(walletBalanceSql(backer.userId)).toBe(backerAtRefund);
    const refundLegs = ledgerTotalsByRef(`cf:refund:${contrib2Id}%`);
    expect(refundLegs.debits).toBe(100_000);
    expect(refundLegs.credits).toBe(100_000);
    expect(psql(`select status from cf_refund_requests where id='${refundRequest2}'`)).toBe(
      'REFUNDED',
    );
    expect(psql(`select status from contributions where id='${contrib2Id}'`)).toBe('refunded');

    // ── Release on the funded campaign: instant-settle already released the
    // contribution, so the sweep is a documented no-op. RefundAll is refused
    // on a funded campaign by design. ────────────────────────────────────────
    const release = await goFetch(request, `${CF}/campaigns/${campaignId}/release`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(release.status).toBe(200);
    expect(release.body.releasedCount).toBe(0); // already settled at contribute-time
    const refundAll = await goFetch(request, `${CF}/campaigns/${campaignId}/refund`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(refundAll.status).toBe(400); // "cannot refund a funded campaign"

    // A second, contribution-free campaign exercises the refund route's real
    // path: zero escrowed rows → refundedCount 0 and the campaign is 'failed'.
    const emptyId = await createApprovedCampaign(request, creatorToken, `E2E Empty ${Date.now()}`);
    const emptyRefund = await goFetch(request, `${CF}/campaigns/${emptyId}/refund`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(emptyRefund.status).toBe(200);
    expect(emptyRefund.body.refundedCount).toBe(0);
    expect(psql(`select status from campaigns where id='${emptyId}'`)).toBe('failed');

    // ── Admin surface (review + extension reads) ────────────────────────────
    const adminReads = [
      `${CF_ADMIN}/stats`,
      `${CF_ADMIN}/finance/summary`,
      `${CF_ADMIN}/settlements`,
      `${CF_ADMIN}/disputes`,
      `${CF_ADMIN}/withdrawals`,
      `${CF_ADMIN}/campaign-directory`,
      `${CF_ADMIN}/campaigns/${campaignId}/backers`,
      `${CF_ADMIN}/campaigns/${campaignId}/funding`,
      `${CF_ADMIN}/feature-requests`,
      `${CF_ADMIN}/fraud-alerts`,
      `${CF_ADMIN}/kyc`,
      `${CF_ADMIN}/compliance/summary`,
      `${CF_ADMIN}/compliance/audit-logs`,
      `${CF_ADMIN}/users`,
      `${CF_ADMIN}/config/categories`,
      `${CF_ADMIN}/config/fees`,
      `${CF_ADMIN}/config/flags`,
    ];
    for (const p of adminReads) {
      const r = await adminCommunityGo(request, p);
      expect(r.status, `admin GET ${p}`).toBe(200);
    }

    // RBAC: a plain member cannot read the admin console.
    const memberAdmin = await goFetch(request, `${CF_ADMIN}/stats`, { token: backerToken });
    expect(memberAdmin.status).toBe(403);
  });

  test('engagement surface: comments, updates, docs, broadcast, tickets, prefs; pause stops money', async ({
    request,
  }) => {
    const creator = await provisionVerifiedUser(request, 'cf-eng-creator');
    const creatorToken = await goTrueToken(request, creator.email, creator.password);
    setKycVerified(creator.userId, 3);
    const fan = await provisionVerifiedUser(request, 'cf-fan');
    const fanToken = await goTrueToken(request, fan.email, fan.password);
    setKycVerified(fan.userId, 3);
    fundWallet(fan.userId, 1_000_000, `cf-fan-${fan.userId}`);

    const campaignId = await createApprovedCampaign(request, creatorToken, `E2E Engage ${Date.now()}`);

    // Comments + creator reply + report.
    const comment = await goFetch(request, `${CF}/campaigns/${campaignId}/comments`, {
      method: 'POST',
      token: fanToken,
      data: { body: 'Is this still running?', isQuestion: true },
    });
    expect(comment.status).toBe(201);
    const commentId = comment.body?.data?.id ?? comment.body?.id;
    const reply = await goFetch(request, `${CF}/comments/${commentId}/reply`, {
      method: 'POST',
      token: creatorToken,
      data: { body: 'Yes — ends next month.' },
    });
    expect(reply.status).toBe(201);
    const report = await goFetch(request, `${CF}/comments/${commentId}/report`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(report.status).toBe(200);
    const comments = await goFetch(request, `${CF}/campaigns/${campaignId}/comments`, {
      token: fanToken,
    });
    expect(comments.status).toBe(200);

    // Creator update → list → fan likes it.
    const upd = await goFetch(request, `${CF}/campaigns/${campaignId}/updates`, {
      method: 'POST',
      token: creatorToken,
      data: { title: 'Halfway there', body: 'Thank you all for backing this campaign.' },
    });
    expect(upd.status).toBe(201);
    const updateId = upd.body?.data?.id ?? upd.body?.id;
    const updates = await goFetch(request, `${CF}/campaigns/${campaignId}/updates`, {
      token: fanToken,
    });
    expect(updates.status).toBe(200);
    const like = await goFetch(request, `${CF}/updates/${updateId}/like`, {
      method: 'POST',
      token: fanToken,
    });
    expect(like.status).toBe(200);

    // Analytics events + document attach + broadcast to backers.
    for (const type of ['VIEW', 'SHARE']) {
      const ev = await goFetch(request, `${CF}/campaigns/${campaignId}/events`, {
        method: 'POST',
        token: fanToken,
        data: { type, source: 'direct' },
      });
      expect(ev.status).toBe(200);
    }
    const doc = await goFetch(request, `${CF}/campaigns/${campaignId}/documents`, {
      method: 'POST',
      token: creatorToken,
      data: {
        label: 'Hospital invoice',
        type: 'pdf',
        url: 'https://cdn.example.com/e2e/invoice.pdf',
        storageKey: 'crowdfunding/documents/e2e/invoice.pdf',
        sizeBytes: 1024,
      },
    });
    expect(doc.status).toBe(201);
    const docs = await goFetch(request, `${CF}/campaigns/${campaignId}/documents`, {
      token: fanToken,
    });
    expect(docs.status).toBe(200);

    // Contribute so the broadcast has a real backer list.
    const give = await goFetch(request, `${CF}/campaigns/${campaignId}/contribute`, {
      method: 'POST',
      token: fanToken,
      data: { amount_kobo: 50_000, idempotency_key: idemKey('cf-fan') },
    });
    expect(give.status).toBe(201);
    const bcast = await goFetch(request, `${CF}/campaigns/${campaignId}/broadcast`, {
      method: 'POST',
      token: creatorToken,
      data: { subject: 'Thank you backers', body: 'We reached 5% of our goal today.', channelPush: true },
    });
    expect(bcast.status).toBe(200);

    // Support ticket + reply + notifications + prefs.
    const ticket = await goFetch(request, `${CF}/support/tickets`, {
      method: 'POST',
      token: fanToken,
      data: { category: 'payments', subject: 'Contribution receipt', body: 'Where is my receipt?' },
    });
    expect(ticket.status).toBe(201);
    const ticketId = ticket.body?.id ?? ticket.body?.data?.id;
    const ticketReply = await goFetch(request, `${CF}/support/tickets/${ticketId}/reply`, {
      method: 'POST',
      token: fanToken,
      data: { body: 'Adding more detail.' },
    });
    expect(ticketReply.status).toBe(200);
    const tickets = await goFetch(request, `${CF}/support/tickets`, { token: fanToken });
    expect(tickets.status).toBe(200);
    const notifs = await goFetch(request, `${CF}/notifications`, { token: fanToken });
    expect(notifs.status).toBe(200);
    const markRead = await goFetch(request, `${CF}/notifications/read`, {
      method: 'POST',
      token: fanToken,
    });
    expect(markRead.status).toBe(200);
    const prefs = await goFetch(request, `${CF}/settings/notifications`, { token: fanToken });
    expect(prefs.status).toBe(200);
    const savePrefs = await goFetch(request, `${CF}/settings/notifications`, {
      method: 'PUT',
      token: fanToken,
      data: { ...prefs.body, marketing: false },
    });
    expect(savePrefs.status).toBe(200);
    const help = await goFetch(request, `${CF}/help`, { token: fanToken });
    expect(help.status).toBe(200);

    // Creator surfaces: stats, my campaigns, analytics, contributors, saved.
    for (const p of [
      `${CF}/creator/stats`,
      `${CF}/creator/campaigns`,
      `${CF}/creator/contributions`,
      `${CF}/creator/notifications`,
      `${CF}/creator/campaigns/${campaignId}/analytics`,
      `${CF}/campaigns/${campaignId}/contributors`,
      `${CF}/campaigns/${campaignId}/milestones`,
    ]) {
      const r = await goFetch(request, p, { token: creatorToken });
      expect(r.status, `GET ${p}`).toBe(200);
    }
    const save = await goFetch(request, `${CF}/campaigns/${campaignId}/save`, {
      method: 'POST',
      token: fanToken,
    });
    expect(save.status).toBe(200);
    const saved = await goFetch(request, `${CF}/saved-campaigns`, { token: fanToken });
    expect(saved.status).toBe(200);
    const unsave = await goFetch(request, `${CF}/campaigns/${campaignId}/save`, {
      method: 'DELETE',
      token: fanToken,
    });
    expect(unsave.status).toBe(200);

    // Pause stops the money rail (409), resume restores it.
    const pause = await goFetch(request, `${CF}/creator/campaigns/${campaignId}/pause`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(pause.status).toBe(200);
    const legsBeforeBlock = countLegsByRef(`%campaign:${campaignId}:contributor:${fan.userId}%`);
    const blocked = await goFetch(request, `${CF}/campaigns/${campaignId}/contribute`, {
      method: 'POST',
      token: fanToken,
      data: { amount_kobo: 10_000, idempotency_key: idemKey('cf-blocked') },
    });
    expect(blocked.status).toBe(409);
    expect(countLegsByRef(`%campaign:${campaignId}:contributor:${fan.userId}%`)).toBe(legsBeforeBlock);
    const resume = await goFetch(request, `${CF}/creator/campaigns/${campaignId}/resume`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(resume.status).toBe(200);
    const give2 = await goFetch(request, `${CF}/campaigns/${campaignId}/contribute`, {
      method: 'POST',
      token: fanToken,
      data: { amount_kobo: 10_000, idempotency_key: idemKey('cf-after-resume') },
    });
    expect(give2.status).toBe(201);

    // Released contributions are clawed back: the fan's 10k reverses (creator
    // still holds ≥9k), but the backer's 200k can't — the creator already
    // withdrew — so it lands in failedCount/unrefundedKobo, never fabricated.
    const statusNow = psql(
      `select status, (select count(*) from contributions where campaign_id='${campaignId}' and status='escrowed') from campaigns where id='${campaignId}'`,
    );
    expect(statusNow).not.toContain('funded');
    const refundNone = await goFetch(request, `${CF}/campaigns/${campaignId}/refund`, {
      method: 'POST',
      token: creatorToken,
    });
    expect(refundNone.status).toBe(200);
    expect(refundNone.body.refundedCount).toBe(1); // fan's 10k clawed back
    expect(refundNone.body.failedCount).toBe(1);   // backer's 200k — creator cashed out
    expect(refundNone.body.unrefundedKobo).toBe(200_000);
    expect(psql(`select status from campaigns where id='${campaignId}'`)).toBe('failed');
  });
});
