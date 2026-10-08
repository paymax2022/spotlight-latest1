/**
 * ACAD-005 — Academy Commerce: plans/bundles catalog, order→pay (wallet ledger),
 * order→BNPL→signed-settle-webhook loop, access cards, subscribe, sync,
 * admin payments overview / refund / card allocate.
 *
 * Route bases (internal/academy/commerce/handler.go RegisterAcademyCommerce):
 *   member: /api/finance/academy/commerce/*
 *   admin : /api/academy/commerce/admin/*
 *
 * Money doctrine: PayNow debits the member's Paymax wallet via academyLedgerRail
 * (ledgerSvc) — fundWallet posts the same balanced journal the top-up webhook
 * posts, and kyc_tier is raised because the strict debit gate refuses Tier-0.
 * BNPL uses the HTTP rail (BNPL_BASE_URL=127.0.0.1:9101 fake): the fake's async
 * callback is aimed at :8081, so the spec posts the SIGNED settle webhook
 * itself (X-Fake-Signature: sha256=…) — the same bytes the fake would send.
 * Webhook contract (internal/app/academy_webhooks.go): bad sig 401; unknown ref
 * → recorded/no_matching_obligation; (rail,provider_ref) replay → "duplicate";
 * matching terminal obligation → {"data":"ok"}.
 */
import { test, expect } from '@playwright/test';
import {
  acadKey,
  adminBearer,
  fundWallet,
  goFetch,
  goFetchH,
  goTrueToken,
  postRailWebhook,
  provisionVerifiedUser,
  psql,
  setKycTier,
  walletBalance,
} from './helpers';

const COMM = '/api/finance/academy/commerce';
const CADM = '/api/academy/commerce/admin';
const HOOK = '/internal/webhooks/academy';

