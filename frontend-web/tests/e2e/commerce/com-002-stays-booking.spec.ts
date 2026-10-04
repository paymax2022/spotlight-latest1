/**
 * CMS-002 — stays: /prebook, /book saga, ledger legs, idempotent replay,
 * cancel path, oversell race, insufficient-funds gate.
 * Pins: prebook persists a non-NULL policy snapshot; settle posts via
 * SettleToStandingAccounts (provider leg → provider_clearing, platform cut →
 * commission); a member cancel posts the policy-allowed escrow→wallet refund.
 *
 * Money legs proven live:
 *   HOLD    = settlement.Escrow → DR user_wallet / CR escrow
 *             (reference `escrow:stays:<reservation_id>`)
 *   RELEASE = auto-release Refund → CR user_wallet / DR escrow
 *             (reference `refund:stays:<reservation_id>`)
 *   OVERSALE= allotment=1 admits exactly one confirm; the loser is
 *             auto-released (409 + OVERSELL_BLOCKED text + VOID), never settled.
 */

import { expect, test } from '@playwright/test';

import {
  datePlus,
  fundWallet,
  goFetch,
  goTrueToken,
  idemKey,
  ledgerSums,
  onboardStaysProperty,
  provisionVerifiedUser,
  psql,
  pushAvailability,
  seedPrebookedReservation,
  setKycTier,
} from './helpers';

const NIGHT_KOBO = 5_000_000; // ₦50,000/night sell rate
const GROSS = 10_000_000; // 2 nights

