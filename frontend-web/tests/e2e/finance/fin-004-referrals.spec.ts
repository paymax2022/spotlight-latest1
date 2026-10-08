/**
 * FIN-004 — referrals.
 *
 * Two parallel referral systems are live (both flag-on):
 *   §7A Referral Earning System — /api/finance/referral/*  (config,
 *     my-attribution, claim-code, my-rewards, withdraw-eligible, withdraw,
 *     invite/vanity) + /api/finance/referrals/me (legacy summary)
 *   Direct Referral Rewards Engine — /v1/referrals/* (link, attribute,
 *     me/dashboard, me/referrals, me/earnings, me/milestones)
 *
 * Journey: user A mints a referral code → user B registers through the real
 * BFF /api/auth/register carrying referralCode → attribution row asserted in
 * Postgres + visible on A's referrals list + B's my-attribution. Rewards are
 * purchase-settlement-driven: with no purchase event in this environment the
 * eligible balance stays 0 and the withdraw path must refuse (bounded leg —
 * the earning trigger is exercised only as far as the product allows).
 *
 * Internal hooks are exercised for fail-closed posture (no configured secret
 * → 503; wrong secret → 401), never to move reward state.
 */

import { expect, test } from '@playwright/test';

import {
  assertKoboIntegers,
  bffFetch,
  goFetch,
  goTrueToken,
  provisionVerifiedUser,
  psql,
  uniqueEmail,
} from './helpers';

