/**
 * CMS-003 — stays: review lock (REVIEW_LOCKED) → verified-guest review →
 * hotelier response → admin moderation → payout queue/release (PAYOUT_HELD
 * gate) → commission accrual → remittance match/break → agent channel.
 *
 * Fixtures: reservations are seeded at PREBOOK_OK (helpers.seedPrebookedReservation).
 * The /book saga, reviews, settlement admin surfaces, and payout ledger legs are
 * all real.
 *
 * Also proves the property_id ambiguity is RESOLVED end-to-end: the live mobile
 * client (features/stays/api.ts) sends the SUPPLIER property ref as property_id,
 * so a reservation written through that contract leaves res.property_id =
 * supplier ref — while settlement payouts key on the INTERNAL stays_property.id.
 * HasCompletedStay now resolves the payout's property row and matches
 * reservations by p.id OR p.supplier_property_ref, so a completed stay under
 * either identifier releases the payout.
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  completeStaysReservation,
  datePlus,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  onboardStaysProperty,
  provisionVerifiedUser,
  psql,
  pushAvailability,
  seedPrebookedReservation,
  setKycTier,
  walletBalance,
} from './helpers';

const GROSS = 5_000_000; // 1 night at the onboarded BAR rate

async function bookSeeded(
  request: Parameters<typeof goFetch>[0],
  token: string,
  email: string,
  reservationId: string,
  bookToken: string,
  key: string,
) {
  const book = await goFetch(request, '/api/finance/stays/book', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': key },
    data: {
      reservation_id: reservationId,
      book_token: bookToken,
      guest: { first_name: 'E2E', last_name: 'Guest', email },
    },
  });
  expect(book.status).toBe(201);
  return book.body.data;
}

test.describe('CMS-003 stays: review lock → verified review → settlement/payout', () => {
  test('review unlocks only after COMPLETED; payout releases on internal property_id', async ({
    request,
  }) => {
    const tag = `r${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-hr');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const guest = await provisionVerifiedUser(request, 'cms-gr');
    const gToken = await goTrueToken(request, guest.email, guest.password);

    const supply = await onboardStaysProperty(request, hToken, tag);
    fundWallet(guest.userId, 20_000_000, `stayr-${tag}`);
    setKycTier(guest.userId, 3);
    await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: gToken, data: {} });

    const ci = datePlus(42);
    const co = datePlus(43);
    await pushAvailability(request, hToken, supply.roomTypeId, [ci], 3);

    // Internal property_id — the canonical storage (extranet/payout key on it).
    const seeded = seedPrebookedReservation(guest.userId, supply, ci, co, GROSS, {
      commissionKobo: 500_000,
    });
    const resId = seeded.reservationId;
    await bookSeeded(request, gToken, guest.email, resId, seeded.bookToken, idemKey('s3-book'));

    // Review lock: eligibility + create must refuse before COMPLETED.
    const eligBefore = await goFetch(request, `/api/finance/stays/reservations/${resId}/review-eligibility`, {
      token: gToken,
    });
    expect(eligBefore.status).toBe(200);
    expect(eligBefore.body.data.can_review).toBe(false);
    const locked = await goFetch(request, `/api/finance/stays/reservations/${resId}/review`, {
      method: 'POST',
      token: gToken,
      data: { overall_score: 5, title: 'Too early', body: 'nope' },
    });
    expect(locked.status).toBe(412);
    expect(locked.body.code).toBe('REVIEW_LOCKED'); // authored code survives the envelope

    // Complete the stay (fixture — real surface is the HMAC supplier webhook,
    // fail-closed locally: STAYS_SUPPLIER_WEBHOOK_SECRET unset).
    completeStaysReservation(resId);

    const elig = await goFetch(request, `/api/finance/stays/reservations/${resId}/review-eligibility`, { token: gToken });
    expect(elig.status).toBe(200);
    expect(elig.body.data.can_review).toBe(true);

    const review = await goFetch(request, `/api/finance/stays/reservations/${resId}/review`, {
      method: 'POST',
      token: gToken,
      data: { overall_score: 5, sub_scores: { cleanliness: 5, service: 4 }, title: 'Great stay', body: 'Loved it.' },
    });
    expect(review.status).toBe(201);
    const reviewId = review.body.data.id as string;

    // Duplicate review → ALREADY_REVIEWED (409).
    const dup = await goFetch(request, `/api/finance/stays/reservations/${resId}/review`, {
      method: 'POST',
      token: gToken,
      data: { overall_score: 1, title: 'dupe', body: 'dupe' },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ALREADY_REVIEWED');

    // Member review surfaces.
    const mine = await goFetch(request, '/api/finance/stays/reviews-mine', { token: gToken });
    expect(mine.status).toBe(200);
    const byProp = await goFetch(request, `/api/finance/stays/reviews?property_id=${supply.propertyId}`, { token: gToken });
    expect(byProp.status).toBe(200);

    // Hotelier: list, respond, flag.
    const hReviews = await goFetch(request, `/api/stays/extranet/properties/${supply.propertyId}/reviews`, {
      token: hToken,
    });
    expect(hReviews.status).toBe(200);
    const respond = await goFetch(request, `/api/stays/extranet/reviews/${reviewId}/response`, {
      method: 'POST',
      token: hToken,
      data: { body: 'Thank you for staying with us!' },
    });
    expect([200, 201]).toContain(respond.status);
    const rsp = await goFetch(request, `/api/finance/stays/review-response?review_id=${reviewId}`, { token: gToken });
    expect(rsp.status).toBe(200);
    const flag = await goFetch(request, `/api/stays/extranet/reviews/${reviewId}/flag`, {
      method: 'POST',
      token: hToken,
      data: { reason: 'test flag' },
    });
    expect([200, 201]).toContain(flag.status);

    // Admin: property review list + moderation.
    const aRev = await adminFetch(request, `/api/stays/admin/reviews?property_id=${supply.propertyId}`);
    expect(aRev.status).toBe(200);
    const mod = await adminFetch(request, `/api/stays/admin/reviews/${reviewId}/moderate`, {
      method: 'POST',
      data: { status: 'PUBLISHED', reason: 'e2e' },
    });
    expect([200, 201]).toContain(mod.status);

    // ── Settlement: commission + remittance + payout release ──────────────
    const commList = await adminFetch(request, '/api/stays/admin/commission');
    expect(commList.status).toBe(200);

    const accrue = await adminFetch(request, '/api/stays/admin/commission/accrue', {
      method: 'POST',
      data: { reservation_id: resId, amount_kobo: 100_000, idempotency_key: idemKey('accrue') },
    });
    expect([200, 201]).toContain(accrue.status);

    // Remittance: ingest + list (+ resolve if the line broke).
    const rem = await adminFetch(request, '/api/stays/admin/remittances/ingest', {
      method: 'POST',
      data: { supplier_code: 'self', reservation_id: resId, external_ref: `rem-${tag}`, remitted_kobo: 1, idempotency_key: idemKey('rem') },
    });
    expect([200, 201]).toContain(rem.status);
    const remList = await adminFetch(request, '/api/stays/admin/remittances');
    expect(remList.status).toBe(200);

    // Queue a payout for the hotelier (real admin surface → HELD row).
    const qp = await adminFetch(request, '/api/stays/admin/payouts/queue', {
      method: 'POST',
      data: {
        property_id: supply.propertyId,
        hotelier_user_id: hotelier.userId,
        reservation_id: resId,
        amount_kobo: 1_000_000,
        idempotency_key: idemKey('payout'),
      },
    });
    expect([200, 201]).toContain(qp.status);
    const payoutList = await adminFetch(request, '/api/stays/admin/payouts');
    expect(payoutList.status).toBe(200);
    const payout = (payoutList.body.data ?? []).find((p: any) => p.property_id === supply.propertyId);
    expect(payout, 'queued payout').toBeTruthy();

    // Release: the property HAS a COMPLETED stay keyed on the internal id →
    // PAID + real ledger credit to the hotelier wallet from provider_clearing.
    const rel = await adminFetch(request, `/api/stays/admin/payouts/${payout.id}/release`, { method: 'POST' });
    expect(rel.status).toBe(200);
    expect(rel.body.data.status).toBe('PAID');
    expect(Number(walletBalance(hotelier.userId))).toBe(1_000_000);

    // Idempotent re-release → still PAID, no double credit.
    const rel2 = await adminFetch(request, `/api/stays/admin/payouts/${payout.id}/release`, { method: 'POST' });
    expect(rel2.status).toBe(200);
    expect(Number(walletBalance(hotelier.userId))).toBe(1_000_000);
  });

  test('property_id ambiguity: completed stay stored under the supplier ref still releases the payout (E2E-CMS-004 fixed)', async ({ request }) => {
    const tag = `x${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-hx');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const guest = await provisionVerifiedUser(request, 'cms-gx');
    const gToken = await goTrueToken(request, guest.email, guest.password);

    const supply = await onboardStaysProperty(request, hToken, tag);
    fundWallet(guest.userId, 15_000_000, `stayx-${tag}`);
    setKycTier(guest.userId, 3);
    await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: gToken, data: {} });

    const ci = datePlus(46);
    const co = datePlus(47);
    await pushAvailability(request, hToken, supply.roomTypeId, [ci], 3);

    // The mobile-client contract: property_id carries the SUPPLIER ref.
    const seeded = seedPrebookedReservation(guest.userId, supply, ci, co, GROSS, {
      propertyIdOverride: supply.supplierPropertyRef,
    });
    const resId = seeded.reservationId;
    await bookSeeded(request, gToken, guest.email, resId, seeded.bookToken, idemKey('s3x-book'));
    completeStaysReservation(resId);

    // The stay is COMPLETED — but under the supplier ref, not the internal id.
    expect(psql(`select property_id from public.stays_reservation where id='${resId}'`)).toBe(
      supply.supplierPropertyRef,
    );

    const qp = await adminFetch(request, '/api/stays/admin/payouts/queue', {
      method: 'POST',
      data: {
        property_id: supply.propertyId, // admin queues on the INTERNAL id
        hotelier_user_id: hotelier.userId,
        reservation_id: resId,
        amount_kobo: 500_000,
        idempotency_key: idemKey('payoutx'),
      },
    });
    expect([200, 201]).toContain(qp.status);

    // E2E-CMS-004 fixed: HasCompletedStay resolves the payout's internal
    // property row and matches reservations by p.id OR p.supplier_property_ref,
    // so the supplier-ref-stored COMPLETED stay satisfies the fraud gate →
    // PAID + a real ledger credit to the hotelier wallet.
    const rel = await adminFetch(request, `/api/stays/admin/payouts/${qp.body.data.id}/release`, { method: 'POST' });
    expect(rel.status).toBe(200);
    expect(rel.body.data.status).toBe('PAID');
    expect(Number(walletBalance(hotelier.userId))).toBe(500_000);
  });

  test('agent channel: seeded quote → agent/book → bookings → commissions', async ({ request }) => {
    const tag = `a${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-ha');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const agent = await provisionVerifiedUser(request, 'cms-agent');
    const aToken = await goTrueToken(request, agent.email, agent.password);

    const supply = await onboardStaysProperty(request, hToken, tag);
    const ci = datePlus(49);
    const co = datePlus(50);
    await pushAvailability(request, hToken, supply.roomTypeId, [ci], 2);

    fundWallet(agent.userId, 15_000_000, `agent-${tag}`);
    setKycTier(agent.userId, 3);
    await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: aToken, data: {} });

    // E2E-CMS-001 fixed: agent/quote runs the same reservation insert that now
    // persists a non-NULL cancellation snapshot → real 200 + book_token.
    const quote = await goFetch(request, '/api/finance/stays/agent/quote', {
      method: 'POST',
      token: aToken,
      data: {
        customer_name: 'Walk In Customer',
        customer_contact: 'walkin@example.com',
        rail: 'DIRECT',
        supplier_code: 'self',
        property_id: supply.propertyId,
        room_type_id: supply.roomTypeId,
        rate_plan_id: supply.ratePlanId,
        supplier_property_ref: supply.supplierPropertyRef,
        supplier_room_type_ref: `rt-${tag}`,
        supplier_rate_plan_ref: `rp-${tag}`,
        check_in: ci,
        check_out: co,
        rooms: 1,
        payment_method: 'WALLET',
      },
    });
    expect(quote.status).toBe(200);
    expect(quote.body.data.book_token).toBeTruthy();
    expect(quote.body.data.reservation_id).toBeTruthy();

    // Seeded PREBOOK_OK (agent is the reservation owner) → real agent/book.
    const seeded = seedPrebookedReservation(agent.userId, supply, ci, co, GROSS, {
      commissionKobo: 500_000,
    });
    const resId = seeded.reservationId;

    const book = await goFetch(request, '/api/finance/stays/agent/book', {
      method: 'POST',
      token: aToken,
      headers: { 'Idempotency-Key': idemKey('agentbook') },
      data: {
        reservation_id: resId,
        book_token: seeded.bookToken,
        customer_name: 'Walk In Customer',
        customer_contact: 'walkin@example.com',
        guest: { first_name: 'Walk', last_name: 'In', email: 'walkin@example.com' },
      },
    });
    expect(book.status).toBe(201);
    expect(book.body.data.state).toBe('CONFIRMED');

    const bookings = await goFetch(request, '/api/finance/stays/agent/bookings', { token: aToken });
    expect(bookings.status).toBe(200);
    expect(bookings.body.data.some((b: any) => b.id === resId)).toBe(true);

    const comms = await goFetch(request, '/api/finance/stays/agent/commissions', { token: aToken });
    expect(comms.status).toBe(200);
    expect(comms.body.data.bookings_count).toBeGreaterThanOrEqual(1);
  });
});
