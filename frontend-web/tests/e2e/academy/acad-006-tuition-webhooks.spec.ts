/**
 * ACAD-006 — Academy Tuition (Film Academy installment plans + Paystack-verified
 * money path) + the three remaining rail webhooks (payout/disburse/billing)
 * exercised to the full escrow→settlement reconcile.
 *
 * Routes (internal/academy/tuition/handler.go + app/academy_routes.go:281-301):
 *   member: POST /api/finance/academy/tuition/confirm   (Paystack-verify gated)
 *           POST /api/finance/academy/tuition/validate  (quote: next installment)
 *           GET  /api/finance/academy/tuition/status/:application_id
 *   admin : POST  /api/academy/admin/tuition/plans       (RBAC academy.tuition.admin)
 *           PATCH /api/academy/admin/tuition/plans/:id/mark-complete
 *           PATCH /api/academy/admin/tuition/payments/:id/waive
 *   internal: POST /internal/finance/academy/tuition/confirm (RequireServiceToken)
 *
 * Confirm CANNOT succeed locally without a real Paystack charge — the spec
 * proves the fail-closed path (provider verify error ⇒ refused, never marked
 * paid) rather than faking money.
 *
 * Rail webhooks (internal/app/academy_webhooks.go): payout/disburse/billing
 * settle legs need a terminal-state obligation row (tutor 'paid', disbursement
 * 'disbursed', billing 'paid'). Those producers are flag-gated off
 * (academy.tutor/edupay/schools), so obligations are seeded via SQL fixture —
 * the signed webhook then posts the REAL escrow→settlement ledger leg.
 */
import { test, expect } from '@playwright/test';
import {
  acadKey,
  adminBearer,
  goFetch,
  goFetchH,
  goTrueToken,
  internalFetch,
  postRailWebhook,
  provisionVerifiedUser,
  psql,
  SERVICE_TOKEN,
} from './helpers';

const T = '/api/finance/academy/tuition';
const TA = '/api/academy/admin/tuition';
const INTERNAL = '/internal/finance/academy/tuition/confirm';

/** Seed a fee-bearing batch + application for `userId`; returns {appId, batchId}. */
function seedApplication(userId: string, email: string): { appId: string; batchId: string } {
  const batchId = psql(
    `insert into academy_batches(batch_name,start_date,training_schedule,duration_weeks,training_fee_ngn,installments_count,fee_frequency,status) ` +
      `values ('E2E Batch ${Date.now()}','2026-11-01','weekdays',12,6000,4,'monthly','upcoming') returning id`,
  ).split('\n')[0].trim();
  const appId = psql(
    `insert into academy_applications(user_id,batch_id,full_name,email,phone,talent_category,payment_preference,application_fee_paid,payment_status,status,tuition_total_ngn) ` +
      `values ('${userId}','${batchId}','E2E Applicant','${email}','08000000000','acting','installment',5000,'pending','approved',6000) returning id`,
  ).split('\n')[0].trim();
  return { appId, batchId };
}