test.describe('CMS-002 stays: prebook defect + book saga + ledger invariants', () => {
  test('consent gate → seeded PREBOOK_OK → book confirms with balanced hold legs; replay is safe; cancel path', async ({
    request,
  }) => {
    const tag = `b${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-hb');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const guest = await provisionVerifiedUser(request, 'cms-gb');
    const gToken = await goTrueToken(request, guest.email, guest.password);

    const supply = await onboardStaysProperty(request, hToken, tag);
    const ci = datePlus(21);
    const co = datePlus(23); // 2 nights
    await pushAvailability(request, hToken, supply.roomTypeId, [ci, datePlus(22)], 3);

    fundWallet(guest.userId, 20_000_000, `stays-${tag}`);
    setKycTier(guest.userId, 3);

    // ── Consent gate: book without consent → 428 consent_required ─────────
    const seeded0 = seedPrebookedReservation(guest.userId, supply, ci, co, GROSS, {
      commissionKobo: 1_000_000,
    });
    const noConsent = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: gToken,
      headers: { 'Idempotency-Key': idemKey('stays-noconsent') },
      data: {
        reservation_id: seeded0.reservationId,
        book_token: seeded0.bookToken,
        guest: { first_name: 'E2E', last_name: 'Guest', email: guest.email },
      },
    });
    expect(noConsent.status).toBe(428);
    expect(noConsent.body.code ?? noConsent.body.error).toContain('consent');

    const grant = await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: gToken, data: {} });
    expect([200, 201]).toContain(grant.status);

    // ── E2E-CMS-001 (fixed): /prebook persists a non-NULL
    //    cancellation_policy_snapshot (Repository.Create now applies orMap, and
    //    savePrebook writes the rate plan's policy captured at prebook time) —
    //    so the real two-step gate returns 200 + a book_token.
    const pre = await goFetch(request, '/api/finance/stays/prebook', {
      method: 'POST',
      token: gToken,
      data: {
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
    expect(pre.status).toBe(200);
    expect(pre.body.data.book_token).toBeTruthy();
    expect(pre.body.data.reservation.state).toBe('PREBOOK_OK');
    const snapshot = psql(
      `select cancellation_policy_snapshot from public.stays_reservation where id='${pre.body.data.reservation.id}'`,
    );
    expect(snapshot.startsWith('{')).toBe(true); // jsonb, never NULL

    // ── Seeded PREBOOK_OK → real /book saga ────────────────────────────────
    const seeded = seedPrebookedReservation(guest.userId, supply, ci, co, GROSS, {
      commissionKobo: 1_000_000,
    });
    const reservationId = seeded.reservationId;
    const bookToken = seeded.bookToken;

    // Missing Idempotency-Key → 400 before money moves.
    const noKey = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: gToken,
      data: { reservation_id: reservationId, book_token: bookToken, guest: { first_name: 'A', last_name: 'B', email: guest.email } },
    });
    expect(noKey.status).toBe(400);

    // ── Book → CONFIRMED; hold leg balanced ────────────────────────────────
    const bookKey = idemKey('stays-book');
    const book = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: gToken,
      headers: { 'Idempotency-Key': bookKey },
      data: {
        reservation_id: reservationId,
        book_token: bookToken,
        guest: { first_name: 'E2E', last_name: 'Guest', email: guest.email, phone: '08011112222' },
      },
    });
    expect(book.status).toBe(201);
    expect(book.body.data.state).toBe('CONFIRMED');
    expect(book.body.data.supplier_ref).toMatch(/^DIR-/);

    // HOLD leg: DR user_wallet / CR escrow, exactly gross (reference escrow:stays:<id>).
    const holdLegs = ledgerSums(`escrow:stays:${reservationId}%`);
    const walletDebit = holdLegs.find((l) => l.accountType === 'user_wallet' && l.accountUserId === guest.userId && l.side === 'DEBIT');
    const escrowCredit = holdLegs.find((l) => l.accountType === 'escrow' && l.side === 'CREDIT');
    expect(walletDebit?.total).toBe(GROSS);
    expect(escrowCredit?.total).toBe(GROSS);

    // E2E-CMS-002 (fixed): the settle now posts through SettleToStandingAccounts —
    // provider leg (gross − commission) to provider_clearing, platform cut to the
    // SEPARATE commission account; the synthetic stays-clearing ref is an
    // annotation, never resolved as a user wallet.
    const settleLegs = ledgerSums(`settle:stays:${reservationId}%`);
    const clearingCredit = settleLegs.find(
      (l) => l.accountType === 'provider_clearing' && l.side === 'CREDIT',
    );
    const commissionCredit = settleLegs.find(
      (l) => l.accountType === 'commission' && l.side === 'CREDIT',
    );
    const settleEscrowDebit = settleLegs
      .filter((l) => l.accountType === 'escrow' && l.side === 'DEBIT')
      .reduce((s, l) => s + l.total, 0);
    expect(clearingCredit?.total).toBe(GROSS - 1_000_000);
    expect(commissionCredit?.total).toBe(1_000_000);
    expect(settleEscrowDebit).toBe(GROSS);
    const settStatus = psql(`select status from public.settlements where reference='stays:${reservationId}'`);
    expect(settStatus).toBe('settled');

    // Replay the same Idempotency-Key → same reservation, no second hold leg.
    const replay = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: gToken,
      headers: { 'Idempotency-Key': bookKey },
      data: {
        reservation_id: reservationId,
        book_token: bookToken,
        guest: { first_name: 'E2E', last_name: 'Guest', email: guest.email },
      },
    });
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.data.id).toBe(reservationId);
    const holdAfter = ledgerSums(`escrow:stays:${reservationId}%`);
    expect(
      holdAfter.filter((l) => l.accountType === 'user_wallet' && l.side === 'DEBIT').reduce((s, l) => s + l.total, 0),
    ).toBe(GROSS);

    // Member reads: list / get / voucher.
    const list = await goFetch(request, '/api/finance/stays/reservations', { token: gToken });
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: any) => r.id === reservationId)).toBe(true);
    const get = await goFetch(request, `/api/finance/stays/reservations/${reservationId}`, { token: gToken });
    expect(get.status).toBe(200);
    expect(get.body.data.state).toBe('CONFIRMED');
    const voucher = await goFetch(request, `/api/finance/stays/reservations/${reservationId}/voucher`, { token: gToken });
    expect([200, 503]).toContain(voucher.status); // 503 when R2 signer unconfigured (fail-closed)

    // Hotelier sees the reservation + can message the guest.
    const msg = await goFetch(
      request,
      `/api/stays/extranet/properties/${supply.propertyId}/reservations/${reservationId}/messages`,
      { method: 'POST', token: hToken, data: { body: 'Welcome — your room is ready.' } },
    );
    expect([200, 201, 404]).toContain(msg.status);

    // ── Cancel → E2E-CMS-003 + audit Defect B (fixed): the direct adapter
    //    returns the policy-allowed refund (refundable rate plan, empty
    //    snapshot → full gross), and post-settle the money draws from where it
    //    PARKED — DR provider_clearing + DR commission → CR guest wallet —
    //    never the drained escrow pool. Inventory release (the non-money leg)
    //    also works: sold returns to 0, decrement flips released=true.
    const cancel = await goFetch(request, `/api/finance/stays/reservations/${reservationId}/cancel`, {
      method: 'POST',
      token: gToken,
      data: { reason: 'e2e cancel' },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.state).toBe('CANCELLED_BY_GUEST');

    const refundLegs = ledgerSums(`stays:refund:${reservationId}%`);
    const walletRestore = refundLegs
      .filter(
        (l) => l.accountType === 'user_wallet' && l.accountUserId === guest.userId && String(l.side) === 'CREDIT',
      )
      .reduce((s, l) => s + l.total, 0);
    const clearingDrain = refundLegs.find(
      (l) => l.accountType === 'provider_clearing' && String(l.side) === 'DEBIT',
    );
    const commissionDrain = refundLegs.find((l) => l.accountType === 'commission' && String(l.side) === 'DEBIT');
    expect(walletRestore).toBe(GROSS);
    expect(clearingDrain?.total).toBe(GROSS - 1_000_000);
    expect(commissionDrain?.total).toBe(1_000_000);

    // Inventory was correctly released (availability decrement is a separate leg).
    const released = psql(
      `select released from public.stays_availability_decrement where supplier_ref='${book.body.data.supplier_ref}'`,
    );
    expect(released).toBe('t');
    const sold = Number(
      psql(`select sold from public.stays_availability_day where room_type_id='${supply.roomTypeId}' and date='${ci}'`),
    );
    expect(sold).toBe(0);
  });

  test('oversell: allotment=1 admits exactly one booking; the loser is auto-released, never settled', async ({ request }) => {
    const tag = `o${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-ho');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const g1 = await provisionVerifiedUser(request, 'cms-o1');
    const g1T = await goTrueToken(request, g1.email, g1.password);
    const g2 = await provisionVerifiedUser(request, 'cms-o2');
    const g2T = await goTrueToken(request, g2.email, g2.password);

    const supply = await onboardStaysProperty(request, hToken, tag);
    const ci = datePlus(28);
    const co = datePlus(29);
    await pushAvailability(request, hToken, supply.roomTypeId, [ci], 1); // ONE room

    for (const [i, [u, t]] of ([[g1, g1T], [g2, g2T]] as const).entries()) {
      fundWallet(u.userId, 15_000_000, `over-${tag}-${i}`);
      setKycTier(u.userId, 3);
      await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: t, data: {} });
    }

    const res1 = seedPrebookedReservation(g1.userId, supply, ci, co, NIGHT_KOBO);
    const res2 = seedPrebookedReservation(g2.userId, supply, ci, co, NIGHT_KOBO);

    const b1 = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: g1T,
      headers: { 'Idempotency-Key': idemKey('over1') },
      data: {
        reservation_id: res1.reservationId,
        book_token: res1.bookToken,
        guest: { first_name: 'One', last_name: 'Guest', email: g1.email },
      },
    });
    expect(b1.status).toBe(201);
    expect(b1.body.data.state).toBe('CONFIRMED');

    // Guest 2 books AFTER the last room was taken: commitDecrement's row-locked
    // guard blocks the oversell → auto-release → 409 + VOID.
    const b2 = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: g2T,
      headers: { 'Idempotency-Key': idemKey('over2') },
      data: {
        reservation_id: res2.reservationId,
        book_token: res2.bookToken,
        guest: { first_name: 'Two', last_name: 'Guest', email: g2.email },
      },
    });
    expect(b2.status).toBe(409);
    expect(b2.body.data?.state).toBe('VOID');
    // OVERSELL_BLOCKED survives httperr sanitization in the 4xx error text
    // (embedded in the wrapped message — not a structured `code` field).
    expect(String(b2.body.error)).toContain('OVERSELL_BLOCKED');

    // The loser was made whole: hold leg + reversing refund leg, net zero.
    const refundLegs = ledgerSums(`refund:stays:${res2.reservationId}%`);
    const walletCredit = refundLegs.find((l) => l.accountType === 'user_wallet' && l.side === 'CREDIT');
    const escrowDebit = refundLegs.find((l) => l.accountType === 'escrow' && l.side === 'DEBIT');
    expect(walletCredit?.total).toBe(NIGHT_KOBO);
    expect(escrowDebit?.total).toBe(NIGHT_KOBO);
    // No settle legs for the loser.
    expect(ledgerSums(`settle:stays:${res2.reservationId}%`).length).toBe(0);

    // Sold = 1 of 1, no oversell row ever written.
    const sold = Number(
      psql(`select sold from public.stays_availability_day where room_type_id='${supply.roomTypeId}' and date='${ci}'`),
    );
    expect(sold).toBe(1);
  });

  test('insufficient funds → 402 INSUFFICIENT_FUNDS and reservation VOIDed, never held', async ({ request }) => {
    const tag = `i${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-hi');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const guest = await provisionVerifiedUser(request, 'cms-gi');
    const gToken = await goTrueToken(request, guest.email, guest.password);

    const supply = await onboardStaysProperty(request, hToken, tag);
    const ci = datePlus(35);
    const co = datePlus(36);
    await pushAvailability(request, hToken, supply.roomTypeId, [ci], 2);

    setKycTier(guest.userId, 3); // no funding → empty wallet
    await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: gToken, data: {} });

    const seeded = seedPrebookedReservation(guest.userId, supply, ci, co, NIGHT_KOBO);
    const book = await goFetch(request, '/api/finance/stays/book', {
      method: 'POST',
      token: gToken,
      headers: { 'Idempotency-Key': idemKey('insuf') },
      data: {
        reservation_id: seeded.reservationId,
        book_token: seeded.bookToken,
        guest: { first_name: 'No', last_name: 'Funds', email: guest.email },
      },
    });
    // E2E-CMS-005 (fixed): the handler now checks ErrInsufficient before the
    // generic res-plus-error 409 — documented contract is 402 INSUFFICIENT_FUNDS,
    // with the VOID reservation still riding in data.
    expect(book.status).toBe(402);
    expect(book.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(book.body.data?.state).toBe('VOID');
    const state = psql(`select state from public.stays_reservation where id='${seeded.reservationId}'`);
    expect(state).toBe('VOID');
  });
});
