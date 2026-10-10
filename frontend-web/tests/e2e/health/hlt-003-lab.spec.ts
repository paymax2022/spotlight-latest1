/**
 * HLT-003 — health lab vertical (app:health_lab).
 *
 * Real journey over the mounted routes (/api/finance/health/lab/* +
 * /api/health/lab/admin/*):
 *
 *   lab owner KYB (type=lab) → catalog upsert → patient order (WALK_IN, escrow
 *   HELD, idempotent) → owner schedule → owner collect (sample + chain of
 *   custody opens) → owner accessions (barcode-verified) → enters validated
 *   results → releases (vault record + escrow RELEASE → CLOSED).
 *   Plus: custody read, results read, provider orders, cancel→refund, admin.
 *
 * HL-2 gates — INTERIM: there is no staff↔lab affiliation model (a
 * lab_scientist/phlebotomist health_providers row is a self-owned capability
 * naming no employing lab), so provider-scoped staff ops resolve to the lab
 * owner only. Users holding standalone lab_scientist/phlebotomist
 * capabilities are DENIED on this lab's orders — asserted below. Restore
 * separate staff actors when the affiliation model lands.
 * HL-10: lab owner KYC tier ≥1 before payout release (fixture setKycTier).
 */

import { expect, test } from '@playwright/test';

import {
  fundWallet,
  goFetch,
  goTrueToken,
  healthAdminToken,
  idemKey,
  ledgerSums,
  onboardProvider,
  provisionVerifiedUser,
  setKycTier,
} from './helpers';

const TEST_PRICE_KOBO = 400_000; // ₦4,000
const FUND_KOBO = 5_000_000;