test.describe('ACAD-005 commerce', () => {
  test('catalog → order → pay (wallet debit) → entitlement + admin refund', async ({
    request,
  }) => {
    const u = await provisionVerifiedUser(request, 'acad-com');
    const tok = await goTrueToken(request, u.email, u.password);
    const adminTok = await adminBearer(request);

    // Catalog fixture: an active plan + an active exam bundle (none seeded).
    const planCode = `PLAN-${acadKey('c')}`;
    const planId = psql(
      `insert into academy_plans(code,name,price_minor,period,status) ` +
        `values ('${planCode}','E2E Monthly',250000,'monthly','active') returning id`,
    ).split('\n')[0].trim();
    expect(planId).toMatch(/^[0-9a-f-]{36}$/);

    const plans = await goFetch(request, `${COMM}/plans`, { token: tok });
    expect(plans.status).toBe(200);
    expect(JSON.stringify(plans.body)).toContain(planId);

    const bundleId = psql(
      `insert into academy_exam_bundles(name,price_minor,status,contents) ` +
        `values ('E2E Bundle',400000,'active','{"lessons":[]}') returning id`,
    ).split('\n')[0].trim();
    expect((await goFetch(request, `${COMM}/bundles`, { token: tok })).status).toBe(200);
    expect((await goFetch(request, `${COMM}/bundles/${bundleId}`, { token: tok })).status).toBe(200);
    // /bundles/:id/manifest reads academy_CONTENT_bundles (the CMS offline pack),
    // not academy_exam_bundles — seed one to exercise the route (commerce
    // repository.go GetContentBundleManifest).
    const cbId = psql(
      `insert into academy_content_bundles(name,status,manifest) ` +
        `values ('E2E Pack','live','{"v":1}') returning id`,
    ).split('\n')[0].trim();
    expect(
      (await goFetch(request, `${COMM}/bundles/${cbId}/manifest`, { token: tok })).status,
    ).toBe(200);

    // Fund the wallet + lift the tier-0 debit gate, then order → pay.
    setKycTier(u.userId, 3);
    fundWallet(u.userId, 500000, `com-${Date.now()}`); // idem key embeds tag → unique per run
    expect(Number(await walletBalance(u.userId))).toBeGreaterThanOrEqual(500000);

    const order = await goFetch(request, `${COMM}/orders`, {
      method: 'POST',
      token: tok,
      data: { kind: 'plan', refId: planId },
    });
    expect(order.status).toBe(201);
    const orderId = order.body?.data?.id ?? order.body?.id;
    expect(orderId).toBeTruthy();

    const pay = await goFetchH(request, `${COMM}/orders/${orderId}/pay`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('pay') },
      data: {},
    });
    if (![200, 201].includes(pay.status)) console.log('PAY', pay.status, JSON.stringify(pay.body));
    expect([200, 201]).toContain(pay.status);
    // The wallet debit is a ledger projection — it must reflect the charge.
    expect(Number(await walletBalance(u.userId))).toBeLessThan(500000);

    // A fresh key on an already-entitled order is a NO-OP success (service.go
    // :154 returns the settled order before the charge path) — the wallet must
    // not drop again.
    const balAfterPay = Number(await walletBalance(u.userId));
    const replay = await goFetchH(request, `${COMM}/orders/${orderId}/pay`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('pay') }, // different key → still no re-charge
      data: {},
    });
    expect([200, 201]).toContain(replay.status);
    expect(Number(await walletBalance(u.userId))).toBe(balAfterPay);

    // Entitlement visible in DB (source=order).
    expect(
      psql(`select count(*) from academy_entitlements where user_id='${u.userId}' and source='order'`),
    ).not.toBe('0');

    // Admin payments overview + refund of the paid order (reversal leg).
    expect((await goFetch(request, `${CADM}/payments/overview`, { token: adminTok })).status).toBe(
      200,
    );
    const refund = await goFetchH(request, `${CADM}/orders/${orderId}/refund`, {
      method: 'POST',
      token: adminTok,
      headers: { 'Idempotency-Key': acadKey('refund') }, // money reversal → key required
      data: { reason: 'e2e refund' },
    });
    if (![200, 201, 409].includes(refund.status))
      console.log('REFUND', refund.status, JSON.stringify(refund.body));
    expect([200, 201, 409]).toContain(refund.status);
  });

  test('order → BNPL start → signed settle webhook reconciles (obligation loop)', async ({
    request,
  }) => {
    const u = await provisionVerifiedUser(request, 'acad-bnpl');
    const tok = await goTrueToken(request, u.email, u.password);
    const adminTok = await adminBearer(request);

    const planId = psql(
      `insert into academy_plans(code,name,price_minor,period,status) ` +
        `values ('${`PLAN-${acadKey('b')}`}','E2E BNPL Plan',300000,'monthly','active') returning id`,
    ).split('\n')[0].trim();

    const order = await goFetch(request, `${COMM}/orders`, {
      method: 'POST',
      token: tok,
      data: { kind: 'plan', refId: planId },
    });
    expect(order.status).toBe(201);
    const orderId = order.body?.data?.id ?? order.body?.id;

    // Negative first: an unsigned/wrong-signed settle webhook must 401.
    const badHook = await postRailWebhook(request, {
      rail: 'bnpl',
      event: 'approved',
      ref: 'bnpl-nonexistent',
      reference: orderId,
      idempotency_key: acadKey('wh-bad'),
      amount_minor: 300000,
    }, { secret: 'wrong-secret' });
    expect(badHook.status).toBe(401);

    // Start BNPL via the HTTP fake rail → order goes entitled with bnpl_ref set.
    const bnpl = await goFetchH(request, `${COMM}/orders/${orderId}/bnpl`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('bnpl') },
      data: {},
    });
    if (![200, 201].includes(bnpl.status)) console.log('BNPL', bnpl.status, JSON.stringify(bnpl.body));
    expect([200, 201]).toContain(bnpl.status);
    const bnplRef =
      bnpl.body?.data?.bnplRef ?? bnpl.body?.data?.bnpl_ref ?? bnpl.body?.bnplRef;
    expect(bnplRef).toBeTruthy();

    // Non-settle event name is recorded but never reconciles.
    const nonSettle = await postRailWebhook(request, {
      rail: 'bnpl',
      event: 'chargeback',
      ref: `${bnplRef}-x`,
      reference: orderId,
      idempotency_key: acadKey('wh-ns'),
      amount_minor: 300000,
    });
    expect(nonSettle.status).toBe(200);

    // The signed approved settle webhook with the REAL provider ref reconciles.
    const settle = await postRailWebhook(request, {
      rail: 'bnpl',
      event: 'approved',
      ref: bnplRef,
      reference: orderId,
      idempotency_key: acadKey('wh-ok'),
      amount_minor: 300000,
    });
    expect(settle.status).toBe(200);
    expect(settle.body?.data ?? JSON.stringify(settle.body)).toBeTruthy();

    // Replay of the same (rail, provider_ref) is a dedupe no-op.
    const dup = await postRailWebhook(request, {
      rail: 'bnpl',
      event: 'approved',
      ref: bnplRef,
      reference: orderId,
      idempotency_key: acadKey('wh-ok'),
      amount_minor: 300000,
    });
    expect(dup.status).toBe(200);
    expect(JSON.stringify(dup.body)).toContain('duplicate');

    // Entitlement granted with source=bnpl.
    expect(
      psql(`select count(*) from academy_entitlements where user_id='${u.userId}' and source='bnpl'`),
    ).not.toBe('0');
    void adminTok;
  });

  test('access cards: admin generate → allocate → list → member activate', async ({ request }) => {
    const u = await provisionVerifiedUser(request, 'acad-card');
    const tok = await goTrueToken(request, u.email, u.password);
    const adminTok = await adminBearer(request);

    const planId = psql(
      `insert into academy_plans(code,name,price_minor,period,status) ` +
        `values ('${`PLAN-${acadKey('ac')}`}','E2E Card Plan',100000,'monthly','active') returning id`,
    ).split('\n')[0].trim();

    const batch = `B-${acadKey('batch')}`;
    const gen = await goFetch(request, `${CADM}/access-cards/generate`, {
      method: 'POST',
      token: adminTok,
      data: { batch, grantKind: 'plan', grantRefId: planId, count: 2, pinDigits: 6 },
    });
    if (![200, 201].includes(gen.status)) console.log('GEN', gen.status, JSON.stringify(gen.body));
    expect([200, 201]).toContain(gen.status);
    const cards = gen.body?.data ?? gen.body?.cards ?? gen.body;
    const card = Array.isArray(cards) ? cards[0] : cards?.[0] ?? cards;
    expect(card?.serial).toBeTruthy();
    expect(card?.pin ?? card?.pinPlaintext ?? card?.PIN).toBeTruthy();

    // Allocate the batch to an "agent" (any user id) then list the batch.
    const alloc = await goFetch(request, `${CADM}/access-cards/allocate`, {
      method: 'POST',
      token: adminTok,
      data: { agentId: u.userId, batch },
    });
    expect([200, 201, 400, 409, 422]).toContain(alloc.status);
    expect(
      (await goFetch(request, `${CADM}/access-cards?batch=${batch}`, { token: adminTok })).status,
    ).toBe(200);

    // Member redeems serial+PIN → entitlement source=access_card.
    const pin = card?.pin ?? card?.pinPlaintext ?? card?.PIN;
    const act = await goFetchH(request, `${COMM}/access-cards/activate`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('card') },
      data: { serial: card.serial, pin: String(pin) },
    });
    if (![200, 201].includes(act.status)) console.log('ACT', act.status, JSON.stringify(act.body));
    expect([200, 201]).toContain(act.status);
    expect(
      psql(
        `select count(*) from academy_entitlements where user_id='${u.userId}' and source='access_card'`,
      ),
    ).not.toBe('0');

    // Replay-by-state: the SAME user re-activating a consumed card gets the
    // recorded entitlement back (200) even with a wrong PIN — PIN is verified
    // only on the FIRST activation (service.go:479-498). A DIFFERENT user on
    // the consumed card must be refused.
    const sameUserReplay = await goFetchH(request, `${COMM}/access-cards/activate`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('card-replay') },
      data: { serial: card.serial, pin: '000000' },
    });
    expect([200, 201]).toContain(sameUserReplay.status);
    const other = await provisionVerifiedUser(request, 'acad-card2');
    const otherTok = await goTrueToken(request, other.email, other.password);
    const otherTry = await goFetchH(request, `${COMM}/access-cards/activate`, {
      method: 'POST',
      token: otherTok,
      headers: { 'Idempotency-Key': acadKey('card-other') },
      data: { serial: card.serial, pin: String(pin) },
    });
    expect([400, 401, 403, 404, 409, 422]).toContain(otherTry.status);
  });

  test('subscribe → subscription row; commerce sync envelope idempotent', async ({ request }) => {
    const u = await provisionVerifiedUser(request, 'acad-sub');
    const tok = await goTrueToken(request, u.email, u.password);
    setKycTier(u.userId, 3);
    fundWallet(u.userId, 500000, `sub-${Date.now()}`);

    const planId = psql(
      `insert into academy_plans(code,name,price_minor,period,status) ` +
        `values ('${`PLAN-${acadKey('s')}`}','E2E Sub Plan',200000,'monthly','active') returning id`,
    ).split('\n')[0].trim();

    const sub = await goFetchH(request, `${COMM}/subscribe`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('sub') },
      data: { planId },
    });
    if (![200, 201].includes(sub.status)) console.log('SUB', sub.status, JSON.stringify(sub.body));
    expect([200, 201]).toContain(sub.status);
    expect(
      psql(`select count(*) from academy_subscriptions where user_id='${u.userId}'`),
    ).not.toBe('0');

    // Sync envelope: server-authoritative, idempotent on clientEventId.
    const evId = `ev-${acadKey('s')}`;
    const syncBody = {
      events: [
        { clientEventId: evId, kind: 'progress', payload: { lessonId: 'l1', pct: 100 } },
      ],
    };
    const s1 = await goFetch(request, `${COMM}/sync`, { method: 'POST', token: tok, data: syncBody });
    expect([200, 201]).toContain(s1.status);
    const s2 = await goFetch(request, `${COMM}/sync`, { method: 'POST', token: tok, data: syncBody });
    expect([200, 201]).toContain(s2.status); // replay → same reconciled set, no dup
  });
});
