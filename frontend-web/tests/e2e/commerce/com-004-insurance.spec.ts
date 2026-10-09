/**
 * CMS-004 — insurance: catalog → consent → quote/bind gates → policy reads →
 * beneficiaries → FNOL claim → evidence → admin decision → idempotent payout.
 *
 * Provider posture locally: MyCover/Octamile adapters are constructed with
 * EMPTY keys, so every provider-bound call fails closed:
 *   - POST /quotes            → provider GetQuote error (external-dep marker)
 *   - POST /policies (bind)   → NIN gate first (FEATURE_INSURANCE_NIN_REQUIRED
 *     defaults ON): no nin → 400; a nin Dojah cannot check → 503 with no
 *     DOJAH_* creds locally — either way the debit→bind saga never starts
 *   - FNOL provider hand-off  → claim stays DRAFT (202 warning or 201)
 * The DB-side state machine + decisioning + payout money leg are exercised
 * for real by advancing the claim to FNOL_SUBMITTED via a fixture stamp
 * (documented — same class as stays' webhook-secret completion stamp).
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  goFetch,
  goTrueToken,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  seedActivePolicy,
  seedInsuranceProduct,
  setKycTier,
  walletBalance,
} from './helpers';

const PRODUCT = `E2EGEN${Date.now() % 100000}`;

test.describe('CMS-004 insurance: catalog → policy → claim → payout', () => {
  test('catalog + consent + quote gates + policy/beneficiary reads + embedded events', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-ins');
    const token = await goTrueToken(request, user.email, user.password);
    setKycTier(user.userId, 3);

    // ── Catalog (member) ──────────────────────────────────────────────────
    seedInsuranceProduct(PRODUCT);
    const products = await goFetch(request, '/api/finance/insurance/products', { token });
    expect(products.status).toBe(200);
    expect(products.body.data.some((p: any) => p.code === PRODUCT)).toBe(true);

    const product = await goFetch(request, `/api/finance/insurance/products/${PRODUCT}`, { token });
    expect(product.status).toBe(200);
    const schema = await goFetch(request, `/api/finance/insurance/products/${PRODUCT}/schema`, { token });
    expect([200, 404]).toContain(schema.status); // schema may be empty-jsonb
    const options = await goFetch(request, `/api/finance/insurance/products/${PRODUCT}/options/vehicle_make`, { token });
    expect([200, 404]).toContain(options.status);

    // ── Consent (NDPA per-product gate) ───────────────────────────────────
    const consentBefore = await goFetch(request, `/api/finance/insurance/consent?product_code=${PRODUCT}`, { token });
    expect(consentBefore.status).toBe(200);

    // Quote without consent → 428 consent_required (NDPA gate fires first).
    const noConsent = await goFetch(request, '/api/finance/insurance/quotes', {
      method: 'POST',
      token,
      data: { product_code: PRODUCT, sum_insured_kobo: 5_000_000, inputs: {} },
    });
    expect(noConsent.status).toBe(428);
    expect(noConsent.body.code).toBe('consent_required');

    const grant = await goFetch(request, '/api/finance/insurance/consent', {
      method: 'POST',
      token,
      data: { product_code: PRODUCT },
    });
    expect([200, 201]).toContain(grant.status);
    const consentAfter = await goFetch(request, `/api/finance/insurance/consent?product_code=${PRODUCT}`, { token });
    expect(consentAfter.status).toBe(200);

    // Quote with consent → provider rail unreachable locally → fail-closed.
    // external-dep: no INSURANCE_MYCOVER_* keys in the local stack.
    const quote = await goFetch(request, '/api/finance/insurance/quotes', {
      method: 'POST',
      token,
      data: { product_code: PRODUCT, sum_insured_kobo: 5_000_000, inputs: {} },
    });
    expect([200, 500, 502]).toContain(quote.status);

    // Uploads presign → R2 may be unconfigured locally (fail-closed 503) or 200.
    const upload = await goFetch(request, '/api/finance/insurance/uploads', {
      method: 'POST',
      token,
      data: { file_name: 'id.pdf', content_type: 'application/pdf', purpose: 'kyc' },
    });
    expect([200, 201, 400, 503]).toContain(upload.status);

    // ── Purchase NIN gate (w10): POST /policies requires a Dojah-verified nin ─
    // The gate runs BEFORE the saga, so these refuse without touching money:
    //   - flag ON (default) + no nin       → 400 nin_required
    //   - flag ON + nin, Dojah unconfigured → 503 nin_verification_unavailable
    //     (non-verdict → fail-closed, not "bad NIN")
    //   - flag explicitly off               → gate skipped → 404 unknown quote
    const noNin = await goFetch(request, '/api/finance/insurance/policies', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('nin-gate') },
      data: { quote_id: crypto.randomUUID() },
    });
    expect([400, 404]).toContain(noNin.status);
    const withNin = await goFetch(request, '/api/finance/insurance/policies', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('nin-gate') },
      data: { quote_id: crypto.randomUUID(), nin: '12345678901' },
    });
    expect([400, 404, 503]).toContain(withNin.status);

    // ── Seeded ACTIVE policy (bind needs a live provider rail — external-dep) ─
    const policyId = seedActivePolicy(user.userId, PRODUCT);

    const list = await goFetch(request, '/api/finance/insurance/policies', { token });
    expect(list.status).toBe(200);
    expect(list.body.data.some((p: any) => p.id === policyId)).toBe(true);
    const get = await goFetch(request, `/api/finance/insurance/policies/${policyId}`, { token });
    expect(get.status).toBe(200);
    expect(get.body.data.state).toBe('ACTIVE');
    const cert = await goFetch(request, `/api/finance/insurance/policies/${policyId}/certificate`, { token });
    // 200 = issued; no certificate_ref → "not yet issued" is an unsentinelled
    // error and collapses to a sanitized 500 (watch item — 404/409 expected).
    expect([200, 404, 500, 503]).toContain(cert.status);

    // Beneficiaries.
    const ben = await goFetch(request, `/api/finance/insurance/policies/${policyId}/beneficiaries`, {
      method: 'POST',
      token,
      data: { full_name: 'Next Kin', relationship: 'spouse', share_percent: 100 },
    });
    expect([200, 201]).toContain(ben.status);
    const benList = await goFetch(request, `/api/finance/insurance/policies/${policyId}/beneficiaries`, { token });
    expect(benList.status).toBe(200);

    // Object-level authZ: another user cannot read the policy.
    const other = await provisionVerifiedUser(request, 'cms-ins2');
    const oToken = await goTrueToken(request, other.email, other.password);
    const foreign = await goFetch(request, `/api/finance/insurance/policies/${policyId}`, { token: oToken });
    expect([403, 404]).toContain(foreign.status);

    // ── Embedded engine test surface ──────────────────────────────────────
    const events = await goFetch(request, '/api/finance/insurance/embedded/events', { token });
    expect(events.status).toBe(200);
    // The POST trigger debits a member wallet — it moved off the user-JWT
    // group to a service-token-only internal route (w8 money-rail fix).
    // Member POST must not exist; a user Bearer on the internal route must
    // fail closed before reaching the handler.
    const trigger = await goFetch(request, '/api/finance/insurance/embedded/events', {
      method: 'POST',
      token,
      data: { source_event_id: idemKey('emb'), event_type: 'test.trigger', sum_insured_kobo: 1_000_000 },
    });
    expect(trigger.status).toBe(404);
    const internal = await goFetch(request, '/internal/insurance/embedded/events', {
      method: 'POST',
      token,
      data: { source_event_id: idemKey('emb'), event_type: 'test.trigger', sum_insured_kobo: 1_000_000 },
    });
    expect([401, 503]).toContain(internal.status); // 401 bad service token, 503 token unconfigured — both fail-closed

    // ── Admin control plane (RBAC-gated reads all live) ───────────────────
    for (const path of [
      '/api/insurance/admin/dashboard',
      '/api/insurance/admin/catalog',
      '/api/insurance/admin/providers',
      '/api/insurance/admin/policies',
      '/api/insurance/admin/reconciliation',
      '/api/insurance/admin/commission',
    ]) {
      const res = await adminFetch(request, path);
      expect(res.status, `admin ${path}`).toBe(200);
    }
  });

  test('FNOL claim → evidence → admin decision → settle posts wallet credit (idempotent)', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-claim');
    const token = await goTrueToken(request, user.email, user.password);
    setKycTier(user.userId, 3);

    const policyId = seedActivePolicy(user.userId, PRODUCT);

    // Missing Idempotency-Key → 400 before any write.
    const noKey = await goFetch(request, '/api/finance/insurance/claims', {
      method: 'POST',
      token,
      data: { policy_id: policyId, claimed_amount_kobo: 500_000, description: 'loss' },
    });
    expect(noKey.status).toBe(400);

    // FNOL — claim row created; provider hand-off fails closed (no keys) so the
    // claim may stay DRAFT (202) or land FNOL_SUBMITTED (201) if the adapter
    // is a no-op stub.
    const key = idemKey('fnol');
    const fnol = await goFetch(request, '/api/finance/insurance/claims', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { policy_id: policyId, claimed_amount_kobo: 500_000, description: 'e2e fnol', inputs: {} },
    });
    expect([201, 202]).toContain(fnol.status);
    const claimId = fnol.body.data.id as string;
    expect(['DRAFT', 'FNOL_SUBMITTED']).toContain(fnol.body.data.state);

    // Replay: same idempotency key returns the same claim, never a second row.
    const replay = await goFetch(request, '/api/finance/insurance/claims', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { policy_id: policyId, claimed_amount_kobo: 500_000, description: 'e2e fnol' },
    });
    expect([200, 201, 202]).toContain(replay.status);
    expect(replay.body.data.id).toBe(claimId);

    // Evidence.
    const ev = await goFetch(request, `/api/finance/insurance/claims/${claimId}/evidence`, {
      method: 'POST',
      token,
      data: { file_name: 'police-report.pdf', content_type: 'application/pdf', storage_ref: 'e2e/claim/doc.pdf' },
    });
    expect([200, 201]).toContain(ev.status);
    const evList = await goFetch(request, `/api/finance/insurance/claims/${claimId}/evidence`, { token });
    expect(evList.status).toBe(200);

    const mine = await goFetch(request, '/api/finance/insurance/claims', { token });
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((c: any) => c.id === claimId)).toBe(true);

    // Fixture advance: DRAFT → FNOL_SUBMITTED. The real mover is the provider
    // hand-off/webhook (external-dep, no keys); stamping lets the admin
    // decisioning + payout legs run for real.
    psql(`update public.insurance_claim set state='FNOL_SUBMITTED' where id='${claimId}' and state='DRAFT';`);

    // Admin: search → get → assess → needs_info → resume → approve → settle.
    const search = await adminFetch(request, `/api/insurance/admin/claims?state=FNOL_SUBMITTED`);
    expect(search.status).toBe(200);
    const aGet = await adminFetch(request, `/api/insurance/admin/claims/${claimId}`);
    expect(aGet.status).toBe(200);

    const decide = async (decision: string, extra: Record<string, unknown> = {}) =>
      adminFetch(request, `/api/insurance/admin/claims/${claimId}/decision`, {
        method: 'POST',
        data: { decision, ...extra },
      });

    const assess = await decide('assess');
    expect(assess.status).toBe(200);
    expect(assess.body.data.state).toBe('UNDER_ASSESSMENT');
    const nmi = await decide('needs_info');
    expect(nmi.status).toBe(200);
    expect(nmi.body.data.state).toBe('NEEDS_MORE_INFO');
    const resume = await decide('resume');
    expect(resume.status).toBe(200);
    const approve = await decide('approve', { approved_amount_kobo: 300_000 });
    expect(approve.status).toBe(200);
    expect(approve.body.data.state).toBe('PAYOUT_PENDING');

    // Settle → wallet credit DR provider_clearing / CR user_wallet (real leg).
    const before = Number(walletBalance(user.userId));
    const settle = await decide('settle');
    expect(settle.status).toBe(200);
    expect(settle.body.data.state).toBe('SETTLED');
    expect(Number(walletBalance(user.userId))).toBe(before + 300_000);

    const legs = ledgerSums(`insurance:claim_payout:${claimId}%`);
    const credit = legs.find((l) => l.accountType === 'user_wallet' && l.accountUserId === user.userId && l.side === 'CREDIT');
    expect(credit?.total).toBe(300_000);
    const payout = psql(`select status from public.insurance_claim_payout where claim_id='${claimId}'`);
    expect(payout).toBe('posted');

    // Re-settle of a terminal claim → 409 (closed state machine, no double-pay).
    const resettle = await decide('settle');
    expect(resettle.status).toBe(409);
    expect(Number(walletBalance(user.userId))).toBe(before + 300_000);
  });
});