test.describe('ACAD-006 tuition + rail webhooks', () => {
  test('admin plan create → member status/validate → confirm fail-closed + admin waive/complete', async ({
    request,
  }) => {
    const u = await provisionVerifiedUser(request, 'acad-tui');
    const tok = await goTrueToken(request, u.email, u.password);
    const adminTok = await adminBearer(request);
    const { appId } = seedApplication(u.userId, u.email);

    // Admin creates the installment plan (approval-trigger fallback path).
    const plan = await goFetch(request, `${TA}/plans`, {
      method: 'POST',
      token: adminTok,
      data: { applicationId: appId },
    });
    if (plan.status !== 200) console.log('PLAN', plan.status, JSON.stringify(plan.body));
    expect(plan.status).toBe(200);
    const planId = plan.body?.data?.id ?? plan.body?.id;
    expect(planId).toBeTruthy();

    // Member status: plan + pending installments.
    const st = await goFetch(request, `${T}/status/${appId}`, { token: tok });
    expect(st.status).toBe(200);
    const payments = st.body?.data?.payments ?? st.body?.payments ?? [];
    expect(payments.length).toBeGreaterThan(0);
    const pay0 = payments.find((p: any) => p.status === 'pending') ?? payments[0];

    // Validate quote: next-installment amount must match; a wrong amount is a
    // sentinel domain error → clean 4xx, never a 500.
    const badAmt = await goFetch(request, `${T}/validate`, {
      method: 'POST',
      token: tok,
      data: { applicationId: appId, amountNgn: 1 },
    });
    expect([400, 409, 422]).toContain(badAmt.status);
    const goodAmt = await goFetch(request, `${T}/validate`, {
      method: 'POST',
      token: tok,
      data: { applicationId: appId, amountNgn: pay0.amountNGN ?? pay0.amountNgn },
    });
    if (![200, 204].includes(goodAmt.status)) console.log('VALID', goodAmt.status, JSON.stringify(goodAmt.body));
    expect([200, 204]).toContain(goodAmt.status);

    // Member confirm without Idempotency-Key → 400 idempotency_key_required.
    const noKey = await goFetch(request, `${T}/confirm`, {
      method: 'POST',
      token: tok,
      data: { planId, paymentId: pay0.id, reference: `ref-${acadKey('r')}` },
    });
    expect(noKey.status).toBe(400);

    // Member confirm WITH key: Paystack VerifyPayment can't succeed against a
    // fabricated reference — the money path must REFUSE (never mark paid).
    const conf = await goFetchH(request, `${T}/confirm`, {
      method: 'POST',
      token: tok,
      headers: { 'Idempotency-Key': acadKey('conf') },
      data: { planId, paymentId: pay0.id, reference: `ref-${acadKey('r')}` },
    });
    if (conf.status === 200) console.log('CONF-UNEXPECTED-OK', JSON.stringify(conf.body));
    expect([400, 402, 404, 409, 422, 500, 502, 503]).toContain(conf.status);
    // And the installment must remain pending (fail-closed money path).
    const st2 = await goFetch(request, `${T}/status/${appId}`, { token: tok });
    const pAfter = (st2.body?.data?.payments ?? []).find((p: any) => p.id === pay0.id);
    expect(pAfter?.status).toBe('pending');

    // Internal confirm route: service-token gate (no token → refused; with
    // token → same provider-verify refusal, never a 404 "route missing").
    const noTok = await internalFetch(request, INTERNAL, {
      data: { planId, paymentId: pay0.id, reference: `ref-${acadKey('r')}` },
    });
    expect([401, 403, 503]).toContain(noTok.status);
    const withTok = await internalFetch(request, INTERNAL, {
      token: SERVICE_TOKEN,
      data: { planId, paymentId: pay0.id, reference: `ref-${acadKey('r')}` },
    });
    expect(withTok.status).not.toBe(401);
    expect(withTok.status).not.toBe(404); // mounted — reaches the service

    // Admin waive the first installment → terminal 'waived'.
    const waive = await goFetch(request, `${TA}/payments/${pay0.id}/waive`, {
      method: 'PATCH',
      token: adminTok,
      data: {},
    });
    if (![200, 204].includes(waive.status)) console.log('WAIVE', waive.status, JSON.stringify(waive.body));
    expect([200, 204]).toContain(waive.status);
    const st3 = await goFetch(request, `${T}/status/${appId}`, { token: tok });
    const waived = (st3.body?.data?.payments ?? []).find((p: any) => p.id === pay0.id);
    expect(waived?.status).toBe('waived');

    // Admin force-complete the plan.
    const complete = await goFetch(request, `${TA}/plans/${planId}/mark-complete`, {
      method: 'PATCH',
      token: adminTok,
      data: {},
    });
    expect([200, 204]).toContain(complete.status);
  });

  test('payout + disburse + billing webhooks: signed settle posts escrow→settlement leg', async ({
    request,
  }) => {
    const tag = Date.now();
    // Seed terminal-state obligations (producers are flag-gated off — this is
    // the fixture-setup seam, not a product write).
    const tutorId = psql(
      `insert into academy_tutors(user_id) values ('6053f241-b4dd-4566-a809-aae0e6702510') ` +
        `on conflict (user_id) do update set user_id=excluded.user_id returning id`,
    ).split('\n')[0].trim();
    const schoolId = psql(`select id from academy_schools limit 1`).split('\n')[0].trim();
    const instId = psql(
      `insert into academy_institutions(name) values ('E2E Inst ${tag}') returning id`,
    ).split('\n')[0].trim();

    const payoutRef = `payout-e2e-${tag}`;
    const disbRef = `disb-e2e-${tag}`;
    const billRef = `bill-e2e-${tag}`;
    psql(
      `insert into academy_tutor_payouts(tutor_id,amount_minor,state,payout_ref,idempotency_key) ` +
        `values ('${tutorId}',125000,'paid','${payoutRef}','idem-${tag}-p')`,
    );
    psql(
      `insert into academy_disbursements(school_id,payer_user_id,amount_minor,state,payout_ref,idempotency_key) ` +
        `values ('${schoolId}','6053f241-b4dd-4566-a809-aae0e6702510',99000,'disbursed','${disbRef}','idem-${tag}-d')`,
    );
    psql(
      `insert into academy_institution_billing(institution_id,period,amount_minor,state,payment_ref) ` +
        `values ('${instId}','2026-10',77000,'paid','${billRef}')`,
    );

    // Wrong-signature → 401 on every rail.
    for (const rail of ['payout', 'disburse', 'billing'] as const) {
      const bad = await postRailWebhook(
        request,
        {
          rail,
          event: 'settled',
          ref: `${rail}-x-${tag}`,
          reference: 'r',
          idempotency_key: `k-${tag}`,
          amount_minor: 1,
        },
        { secret: 'wrong-secret' },
      );
      expect(bad.status).toBe(401);
    }

    // Unknown ref → recorded, reconciled:false (never moves money).
    const unknown = await postRailWebhook(request, {
      rail: 'payout',
      event: 'settled',
      ref: `payout-unknown-${tag}`,
      reference: 'r',
      idempotency_key: `k-u-${tag}`,
      amount_minor: 1,
    });
    expect(unknown.status).toBe(200);
    expect(JSON.stringify(unknown.body)).toContain('no_matching_obligation');

    // Each real obligation settles → {"data":"ok"} and a ledger leg lands.
    for (const [rail, ref] of [
      ['payout', payoutRef],
      ['disburse', disbRef],
      ['billing', billRef],
    ] as const) {
      const settle = await postRailWebhook(request, {
        rail,
        event: 'settled',
        ref,
        reference: `ref-${ref}`,
        idempotency_key: `wh-${ref}`,
        amount_minor: 1,
      });
      expect(settle.status).toBe(200);
      expect(settle.body?.data).toBe('ok');
      // Replay → dedupe no-op.
      const dup = await postRailWebhook(request, {
        rail,
        event: 'settled',
        ref,
        reference: `ref-${ref}`,
        idempotency_key: `wh-${ref}`,
        amount_minor: 1,
      });
      expect(JSON.stringify(dup.body)).toContain('duplicate');
    }

    // The escrow→settlement legs are real ledger rows (academy-rail:<rail>:<ref>).
    expect(
      psql(
        `select count(*) from ledger_entries where idempotency_key like 'academy-rail:%e2e-${tag}%'`,
      ),
    ).not.toBe('0');
  });
});
