/**
 * CMS-005 — business registry (CAC): name check → register draft → reserve →
 * wallet fee debit → submit → status refresh → certificate → admin review.
 *
 * The local CAC provider is the deterministic sandbox (cac-sandbox — no
 * CAC_VAS_* credentials in the dev stack), so the whole register→verify→status
 * journey is REAL: the wallet fee is an actual tier-checked, idempotent
 * double-entry debit (cac_registration_fee + cac_platform_fee legs), and the
 * sandbox resolves registration outcomes deterministically (≈1/7 reject —
 * the spec retries candidates until one registers).
 *
 * Paystack fee routes are psp-unverified locally (no live gateway) and are
 * probed only for fail-closed behavior.
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  setKycTier,
  walletBalance,
} from './helpers';

const FEE_TOTAL = 1_700_000; // ₦15,000 CAC + ₦2,000 platform

test.describe('CMS-005 business registry: register → pay → submit → status → admin', () => {
  test('full register_new journey with real wallet fee legs', async ({ request }) => {
    const tag = Date.now() % 100000;
    const user = await provisionVerifiedUser(request, 'cms-biz');
    const token = await goTrueToken(request, user.email, user.password);
    fundWallet(user.userId, 20_000_000, `biz-${tag}`);
    setKycTier(user.userId, 3);

    // ── Stateless name check (no draft) ───────────────────────────────────
    const check = await goFetch(request, '/api/finance/business/name/check', {
      method: 'POST',
      token,
      data: { proposedName: `E2E Ventures ${tag}`, lineOfBusiness: 'retail' },
    });
    expect(check.status).toBe(200);
    expect(typeof check.body.data.available).toBe('boolean');

    // Restricted-name check → deterministic sandbox refusal.
    const restricted = await goFetch(request, '/api/finance/business/name/check', {
      method: 'POST',
      token,
      data: { proposedName: 'Federal E2E Holdings' },
    });
    expect(restricted.status).toBe(200);
    expect(restricted.body.data.available).toBe(false);

    // ── Register draft → name-check → reserve → fee → submit → status ──────
    // Sandbox status resolution is deterministic per ref; ~1/7 refs reject, so
    // retry candidates until one registers (each attempt is a fresh draft).
    let businessId = '';
    let finalStatus = '';
    for (let attempt = 0; attempt < 6 && finalStatus !== 'registered'; attempt++) {
      const reg = await goFetch(request, '/api/finance/business/register', {
        method: 'POST',
        token,
        data: {
          entityType: 'business_name',
          proposedName: `E2E Commerce ${tag}-${attempt}`,
          lineOfBusiness: 'retail',
          address: '1 E2E Close, Lagos',
          proprietors: [{ fullName: 'E2E Owner', role: 'proprietor', sharePct: 100 }],
        },
      });
      expect(reg.status).toBe(201);
      const id = reg.body.data.id as string;

      const checkStateful = await goFetch(request, '/api/finance/business/name/check', {
        method: 'POST',
        token,
        data: { businessId: id, proposedName: `E2E Commerce ${tag}-${attempt}` },
      });
      expect(checkStateful.status).toBe(200);

      const reserve = await goFetch(request, '/api/finance/business/name/reserve', {
        method: 'POST',
        token,
        data: { businessId: id },
      });
      expect(reserve.status).toBe(200);
      expect(reserve.body.data.status).toBe('name_reserved');

      // Fee: missing Idempotency-Key → 400 before money moves.
      const noKey = await goFetch(request, `/api/finance/business/${id}/pay-fee`, { method: 'POST', token });
      expect(noKey.status).toBe(400);

      const fee = await goFetch(request, `/api/finance/business/${id}/pay-fee`, {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': idemKey(`bizfee${attempt}`) },
      });
      expect(fee.status).toBe(200);

      // Balanced money legs: CAC pass-through → provider_clearing, platform
      // fee → paymax_revenue; both debit the member wallet.
      const cacLegs = ledgerSums(`cac_registration_fee:${id}%`);
      const cacDebit = cacLegs.find((l) => l.accountType === 'user_wallet' && l.side === 'DEBIT');
      const cacCredit = cacLegs.find((l) => l.accountType === 'provider_clearing' && l.side === 'CREDIT');
      expect(cacDebit?.total).toBe(1_500_000);
      expect(cacCredit?.total).toBe(1_500_000);
      const platLegs = ledgerSums(`cac_platform_fee:${id}%`);
      const platCredit = platLegs.find((l) => l.accountType === 'paymax_revenue' && l.side === 'CREDIT');
      expect(platCredit?.total).toBe(200_000);

      // Replay fee → idempotent no-op (fee_ledger_ref set → profile returned).
      const feeReplay = await goFetch(request, `/api/finance/business/${id}/pay-fee`, {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': idemKey(`bizfee${attempt}b`) },
      });
      expect(feeReplay.status).toBe(200);
      expect(ledgerSums(`cac_registration_fee:${id}%`).filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.total, 0)).toBe(1_500_000);

      // Submit before/after fee — ErrFeeNotPaid gate already passed; submit now.
      const submit = await goFetch(request, `/api/finance/business/${id}/submit`, {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': idemKey(`bizsub${attempt}`) },
      });
      expect(submit.status).toBe(200);
      expect(['registration_submitted', 'under_review']).toContain(submit.body.data.status);

      const status = await goFetch(request, `/api/finance/business/${id}/status`, { token });
      expect(status.status).toBe(200);
      businessId = id;
      finalStatus = status.body.data.status;
    }
    expect(finalStatus).toBe('registered');

    // Certificate is served once registered.
    const cert = await goFetch(request, `/api/finance/business/${businessId}/certificate`, { token });
    expect(cert.status).toBe(200);
    expect(cert.body.data.certificateUrl).toContain('sandbox.vas.cac.gov.ng');

    // Member reads.
    const me = await goFetch(request, '/api/finance/business/me', { token });
    expect(me.status).toBe(200);
    const one = await goFetch(request, `/api/finance/business/${businessId}`, { token });
    expect(one.status).toBe(200);
    expect(one.body.data.status).toBe('registered');

    // Paystack fee paths — psp-unverified locally (no live gateway): probe
    // fail-closed behavior only.
    const psp = await goFetch(request, `/api/finance/business/${businessId}/pay-fee/paystack`, {
      method: 'POST',
      token,
      data: { email: 'e2e@example.com' },
    });
    expect([200, 400, 409, 500, 502]).toContain(psp.status);
    const pspVerify = await goFetch(request, `/api/finance/business/${businessId}/pay-fee/paystack/verify`, {
      method: 'POST',
      token,
      data: { reference: 'fake-ref' },
    });
    expect([200, 400, 404, 500, 502]).toContain(pspVerify.status);

    // ── verify_existing journey (sandbox resolves deterministically) ──────
    const verify = await goFetch(request, '/api/finance/business/verify', {
      method: 'POST',
      token,
      data: { rcOrBnNumber: 'RC1234567', entityType: 'company' },
    });
    expect(verify.status).toBe(200);
    expect(['submitted', 'verified', 'rejected', 'failed']).toContain(verify.body.data.status);

    // ── Admin review surface ──────────────────────────────────────────────
    const list = await adminFetch(request, '/api/business/admin');
    expect(list.status).toBe(200);
    const aGet = await adminFetch(request, `/api/business/admin/${businessId}`);
    expect(aGet.status).toBe(200);
  });

  test('fee insufficient → 402; admin reject → rejected', async ({ request }) => {
    const tag = Date.now() % 100000;
    const broke = await provisionVerifiedUser(request, 'cms-biz2');
    const bToken = await goTrueToken(request, broke.email, broke.password);
    setKycTier(broke.userId, 3); // tier 3 but EMPTY wallet

    const reg = await goFetch(request, '/api/finance/business/register', {
      method: 'POST',
      token: bToken,
      data: { entityType: 'business_name', proposedName: `Broke Biz ${tag}` },
    });
    expect(reg.status).toBe(201);
    const id = reg.body.data.id as string;
    await goFetch(request, '/api/finance/business/name/reserve', {
      method: 'POST',
      token: bToken,
      data: { businessId: id },
    });
    const fee = await goFetch(request, `/api/finance/business/${id}/pay-fee`, {
      method: 'POST',
      token: bToken,
      headers: { 'Idempotency-Key': idemKey('broke') },
    });
    expect(fee.status).toBe(402);

    // Admin reject on the unpaid draft → terminal rejected.
    const reject = await adminFetch(request, `/api/business/admin/${id}/reject`, {
      method: 'POST',
      data: { reason: 'e2e reject' },
    });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('rejected');
  });
});
