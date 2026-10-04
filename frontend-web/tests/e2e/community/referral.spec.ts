/**
 * REFERRAL (internal/referral §7A + engine admin) — attribution, rewards,
 * withdraw money path, risk/compliance/gamification surfaces, admin consoles.
 * Mounts: :8080/api/finance/referral/* (member), :8080/api/referral/admin/*
 * (RBAC referral.*), :8080/v1/referrals/* + /v1/admin/referrals/* (engine),
 * /internal/referrals/* (service-to-service, secret-gated).
 *
 * Distinct from fin-004-referrals.spec.ts (engine link/signup/attribute +
 * zero-eligible withdraw + internal-hook fail-closed) — this suite covers the
 * §7A member surface and BOTH admin consoles plus the eligible→wallet sweep.
 *
 * Money invariants proven live:
 *   - POST /withdraw requires Idempotency-Key, verified-KYC tier (fail-closed
 *     403 for tier-0), posts balanced legs (referral:payout:<rewardId>), and
 *     replays without double-crediting;
 *   - gamification mission claim refuses without an Idempotency-Key;
 *   - kobo integers only in every money payload.
 */

import { test, expect } from '@playwright/test';
import {
  goFetch,
  adminCommunityGo,
  provisionVerifiedUser,
  goTrueToken,
  setKycVerified,
  assertKoboIntegers,
  walletBalanceSql,
  ledgerTotalsByRef,
  seedEligibleReferralReward,
  idemKey,
  psql,
} from './helpers';

const REF = '/api/finance/referral';
const REF_ADMIN = '/api/referral/admin';
const IDEM = (k: string) => ({ 'Idempotency-Key': k });
const REWARD_KOBO = 75_000;

