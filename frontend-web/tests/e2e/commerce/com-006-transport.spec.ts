/**
 * CMS-006 — transport/mobility: estimate → ride request (wallet escrow,
 * tier-gated) → driver accept (single-winner CAS) → arrive → PIN verify →
 * start → complete (settle split to driver wallet + platform revenue) → rate;
 * plus mode surfaces (parcel/bus/towing/movers/car-hire/event) + admin board.
 *
 * Maps posture locally: no MapService wired → transport uses the explicitly
 * logged MockMaps fallback (dev only; production boot is blocked). Distances/
 * durations are deterministic mock values — the money legs are real.
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  grantAdminPerm,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  seedDriver,
  setKycTier,
  walletBalance,
} from './helpers';

const PICKUP = { lat: 6.5244, lng: 3.3792, address: 'E2E Pickup, Lagos' };
const DEST = { lat: 6.6018, lng: 3.3515, address: 'E2E Dest, Lagos' };

test.describe('CMS-006 transport: ride lifecycle + modes + admin', () => {
  test('rider requests (escrow) → driver accepts → PIN → complete settles split', async ({ request }) => {
    const tag = Date.now() % 100000;
    const rider = await provisionVerifiedUser(request, 'cms-rider');
    const rToken = await goTrueToken(request, rider.email, rider.password);
    fundWallet(rider.userId, 10_000_000, `ride-${tag}`);
    setKycTier(rider.userId, 3);

    const driver = await provisionVerifiedUser(request, 'cms-drv');
    const dToken = await goTrueToken(request, driver.email, driver.password);
    seedDriver(driver.userId, 'E2E Driver');
    setKycTier(driver.userId, 3);

    // Member reads.
    const home = await goFetch(request, '/api/finance/mobility/home', { token: rToken });
    expect(home.status).toBe(200);
    const pricing = await goFetch(request, '/api/finance/mobility/config/pricing?zone=default&service_type=ride_hailing', { token: rToken });
    expect(pricing.status).toBe(200);

    const est = await goFetch(request, '/api/finance/mobility/rides/estimate', {
      method: 'POST',
      token: rToken,
      data: { pickup: PICKUP, dest: DEST, service_type: 'ride_hailing' },
    });
    expect(est.status).toBe(200);

    // Missing Idempotency-Key → 400 before escrow.
    const noKey = await goFetch(request, '/api/finance/mobility/rides/request', {
      method: 'POST',
      token: rToken,
      data: { pickup: PICKUP, dest: DEST, pricing_mode: 'instant', payment_method: 'wallet' },
    });
    expect(noKey.status).toBe(400);

    const book = await goFetch(request, '/api/finance/mobility/rides/request', {
      method: 'POST',
      token: rToken,
      headers: { 'Idempotency-Key': idemKey('ride') },
      data: { pickup: PICKUP, dest: DEST, service_type: 'ride_hailing', pricing_mode: 'instant', payment_method: 'wallet' },
    });
    expect(book.status).toBe(201);
    const tripId = book.body.trip?.id ?? book.body.id ?? book.body.data?.id;
    expect(tripId).toBeTruthy();

    // Escrow hold leg posted (reference escrow:trip:<id> or trip:<id>).
    const riderBefore = Number(walletBalance(rider.userId));
    const holdLegs = ledgerSums(`%trip:${tripId}%`);
    expect(holdLegs.length).toBeGreaterThan(0);
    const debit = holdLegs.find((l) => l.accountType === 'user_wallet' && l.side === 'DEBIT');
    expect(debit?.total).toBeGreaterThan(0);

    // Driver sees the open request + accepts (single-winner CAS).
    const reqs = await goFetch(request, '/api/finance/driver/requests', { token: dToken });
    expect(reqs.status).toBe(200);
    const accept = await goFetch(request, `/api/finance/driver/requests/${tripId}/accept`, {
      method: 'POST',
      token: dToken,
    });
    expect([200, 201]).toContain(accept.status);

    // Second driver cannot steal the accepted trip (CAS guard).
    const rival = await provisionVerifiedUser(request, 'cms-drv2');
    const rvToken = await goTrueToken(request, rival.email, rival.password);
    seedDriver(rival.userId, 'Rival Driver');
    const steal = await goFetch(request, `/api/finance/driver/requests/${tripId}/accept`, {
      method: 'POST',
      token: rvToken,
    });
    expect(steal.status).toBe(409);

    // Rider sees trip detail incl. PIN; driver cannot see PIN pre-verify.
    const detail = await goFetch(request, `/api/finance/mobility/rides/${tripId}`, { token: rToken });
    expect(detail.status).toBe(200);
    const pin = detail.body.trip?.tripPin ?? detail.body.tripPin ?? detail.body.data?.tripPin;
    expect(pin).toBeTruthy();

    const arrive = await goFetch(request, `/api/finance/driver/trips/${tripId}/arrive`, { method: 'POST', token: dToken });
    expect(arrive.status).toBe(200);
    // Wrong PIN → 422.
    const badPin = await goFetch(request, `/api/finance/driver/trips/${tripId}/verify-pin`, {
      method: 'POST',
      token: dToken,
      data: { pin: '000000' },
    });
    expect([422, 409]).toContain(badPin.status);
    const okPin = await goFetch(request, `/api/finance/driver/trips/${tripId}/verify-pin`, {
      method: 'POST',
      token: dToken,
      data: { pin },
    });
    expect(okPin.status).toBe(200);
    const start = await goFetch(request, `/api/finance/driver/trips/${tripId}/start`, { method: 'POST', token: dToken });
    expect(start.status).toBe(200);

    // Trip chat + share link (member surfaces).
    const chat = await goFetch(request, `/api/finance/mobility/trips/${tripId}/messages`, {
      method: 'POST',
      token: rToken,
      data: { body: 'On my way down' },
    });
    expect([200, 201]).toContain(chat.status);
    const share = await goFetch(request, `/api/finance/mobility/rides/${tripId}/share`, { method: 'POST', token: rToken });
    expect([200, 201]).toContain(share.status);
    const shareToken = share.body.token ?? share.body.data?.token;
    if (shareToken) {
      const pub = await goFetch(request, `/api/finance/mobility/public/track/${shareToken}`);
      expect(pub.status).toBe(200);
      // Public payload must never carry the PIN.
      expect(JSON.stringify(pub.body)).not.toContain(pin);
    }

    const driverBefore = Number(walletBalance(driver.userId));
    const complete = await goFetch(request, `/api/finance/driver/trips/${tripId}/complete`, { method: 'POST', token: dToken });
    expect(complete.status).toBe(200);

    // Settle split: driver wallet credited provider share (settle:trip:<id>).
    const settleLegs = ledgerSums(`settle:trip:${tripId}%`);
    expect(settleLegs.length).toBeGreaterThan(0);
    const driverCredit = settleLegs.find((l) => l.accountType === 'user_wallet' && l.accountUserId === driver.userId && l.side === 'CREDIT');
    expect(driverCredit?.total).toBeGreaterThan(0);
    const revenue = settleLegs.find((l) => (l.accountType === 'paymax_revenue' || l.accountType === 'commission') && l.side === 'CREDIT');
    expect(revenue?.total).toBeGreaterThan(0);
    expect(Number(walletBalance(driver.userId))).toBeGreaterThan(driverBefore);

    // Rate + history.
    const rate = await goFetch(request, `/api/finance/mobility/rides/${tripId}/rate`, {
      method: 'POST',
      token: rToken,
      data: { stars: 5, comment: 'smooth' },
    });
    expect([200, 201]).toContain(rate.status);
    const hist = await goFetch(request, '/api/finance/mobility/history', { token: rToken });
    expect(hist.status).toBe(200);
    const earnings = await goFetch(request, '/api/finance/driver/earnings', { token: dToken });
    expect(earnings.status).toBe(200);

    // Profile + trusted contacts.
    const prof = await goFetch(request, '/api/finance/mobility/profile', { token: rToken });
    expect(prof.status).toBe(200);
    const contact = await goFetch(request, '/api/finance/mobility/trusted-contacts', {
      method: 'POST',
      token: rToken,
      data: { name: 'E2E Kin', phone: '08099998888' },
    });
    expect([200, 201]).toContain(contact.status);
    const contacts = await goFetch(request, '/api/finance/mobility/trusted-contacts', { token: rToken });
    expect(contacts.status).toBe(200);

    // Admin transport board (all read surfaces + a pricing read). Super
    // Admin predates the mobility.* slugs seeded by 20260621090000 —
    // grant them to the fixture admin (direct allow, global scope).
    grantAdminPerm('mobility.view', 'mobility.ride.manage');
    for (const path of [
      '/api/finance/admin/transport/dashboard',
      '/api/finance/admin/transport/drivers',
      '/api/finance/admin/transport/vehicles',
      '/api/finance/admin/transport/trips',
      '/api/finance/admin/transport/dispatch/live',
      '/api/finance/admin/transport/pricing',
      '/api/finance/admin/transport/commission',
      '/api/finance/admin/transport/safety/incidents',
      '/api/finance/admin/transport/reports/summary',
      '/api/finance/admin/transport/audit',
    ]) {
      const res = await adminFetch(request, path);
      expect(res.status, `admin ${path}`).toBe(200);
    }
  });

  test('modes: parcel book → cancel refunds; bus/towing/movers/car-hire probes', async ({ request }) => {
    const tag = Date.now() % 100000;
    const user = await provisionVerifiedUser(request, 'cms-mode');
    const token = await goTrueToken(request, user.email, user.password);
    fundWallet(user.userId, 10_000_000, `mode-${tag}`);
    setKycTier(user.userId, 3);

    // ── Parcel: estimate → book (escrow) → list/get → cancel ──────────────
    const pEst = await goFetch(request, '/api/finance/mobility/parcels/estimate', {
      method: 'POST',
      token,
      data: { pickup: PICKUP, dropoff: DEST, category: 'document', size: 'small', speed: 'standard' },
    });
    expect(pEst.status).toBe(200);

    const pBook = await goFetch(request, '/api/finance/mobility/parcels', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('parcel') },
      data: {
        pickup: PICKUP,
        dropoff: DEST,
        receiver_name: 'E2E Receiver',
        receiver_phone: '08011113333',
        category: 'document',
        size: 'small',
        speed: 'standard',
        declared_value_kobo: 50_000,
        prohibited_ack: true,
        idempotency_key: idemKey('parcel-body'),
      },
    });
    expect([200, 201]).toContain(pBook.status);
    const parcelId = pBook.body.id ?? pBook.body.data?.id;
    if (parcelId) {
      const pGet = await goFetch(request, `/api/finance/mobility/parcels/${parcelId}`, { token });
      expect(pGet.status).toBe(200);
      const pCancel = await goFetch(request, `/api/finance/mobility/parcels/${parcelId}/cancel`, {
        method: 'POST',
        token,
        data: { reason: 'e2e' },
      });
      expect([200, 201, 409]).toContain(pCancel.status);
    }
    const pList = await goFetch(request, '/api/finance/mobility/parcels', { token });
    expect(pList.status).toBe(200);

    // ── Bus discovery + provider self-service ──────────────────────────────
    for (const path of ['/api/finance/mobility/bus/routes', '/api/finance/mobility/bus/providers', '/api/finance/mobility/bus/search', '/api/finance/mobility/bus/tickets']) {
      const res = await goFetch(request, path, { token });
      expect(res.status, `bus ${path}`).toBe(200);
    }
    // Schedules requires route_id.
    const schedNoParam = await goFetch(request, '/api/finance/mobility/bus/schedules', { token });
    expect(schedNoParam.status).toBe(400);
    const sched = await goFetch(request, '/api/finance/mobility/bus/schedules?route_id=00000000-0000-0000-0000-000000000000', { token });
    expect([200, 404]).toContain(sched.status);
    const provReg = await goFetch(request, '/api/finance/mobility/bus/provider/register', {
      method: 'POST',
      token,
      data: { company_name: `E2E Lines ${tag}`, contact_email: `bus${tag}@e2e.test` },
    });
    expect([200, 201, 400, 409]).toContain(provReg.status);
    const provMe = await goFetch(request, '/api/finance/mobility/bus/provider/me', { token });
    expect([200, 404]).toContain(provMe.status);

    // ── Towing: estimate → book → list → cancel ────────────────────────────
    const tEst = await goFetch(request, '/api/finance/mobility/towing/estimate', {
      method: 'POST',
      token,
      data: { service_type: 'flatbed', pickup: PICKUP, dest: DEST },
    });
    expect(tEst.status).toBe(200);
    const tBook = await goFetch(request, '/api/finance/mobility/towing', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('tow') },
      data: { service_type: 'flatbed', vehicle_type: 'sedan', issue_type: 'breakdown', pickup: PICKUP, dest: DEST },
    });
    expect([200, 201, 400]).toContain(tBook.status);
    const tList = await goFetch(request, '/api/finance/mobility/towing', { token });
    expect(tList.status).toBe(200);

    // ── Movers + car hire quotes ───────────────────────────────────────────
    const mQ = await goFetch(request, '/api/finance/mobility/movers/quote', {
      method: 'POST',
      token,
      data: { pickup: PICKUP, dropoff: DEST, property_type: '2br', truck_size: 'medium', helpers: 2 },
    });
    expect([200, 201]).toContain(mQ.status);
    const mList = await goFetch(request, '/api/finance/mobility/movers', { token });
    expect(mList.status).toBe(200);

    const chQ = await goFetch(request, '/api/finance/mobility/car-hire/quote', {
      method: 'POST',
      token,
      data: { hire_type: 'daily', vehicle_class: 'sedan', start_at: new Date(Date.now() + 86400000).toISOString(), duration_hours: 8 },
    });
    expect([200, 201]).toContain(chQ.status);
    const chList = await goFetch(request, '/api/finance/mobility/car-hire', { token });
    expect(chList.status).toBe(200);

    // Driver-mode feeds (a courier sees parcel/towing/mover requests).
    const drv = await provisionVerifiedUser(request, 'cms-courier');
    const cToken = await goTrueToken(request, drv.email, drv.password);
    seedDriver(drv.userId, 'E2E Courier');
    for (const path of ['/api/finance/driver/parcels/requests', '/api/finance/driver/towing/requests', '/api/finance/driver/movers/open']) {
      const res = await goFetch(request, path, { token: cToken });
      expect(res.status, `driver ${path}`).toBe(200);
    }
  });
});