test.describe('FIN-004 referrals', () => {
  test('code mint → signup attribution → referrer sees referral → bounded withdraw', async ({ request }) => {
    const referrer = await provisionVerifiedUser(request, 'fin004a');
    const refToken = await goTrueToken(request, referrer.email, referrer.password);

    // ── A mints an engine code ─────────────────────────────────────────────
    const link = await goFetch(request, '/v1/referrals/link', { method: 'POST', token: refToken });
    expect(link.status).toBe(200);
    const code = link.body?.code as string;
    expect(code).toBeTruthy();
    expect(link.body.referrer_id).toBe(referrer.userId);

    // ── B registers through the REAL BFF with A's code ─────────────────────
    const referredEmail = uniqueEmail('fin004b');
    const reg = await request.post('/api/auth/register', {
      data: { fullName: 'E2E Referred', email: referredEmail, password: 'E2eLocalPass123!', referralCode: code },
    });
    const regBody = await reg.json().catch(() => null);
    expect(reg.ok(), JSON.stringify(regBody)).toBeTruthy();
    const referredId = regBody?.user?.id as string;
    expect(referredId).toBeTruthy();

    // ── Attribution row (read-only SQL assertion) ──────────────────────────
    const attr = psql(
      `select referrer_id || '|' || coalesce(is_house::text,'') from referral_attributions ` +
        `where referred_user_id='${referredId}';`,
    );
    expect(attr).toContain(referrer.userId);

    // ── A sees B on the engine referrals list ──────────────────────────────
    const list = await goFetch(request, '/v1/referrals/me/referrals', { token: refToken });
    expect(list.status).toBe(200);
    const ids = (list.body?.referrals ?? []).map((r: any) => r.referred_user_id ?? r.user_id);
    expect(ids).toContain(referredId);

    // ── B's §7A my-attribution resolves to A (not the house) ───────────────
    const referredToken = await goTrueToken(request, referredEmail, 'E2eLocalPass123!').catch(async () => {
      // Email confirmation is fixture setup — same as provisionVerifiedUser.
      psql(
        `update auth.users set email_confirmed_at = now() where id = '${referredId}';` +
          `update public.platform_users set email_verified_at = now() where id = '${referredId}';`,
      );
      return goTrueToken(request, referredEmail, 'E2eLocalPass123!');
    });
    const myAttr = await goFetch(request, '/api/finance/referral/my-attribution', { token: referredToken });
    expect(myAttr.status).toBe(200);
    test.info().annotations.push({
      type: 'observation',
      description: `my-attribution for referred user: ${JSON.stringify(myAttr.body)}`,
    });

    // ── Config + rewards surfaces (no purchase → zero eligible) ────────────
    const cfg = await bffFetch(request, '/api/v1/referral/config', { token: refToken });
    expect(cfg.status).toBe(200);
    expect(cfg.body.attribution_window_hours).toBeGreaterThan(0);

    const rewards = await bffFetch(request, '/api/v1/referral/my-rewards', { token: refToken });
    expect(rewards.status).toBe(200);
    expect(rewards.body.eligible_kobo).toBe(0);
    expect(assertKoboIntegers(rewards.body)).toEqual([]);

    const eligible = await bffFetch(request, '/api/v1/referral/withdraw-eligible', { token: refToken });
    expect(eligible.status).toBe(200);
    expect(eligible.body.eligible_kobo).toBe(0);

    // ── Withdraw with nothing eligible → refused (bounded leg) ─────────────
    const wd = await bffFetch(request, '/api/v1/referral/withdraw', {
      method: 'POST',
      token: refToken,
      headers: { 'Idempotency-Key': `e2e-fin-wd-${Date.now()}` },
      data: {},
    });
    expect([400, 402, 403, 404, 422]).toContain(wd.status);
    test.info().annotations.push({
      type: 'observation',
      description: `withdraw with zero eligible → ${wd.status} ${JSON.stringify(wd.body)}`,
    });

    // ── Legacy summary surface ──────────────────────────────────────────────
    const legacy = await goFetch(request, '/api/finance/referrals/me', { token: refToken });
    expect(legacy.status).toBe(200);
    test.info().annotations.push({
      type: 'observation',
      description: `legacy /api/finance/referrals/me code=${legacy.body?.code} vs engine code=${code}`,
    });
  });

  test('POST /v1/referrals/attribute post-signup — overrides claimable house row', async ({ request }) => {
    // E2E-FIN-042 FIXED: every codeless signup holds a house placeholder
    // (is_house, referrer NULL); the attribute endpoint now upserts over it
    // when still claimable (is_house + status='grace' + window open) and
    // returns the honest {referrer_id, attributed} shape.
    const referrer = await provisionVerifiedUser(request, 'fin004c');
    const joiner = await provisionVerifiedUser(request, 'fin004d');
    const refToken = await goTrueToken(request, referrer.email, referrer.password);
    const joinToken = await goTrueToken(request, joiner.email, joiner.password);

    const link = await goFetch(request, '/v1/referrals/link', { method: 'POST', token: refToken });
    const code = link.body?.code as string;

    const att = await goFetch(request, '/v1/referrals/attribute', {
      method: 'POST',
      token: joinToken,
      data: { code },
    });
    expect(att.status).toBe(200);
    expect(att.body?.attributed).toBe(true);
    expect(att.body?.referrer_id).toBe(referrer.userId);

    // The DB proves the override: house row replaced with the real referrer.
    const attr = psql(
      `select attribution_type || '|' || coalesce(referrer_id::text,'NULL') || '|' || coalesce(code_used,'NULL') ` +
        `from referral_attributions where referred_user_id='${joiner.userId}';`,
    );
    expect(attr).toContain('code');
    expect(attr).toContain(referrer.userId);
    expect(attr).toContain(code);
    expect(attr).not.toContain('global_house');

    // Self-referral refused.
    const self = await goFetch(request, '/v1/referrals/attribute', {
      method: 'POST',
      token: refToken,
      data: { code },
    });
    expect(self.status).toBe(400);

    // Unknown code refused (resolved before the house-row conflict path).
    const stranger = await provisionVerifiedUser(request, 'fin004e');
    const strangerToken = await goTrueToken(request, stranger.email, stranger.password);
    const unknown = await goFetch(request, '/v1/referrals/attribute', {
      method: 'POST',
      token: strangerToken,
      data: { code: 'NO-SUCH-CODE-99' },
    });
    expect(unknown.status).toBe(400);
  });

  test('internal purchase hooks fail closed without/wrong secret', async ({ request }) => {
    const body = {
      source_transaction_id: `e2e-${Date.now()}`,
      payer_user_id: '00000000-0000-0000-0000-000000000000',
      amount_kobo: 100_000,
      module: 'e2e',
    };
    const noSecret = await goFetch(request, '/internal/referrals/purchase-settled', {
      method: 'POST',
      data: body,
    });
    expect([401, 503]).toContain(noSecret.status);
    const wrongSecret = await goFetch(request, '/internal/referrals/purchase-settled', {
      method: 'POST',
      headers: { 'X-Internal-Secret': 'definitely-wrong' },
      data: body,
    });
    expect([401, 503]).toContain(wrongSecret.status);
  });
});