test.describe('referral withdraw money path', () => {
  test('eligible → wallet sweep: idempotent, balanced legs, KYC-gated fail-closed', async ({
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'ref-wd');
    const token = await goTrueToken(request, user.email, user.password);
    setKycVerified(user.userId, 3);

    // Seed an eligible reward (fixture input — real accruals arrive via
    // purchase-settled internal hooks, which need a secret unset locally).
    const rewardId = seedEligibleReferralReward(user.userId, REWARD_KOBO, `wd-${Date.now()}`);

    const eligible = await goFetch(request, `${REF}/withdraw-eligible`, { token });
    expect(eligible.status).toBe(200);
    expect(eligible.body.eligible_kobo).toBe(REWARD_KOBO);
    expect(assertKoboIntegers(eligible.body)).toEqual([]);

    // Missing Idempotency-Key → 400, no state change.
    const noIdem = await goFetch(request, `${REF}/withdraw`, { method: 'POST', token });
    expect(noIdem.status).toBe(400);
    expect(
      psql(`select state from referral_reward_ledger where id='${rewardId}'`),
    ).toBe('eligible');

    // Withdraw → balanced payout legs + wallet credit + state flip to paid.
    const wdIdem = idemKey('ref-wd');
    const wd = await goFetch(request, `${REF}/withdraw`, {
      method: 'POST',
      token,
      headers: IDEM(wdIdem),
    });
    expect(wd.status).toBe(200);
    expect(wd.body.withdrawn_kobo).toBe(REWARD_KOBO);
    expect(wd.body.rewards_paid).toBe(1);
    expect(wd.body.remaining_eligible_kobo).toBe(0);
    expect(assertKoboIntegers(wd.body)).toEqual([]);

    const legs = ledgerTotalsByRef(`referral:payout:${rewardId}`);
    expect(legs.debits).toBe(REWARD_KOBO);
    expect(legs.credits).toBe(REWARD_KOBO); // DR referral_reward / CR user_wallet
    expect(walletBalanceSql(user.userId)).toBe(REWARD_KOBO);
    expect(psql(`select state from referral_reward_ledger where id='${rewardId}'`)).toBe('paid');

    // Replay with the same key: nothing re-credits (each row's pay key dedups).
    const replay = await goFetch(request, `${REF}/withdraw`, {
      method: 'POST',
      token,
      headers: IDEM(wdIdem),
    });
    expect(replay.status).toBe(200);
    expect(walletBalanceSql(user.userId)).toBe(REWARD_KOBO);
    expect(ledgerTotalsByRef(`referral:payout:${rewardId}`).credits).toBe(REWARD_KOBO);

    // ── Tier-0 / unverified account: refused, no money, state untouched ──────
    const low = await provisionVerifiedUser(request, 'ref-lowkyc');
    const lowToken = await goTrueToken(request, low.email, low.password);
    const lowRewardId = seedEligibleReferralReward(low.userId, REWARD_KOBO, `low-${Date.now()}`);
    const refuse = await goFetch(request, `${REF}/withdraw`, {
      method: 'POST',
      token: lowToken,
      headers: IDEM(idemKey('ref-wd0')),
    });
    expect(refuse.status).toBe(403);
    expect(walletBalanceSql(low.userId)).toBe(0);
    expect(ledgerTotalsByRef(`referral:payout:${lowRewardId}`).credits).toBe(0);
    expect(psql(`select state from referral_reward_ledger where id='${lowRewardId}'`)).toBe('eligible');
  });

  test('§7A member surface + claim-code attribution + abuse report → admin alert', async ({
    request,
  }) => {
    const referrer = await provisionVerifiedUser(request, 'ref-rer');
    const referrerToken = await goTrueToken(request, referrer.email, referrer.password);
    const member = await provisionVerifiedUser(request, 'ref-mem');
    const memberToken = await goTrueToken(request, member.email, member.password);

    // Referrer creates a rewards-engine link (fixture for the claim journey).
    const link = await goFetch(request, '/v1/referrals/link', {
      method: 'POST',
      token: referrerToken,
    });
    expect(link.status).toBeLessThan(400);
    const code = link.body?.code ?? link.body?.data?.code ?? link.body?.referral_code;
    expect(code).toBeTruthy();

    // §7A member reads.
    for (const p of [
      `${REF}/config`,
      `${REF}/my-rewards`,
      `${REF}/withdraw-eligible`,
      `${REF}/gamification/missions`,
      `${REF}/gamification/missions/progress`,
      `${REF}/gamification/ranks`,
      `${REF}/gamification/my-rank`,
      `${REF}/gamification/badges`,
      `${REF}/gamification/leaderboard`,
      `${REF}/gamification/contests`,
      `${REF}/gamification/streak`,
      `${REF}/risk/my-status`,
      `${REF}/compliance/consents`,
      `${REF}/network/ambassador`,
      `${REF}/network/teams`,
      `${REF}/network/overrides`,
      `${REF}/merchant/dashboard`,
      `${REF}/campaigns`,
    ]) {
      const r = await goFetch(request, p, { token: memberToken });
      expect([200, 404], `GET ${p}`).toContain(r.status);
    }

    // Mission claim without an Idempotency-Key → 400 (money-path guard).
    const claimNoIdem = await goFetch(request, `${REF}/gamification/missions/m-1/claim`, {
      method: 'POST',
      token: memberToken,
    });
    expect(claimNoIdem.status).toBe(400);

    // Vanity invite links: create → list (idempotent per (user, alias)).
    const alias = `e2e${Date.now() % 100000}`;
    const mkVanity = await goFetch(request, `${REF}/invite/vanity`, {
      method: 'POST',
      token: memberToken,
      data: { alias, source: 'e2e' },
    });
    expect([200, 201]).toContain(mkVanity.status);
    const vanities = await goFetch(request, `${REF}/invite/vanity`, { token: memberToken });
    expect(vanities.status).toBe(200);

    // Late-claim the referrer's code → attribution row exists.
    const claim = await goFetch(request, `${REF}/claim-code`, {
      method: 'POST',
      token: memberToken,
      data: { code },
    });
    expect([200, 201]).toContain(claim.status);
    const att = await goFetch(request, `${REF}/my-attribution`, { token: memberToken });
    expect(att.status).toBe(200);

    // Abuse report with empty target resolves the referrer server-side → 201,
    // and the alert appears on the admin risk alert queue.
    const report = await goFetch(request, `${REF}/risk/report-abuse`, {
      method: 'POST',
      token: memberToken,
      data: { reason_code: 'E2E_ABUSE' },
    });
    expect(report.status).toBe(201);
    const adminAlerts = await adminCommunityGo(request, `${REF_ADMIN}/risk/alerts`);
    expect(adminAlerts.status).toBe(200);
    expect(JSON.stringify(adminAlerts.body)).toContain(referrer.userId);

    // Self-report refused.
    const selfReport = await goFetch(request, `${REF}/risk/report-abuse`, {
      method: 'POST',
      token: memberToken,
      data: { target_user_id: member.userId, reason_code: 'E2E_SELF' },
    });
    expect(selfReport.status).toBe(400);

    // E2E-COM-002 FIXED: member targets are referral-graph-scoped. Naming
    // the member's own referrer explicitly is in scope (201); naming an
    // arbitrary account is refused (400) and writes NO alert row.
    const named = await goFetch(request, `${REF}/risk/report-abuse`, {
      method: 'POST',
      token: memberToken,
      data: { target_user_id: referrer.userId, reason_code: 'E2E_INSCOPE' },
    });
    expect(named.status).toBe(201);

    const victim = await provisionVerifiedUser(request, 'ref-victim');
    const arbitrary = await goFetch(request, `${REF}/risk/report-abuse`, {
      method: 'POST',
      token: memberToken,
      data: { target_user_id: victim.userId, reason_code: 'E2E_ARBITRARY' },
    });
    expect(arbitrary.status).toBe(400); // out of the reporter's referral graph
    expect(
      psql(`select count(*) from referral_risk_alerts where subject_id='${victim.userId}'`),
    ).toBe('0'); // a refused report writes nothing
  });

  test('referral admin consoles: §7A trust/economics + engine admin reads', async ({ request }) => {
    const member = await provisionVerifiedUser(request, 'ref-nonadmin');
    const memberToken = await goTrueToken(request, member.email, member.password);

    // RBAC denial: a plain member cannot read either admin console.
    const denied7a = await goFetch(request, `${REF_ADMIN}/config`, { token: memberToken });
    expect(denied7a.status).toBe(403);
    const deniedEng = await goFetch(request, '/v1/admin/referrals/config', { token: memberToken });
    expect(deniedEng.status).toBe(403);

    // §7A admin reads (referral.* permissions, super-admin fixture).
    const admin7a = [
      `${REF_ADMIN}/config`,
      `${REF_ADMIN}/house`,
      `${REF_ADMIN}/house/ledger`,
      `${REF_ADMIN}/reassignments`,
      `${REF_ADMIN}/ledger`,
      `${REF_ADMIN}/campaigns`,
      `${REF_ADMIN}/gamification/missions`,
      `${REF_ADMIN}/gamification/ranks`,
      `${REF_ADMIN}/gamification/contests`,
      `${REF_ADMIN}/network/ambassadors`,
      `${REF_ADMIN}/network/networks`,
      `${REF_ADMIN}/network/override-policies`,
      `${REF_ADMIN}/merchants`,
      `${REF_ADMIN}/risk/dashboard`,
      `${REF_ADMIN}/risk/alerts`,
      `${REF_ADMIN}/risk/rules`,
      `${REF_ADMIN}/risk/cases`,
      `${REF_ADMIN}/risk/blocklist`,
      `${REF_ADMIN}/risk/review-queue`,
      `${REF_ADMIN}/risk/clawbacks`,
      `${REF_ADMIN}/compliance/disclosures`,
      `${REF_ADMIN}/compliance/aml`,
      `${REF_ADMIN}/compliance/policy`,
      `${REF_ADMIN}/compliance/claims`,
      `${REF_ADMIN}/compliance/regulatory-export`,
      `${REF_ADMIN}/finance/payouts`,
      `${REF_ADMIN}/finance/reconciliation`,
      `${REF_ADMIN}/finance/budgets`,
      `${REF_ADMIN}/finance/float`,
      `${REF_ADMIN}/finance/reward-to-ltv`,
      `${REF_ADMIN}/analytics/k-factor`,
      `${REF_ADMIN}/analytics/funnel`,
      `${REF_ADMIN}/analytics/cac`,
      `${REF_ADMIN}/analytics/cohorts`,
      `${REF_ADMIN}/analytics/channels`,
      `${REF_ADMIN}/analytics/segmentation`,
    ];
    for (const p of admin7a) {
      const r = await adminCommunityGo(request, p);
      expect(r.status, `admin GET ${p}`).toBe(200);
    }

    // Rewards-engine admin reads.
    for (const p of [
      '/v1/admin/referrals/config',
      '/v1/admin/referrals/analytics',
      '/v1/admin/referrals/fraud-queue',
      '/v1/admin/referrals/ledger',
      '/v1/admin/referrals/milestones-log',
      '/v1/admin/referrals/module-status',
    ]) {
      const r = await adminCommunityGo(request, p);
      expect(r.status, `admin GET ${p}`).toBe(200);
    }

    // Kobo-integer scan on the money-shaped admin payloads.
    const ledger = await adminCommunityGo(request, `${REF_ADMIN}/ledger`);
    expect(assertKoboIntegers(ledger.body)).toEqual([]);
    const budgets = await adminCommunityGo(request, `${REF_ADMIN}/finance/budgets`);
    expect(assertKoboIntegers(budgets.body)).toEqual([]);
  });
});