test.describe('HLT-003 lab order lifecycle', () => {
  test('KYB → catalog → order (HELD) → collect → accession → results → release (RELEASE) + custody', async ({
    request,
  }) => {
    const tag = `${Date.now() % 100000}`;

    // Lab owner: KYB type=lab + KYC for HL-10 payout.
    const owner = await provisionVerifiedUser(request, `hlt003-own-${tag}`);
    const ownerToken = await goTrueToken(request, owner.email, owner.password);
    setKycTier(owner.userId, 3);
    const { providerId } = await onboardProvider(request, ownerToken, {
      domain: 'LAB',
      providerType: 'lab',
      displayName: `E2E Lab ${tag}`,
    });

    // Capability holders who own NO staff relationship to this lab: under the
    // interim owner-only gate their tokens must be refused on every staff op.
    const scientist = await provisionVerifiedUser(request, `hlt003-sci-${tag}`);
    const sciToken = await goTrueToken(request, scientist.email, scientist.password);
    await onboardProvider(request, sciToken, {
      domain: 'LAB',
      providerType: 'lab_scientist',
      displayName: `E2E Scientist ${tag}`,
    });
    const phleb = await provisionVerifiedUser(request, `hlt003-phl-${tag}`);
    const phlebToken = await goTrueToken(request, phleb.email, phleb.password);
    await onboardProvider(request, phlebToken, {
      domain: 'LAB',
      providerType: 'phlebotomist',
      displayName: `E2E Phlebotomist ${tag}`,
    });

    // Catalog: owner upserts a test (prep/TAT/price governance).
    const upserted = await goFetch(request, '/api/finance/health/lab/tests', {
      method: 'POST',
      token: ownerToken,
      data: {
        lab_provider_id: providerId,
        code: `FBC-${tag}`,
        name: 'Full Blood Count',
        specimen: 'BLOOD',
        prep_instructions: 'none',
        tat_hours: 24,
        ref_range: '4.0-11.0 x10^9/L',
        price_kobo: TEST_PRICE_KOBO,
        active: true,
      },
    });
    expect(upserted.status).toBe(201);
    const testId = upserted.body.test.id as string;

    const patient = await provisionVerifiedUser(request, `hlt003-pat-${tag}`);
    const patientToken = await goTrueToken(request, patient.email, patient.password);
    setKycTier(patient.userId, 3);
    fundWallet(patient.userId, FUND_KOBO, `hlt003-${tag}`);

    const catalog = await goFetch(request, `/api/finance/health/lab/tests?lab_provider_id=${providerId}`, {
      token: patientToken,
    });
    expect(catalog.status).toBe(200);
    const packages = await goFetch(request, `/api/finance/health/lab/packages?lab_provider_id=${providerId}`, {
      token: patientToken,
    });
    expect(packages.status).toBe(200);

    // Order: WALK_IN, payment HELD.
    const idem = idemKey(`lab-${tag}`);
    const order = await goFetch(request, '/api/finance/health/lab/orders', {
      method: 'POST',
      token: patientToken,
      data: {
        lab_provider_id: providerId,
        collection_method: 'WALK_IN',
        idempotency_key: idem,
        test_ids: [testId],
      },
    });
    expect(order.status).toBe(201);
    const orderId = order.body.order.id as string;
    expect(order.body.order.total_kobo).toBe(TEST_PRICE_KOBO);

    // Balanced hold legs.
    const holdLegs = ledgerSums(`%lab:${orderId}%`);
    const cr = holdLegs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const dr = holdLegs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(cr, 'lab escrow hold legs unbalanced').toBe(dr);

    // Replay → same order, no second hold.
    const replay = await goFetch(request, '/api/finance/health/lab/orders', {
      method: 'POST',
      token: patientToken,
      data: {
        lab_provider_id: providerId,
        collection_method: 'WALK_IN',
        idempotency_key: idem,
        test_ids: [testId],
      },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(orderId);

    // Provider order queue + patient history + order read.
    const providerOrders = await goFetch(request, `/api/finance/health/lab/provider/orders?lab_provider_id=${providerId}`, {
      token: ownerToken,
    });
    expect(providerOrders.status).toBe(200);
    const myOrders = await goFetch(request, '/api/finance/health/lab/orders', { token: patientToken });
    expect(myOrders.status).toBe(200);
    const orderGet = await goFetch(request, `/api/finance/health/lab/orders/${orderId}`, { token: patientToken });
    expect(orderGet.status).toBe(200);

    // Owner schedules the WALK_IN visit.
    const scheduled = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/schedule`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(scheduled.status).toBe(200);

    // Lab intake collects the sample (WALK_IN — no phlebotomist gate), minting
    // the barcode + opening the immutable custody chain.
    const collected = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/collect`, {
      method: 'POST',
      token: ownerToken,
      data: { note: 'walk-in collection' },
    });
    expect(collected.status).toBe(201);
    const sampleId = collected.body.sample.id as string;
    const barcode = collected.body.sample.barcode_ref as string;
    expect(barcode).toBeTruthy();

    // Custody trail is already readable (immutable log, HL-6/HL-12).
    const custody0 = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/custody`, {
      token: patientToken,
    });
    expect(custody0.status).toBe(200);

    // Custody handover (HL-6): COLLECTED → HANDED_OVER. Capability-holding
    // strangers (scientist/phlebotomist of OTHER labs — there is no
    // affiliation to scope them to this one) must be refused with the uniform
    // not-found denial; only the lab owner can hand over under the interim.
    const deniedHandover = await goFetch(request, `/api/finance/health/lab/samples/${sampleId}/handover`, {
      method: 'POST',
      token: sciToken,
      data: { to_custodian_id: scientist.userId, note: 'e2e denied' },
    });
    expect([404]).toContain(deniedHandover.status);
    const deniedHandover2 = await goFetch(request, `/api/finance/health/lab/samples/${sampleId}/handover`, {
      method: 'POST',
      token: phlebToken,
      data: { to_custodian_id: phleb.userId, note: 'e2e denied' },
    });
    expect([404]).toContain(deniedHandover2.status);
    const handover = await goFetch(request, `/api/finance/health/lab/samples/${sampleId}/handover`, {
      method: 'POST',
      token: ownerToken,
      data: { to_custodian_id: owner.userId, note: 'e2e bench handover' },
    });
    expect([200, 201]).toContain(handover.status);

    // Accession (EC-001 barcode gate): foreign staff are refused (404 — no
    // sample-existence oracle); the owner's wrong scan refuses on the barcode
    // mismatch; the owner's correct scan accessions.
    const deniedAccession = await goFetch(request, `/api/finance/health/lab/samples/${sampleId}/accession`, {
      method: 'POST',
      token: sciToken,
      data: { note: 'e2e denied', scanned_barcode: barcode },
    });
    expect([404]).toContain(deniedAccession.status);
    const badScan = await goFetch(request, `/api/finance/health/lab/samples/${sampleId}/accession`, {
      method: 'POST',
      token: ownerToken,
      data: { note: 'e2e', scanned_barcode: 'WRONG-BARCODE' },
    });
    expect([400, 409, 422]).toContain(badScan.status);
    const accessioned = await goFetch(request, `/api/finance/health/lab/samples/${sampleId}/accession`, {
      method: 'POST',
      token: ownerToken,
      data: { note: 'accession e2e', scanned_barcode: barcode },
    });
    expect(accessioned.status).toBe(200);
    expect(accessioned.body.sample.state).toBe('ACCESSIONED');

    // Owner enters validated results (barcode re-verified, LR-001). A
    // capability-holding stranger is refused (404 — no order-existence oracle).
    const deniedResults = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/results`, {
      method: 'POST',
      token: sciToken,
      data: {
        scanned_barcode: barcode,
        results: [{ test_id: testId, value: '9.9', unit: 'x10^9/L', ref_range: '4.0-11.0', status: 'NORMAL' }],
      },
    });
    expect([404]).toContain(deniedResults.status);
    const results = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/results`, {
      method: 'POST',
      token: ownerToken,
      data: {
        scanned_barcode: barcode,
        results: [{ test_id: testId, value: '6.2', unit: 'x10^9/L', ref_range: '4.0-11.0', status: 'NORMAL' }],
      },
    });
    expect(results.status).toBe(200);

    // Owner signs off → vault record + escrow release (HL-7/8/9/10). A
    // capability-holding stranger must not reach the money leg.
    const deniedRelease = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/release`, {
      method: 'POST',
      token: sciToken,
    });
    expect([404]).toContain(deniedRelease.status);
    const released = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/release`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(released.status).toBe(200);
    expect(['RELEASED', 'CLOSED']).toContain(released.body.order.state);

    // Patient reads results + full custody chain.
    const res = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/results`, { token: patientToken });
    expect(res.status).toBe(200);
    const custody = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/custody`, { token: patientToken });
    expect(custody.status).toBe(200);
    expect((custody.body.events ?? custody.body.custody ?? []).length).toBeGreaterThanOrEqual(1);

    // Admin oversight.
    const admin = await healthAdminToken(request);
    const dash = await goFetch(request, '/api/health/lab/admin/dashboard', { token: admin });
    expect(dash.status).toBe(200);
    const adminOrders = await goFetch(request, '/api/health/lab/admin/orders', { token: admin });
    expect(adminOrders.status).toBe(200);
    const custodyAudit = await goFetch(request, `/api/health/lab/admin/custody-audit?sample_id=${sampleId}`, {
      token: admin,
    });
    expect(custodyAudit.status).toBe(200);
    const escalations = await goFetch(request, '/api/health/lab/admin/escalations', { token: admin });
    expect(escalations.status).toBe(200);
  });

  test('cancel before collection refunds the held payment (HL-9)', async ({ request }) => {
    const tag = `c${Date.now() % 100000}`;
    const owner = await provisionVerifiedUser(request, `hlt003-co-${tag}`);
    const ownerToken = await goTrueToken(request, owner.email, owner.password);
    const { providerId } = await onboardProvider(request, ownerToken, {
      domain: 'LAB',
      providerType: 'lab',
      displayName: `E2E Lab Cancel ${tag}`,
    });
    const upserted = await goFetch(request, '/api/finance/health/lab/tests', {
      method: 'POST',
      token: ownerToken,
      data: {
        lab_provider_id: providerId,
        code: `CX-${tag}`,
        name: 'E2E Cancel Test',
        price_kobo: 100_000,
        active: true,
      },
    });
    expect(upserted.status).toBe(201);

    const patient = await provisionVerifiedUser(request, `hlt003-pc-${tag}`);
    const patientToken = await goTrueToken(request, patient.email, patient.password);
    setKycTier(patient.userId, 3);
    fundWallet(patient.userId, FUND_KOBO, `hlt003c-${tag}`);

    const order = await goFetch(request, '/api/finance/health/lab/orders', {
      method: 'POST',
      token: patientToken,
      data: {
        lab_provider_id: providerId,
        collection_method: 'WALK_IN',
        idempotency_key: idemKey(`labc-${tag}`),
        test_ids: [upserted.body.test.id],
      },
    });
    expect(order.status).toBe(201);
    const orderId = order.body.order.id as string;

    const cancelled = await goFetch(request, `/api/finance/health/lab/orders/${orderId}/cancel`, {
      method: 'POST',
      token: patientToken,
      data: { reason: 'E2E cancel' },
    });
    expect(cancelled.status).toBe(200);
    const legs = ledgerSums(`%lab:${orderId}%`);
    const cr = legs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const dr = legs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(cr).toBe(dr); // hold + refund legs net out
  });
});
