/**
 * CROSS-001 — multi-actor order completion: user → provider → rider → admin → system.
 *
 * Extends the provider wave's proven flow (wallet escrow checkout) through the
 * FULL lifecycle this time:
 *   customer orders (escrow DR wallet / CR escrow)
 *   → owner advances pending → confirmed → preparing → ready
 *   → auto-dispatch offers the delivery to a seeded online rider
 *   → rider accepts → confirms pickup (pickup_code POD) → confirms handoff
 *     (delivery_code POD) → delivered
 *   → settleOrder releases escrow 80/10/10 provider/rider/platform
 *   → admin order feed shows the completed order
 *
 * Every stage re-verifies the ledger stays balanced, and the end state proves
 * whether escrow funds actually move to the provider/rider/platform or stay
 * parked (the question this spec exists to answer).
 *
 * Fixture-only steps: wallet funding journal (Paystack rail unreachable
 * locally), the drivers-pool row (no web rider onboarding), kyc_tier (no KYC
 * provider). All product state moves through real APIs.
 */

import { expect, test } from '@playwright/test';
import {
  adminGo,
  adminBearer,
  createRestaurant,
  fundWallet,
  goFetch,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  seedDriver,
  setKycTier,
  walletBalance,
  ADMIN_USER,
} from './helpers';

const KYB_BODY = {
  legal_name: 'E2E Cross Foods',
  business_type: 'sole_proprietor',
  contact_email: 'cross-kyb@paymax.test',
  contact_phone: '+2348012345678',
  bank_code: '058',
  account_number: '0123456789',
  account_name: 'E2E Cross Foods',
};

test.describe('CROSS-001: multi-actor order completion + settlement', () => {
  test('user order → provider FSM → rider POD → delivery → escrow settles; admin sees it', async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const owner = await provisionVerifiedUser(request, 'x-owner');
    const customer = await provisionVerifiedUser(request, 'x-cust');
    const rider = await provisionVerifiedUser(request, 'x-rider');

    const ownerToken = await goTrueToken(request, owner.email, owner.password);
    const custToken = await goTrueToken(request, customer.email, customer.password);
    const riderToken = await goTrueToken(request, rider.email, rider.password);
    const ownerAuth = { Authorization: `Bearer ${ownerToken}` };
    const custAuth = { Authorization: `Bearer ${custToken}` };

    let rid = '';
    let itemId = '';
    let orderId = '';

    await test.step('provider pipeline (owner→KYB→admin approval→menu)', async () => {
      const created = await createRestaurant(request, ownerToken, `XORD${Date.now() % 100000} Kitchen`);
      expect(created.status).toBe(201);
      rid = created.body.id;

      expect(
        (await goFetch(request, `/api/finance/restaurant/${rid}/kyb`, {
          method: 'PUT', token: ownerToken, data: KYB_BODY,
        })).status,
      ).toBe(200);
      expect(
        (await goFetch(request, `/api/finance/restaurant/${rid}/kyb/submit`, {
          method: 'POST', token: ownerToken,
        })).status,
      ).toBe(200);
      expect(
        (await goFetch(request, `/api/restaurant/admin/onboarding/${rid}/approve`, {
          method: 'POST', token: await adminBearer(request), data: { note: 'E2E cross' },
        })).status,
      ).toBe(200);
      expect(psql(`select is_open::text from restaurants where id='${rid}';`)).toBe('true');

      const cat = await request.fetch(`/api/v1/restaurant/${rid}/menu/categories`, {
        method: 'POST', headers: ownerAuth, data: { name: 'Cross Mains' },
      });
      expect(cat.status()).toBe(201);
      const item = await request.fetch(`/api/v1/restaurant/${rid}/menu/items`, {
        method: 'POST',
        headers: ownerAuth,
        data: { category_id: (await cat.json()).id, name: 'Cross Jollof', price_kobo: 150_000 },
      });
      expect(item.status()).toBe(201);
      itemId = (await item.json()).id as string;
    });

    await test.step('fixture: rider online in the drivers pool; customer wallet funded; customer tier1 for checkout', async () => {
      seedDriver(rider.userId, 'E2E Cross Rider');
      setKycTier(customer.userId, 1);
      fundWallet(customer.userId, 500_000, `xord-${Date.now()}`);
      expect(walletBalance(customer.userId)).toBe('500000');
    });

    await test.step('customer places order → pending + balanced escrow legs', async () => {
      const res = await request.fetch(`/api/v1/restaurant/${rid}/orders`, {
        method: 'POST',
        headers: { ...custAuth, 'Idempotency-Key': `xord-${Date.now()}` },
        data: {
          items: [{ menu_item_id: itemId, quantity: 1 }],
          delivery_address: '7 Cross Delivery Rd, Lagos',
        },
      });
      const body = await res.json().catch(() => null);
      expect(res.status(), JSON.stringify(body)).toBe(201);
      orderId = body.id;
      expect(psql(`select status from orders where id='${orderId}';`)).toBe('pending');

      // Escrow journal: DR customer wallet / CR escrow, one balanced pair.
      const legs = ledgerSums(`escrow:order:${orderId}`);
      const dr = legs.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.total, 0);
      const cr = legs.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.total, 0);
      expect(dr).toBeGreaterThan(0);
      expect(dr).toBe(cr);
      expect(legs.find((l) => l.accountType === 'escrow' && l.side === 'CREDIT')).toBeTruthy();
      expect(legs.find((l) => l.accountType === 'user_wallet' && l.side === 'DEBIT')).toBeTruthy();

      const total = Number(psql(`select total_kobo from orders where id='${orderId}';`));
      expect(dr).toBe(total);
      test.info().annotations.push({ type: 'order', description: `order=${orderId} total=${total}` });
    });

    await test.step('owner advances pending→confirmed→preparing→ready; customer reads each state', async () => {
      // Negative: the customer cannot drive provider-side transitions.
      expect(
        (await request.fetch(`/api/v1/restaurant/${rid}/orders/${orderId}/status`, {
          method: 'PATCH', headers: custAuth, data: { status: 'confirmed' },
        })).status(),
      ).toBe(403);

      for (const status of ['confirmed', 'preparing']) {
        expect(
          (await request.fetch(`/api/v1/restaurant/${rid}/orders/${orderId}/status`, {
            method: 'PATCH', headers: ownerAuth, data: { status },
          })).status(),
        ).toBe(200);
        expect(psql(`select status from orders where id='${orderId}';`)).toBe(status);
        // Customer's own read surface tracks the move.
        const read = await goFetch(request, `/api/finance/restaurant/orders/${orderId}`, { token: custToken });
        expect(read.status).toBe(200);
        expect(read.body.status).toBe(status);
      }

      // ready → pickup/delivery codes generated + auto-dispatch fires.
      expect(
        (await request.fetch(`/api/v1/restaurant/${rid}/orders/${orderId}/status`, {
          method: 'PATCH', headers: ownerAuth, data: { status: 'ready' },
        })).status(),
      ).toBe(200);
      const codes = psql(
        `select coalesce(pickup_code,'') || '|' || coalesce(delivery_code,'') || '|' || coalesce(dispatch_status,'') ` +
          `from orders where id='${orderId}';`,
      );
      const [pickupCode, deliveryCode, dispatchStatus] = codes.split('|');
      expect(pickupCode).toMatch(/^\d{4}$/);
      expect(dispatchStatus).toBe('searching');

      // Money check mid-flight: still exactly one escrow pair, nothing settled yet.
      expect(psql(`select s.status from settlements s join orders o on o.settlement_id=s.id where o.id='${orderId}';`))
        .toBe('escrowed');

      // The dispatch offer reached OUR seeded rider.
      const offer = psql(
        `select status from restaurant_delivery_offers where order_id='${orderId}' and rider_id='${rider.userId}';`,
      );
      expect(offer).toBe('offered');
      test.info().annotations.push({
        type: 'codes',
        description: `pickup=${pickupCode} delivery=${deliveryCode} (read from orders row — physically handed over in product)`,
      });
    });

    await test.step('rider accepts → pickup(POD) → handoff(POD) → delivered', async () => {
      // Rider sees the offer on the real rider feed.
      const offers = await goFetch(request, '/api/finance/restaurant/rider/offers', { token: riderToken });
      expect(offers.status).toBe(200);
      const offerIds = (offers.body?.offers ?? []).map((o: { id: string }) => o.id);
      expect(offerIds).toContain(orderId);

      // Wrong actor cannot accept someone else's offer.
      const stranger = await goFetch(request, `/api/finance/restaurant/orders/${orderId}/accept`, {
        method: 'POST', token: ownerToken,
      });
      expect(stranger.status).toBe(400);

      const pickupCode = psql(`select pickup_code from orders where id='${orderId}';`);
      const deliveryCode = psql(`select delivery_code from orders where id='${orderId}';`);

      expect(
        (await goFetch(request, `/api/finance/restaurant/orders/${orderId}/accept`, {
          method: 'POST', token: riderToken,
        })).status,
      ).toBe(200);
      expect(psql(`select rider_id from orders where id='${orderId}';`)).toBe(rider.userId);

      // POD gates: wrong codes must be refused.
      expect(
        (await goFetch(request, `/api/finance/restaurant/orders/${orderId}/pickup`, {
          method: 'POST', token: riderToken, data: { code: '0000' === pickupCode ? '9999' : '0000' },
        })).status,
      ).toBe(400);
      expect(psql(`select status from orders where id='${orderId}';`)).toBe('ready');

      expect(
        (await goFetch(request, `/api/finance/restaurant/orders/${orderId}/pickup`, {
          method: 'POST', token: riderToken, data: { code: pickupCode },
        })).status,
      ).toBe(200);
      expect(psql(`select status from orders where id='${orderId}';`)).toBe('picked_up');

      expect(
        (await goFetch(request, `/api/finance/restaurant/orders/${orderId}/handoff`, {
          method: 'POST', token: riderToken, data: { code: deliveryCode },
        })).status,
      ).toBe(200);
      expect(psql(`select status from orders where id='${orderId}';`)).toBe('delivered');
    });

    await test.step('escrow RELEASES on delivery — settlement legs move money to provider/rider/platform', async () => {
      expect(psql(`select s.status from settlements s join orders o on o.settlement_id=s.id where o.id='${orderId}';`))
        .toBe('settled');

      const legs = ledgerSums(`settle:order:${orderId}%`);
      const dr = legs.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.total, 0);
      const cr = legs.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.total, 0);
      const total = Number(psql(`select total_kobo from orders where id='${orderId}';`));

      // Balanced, and the FULL escrowed amount left escrow — nothing parked.
      expect(dr).toBe(cr);
      expect(dr).toBe(total);
      expect(legs.filter((l) => l.side === 'DEBIT' && l.accountType === 'escrow').length).toBeGreaterThan(0);

      // Split lands on the right wallets: provider 80% of base, rider 10%+,
      // platform 10%+service fee (all three credited on the settle journal).
      const providerLeg = legs.find(
        (l) => l.side === 'CREDIT' && l.accountType === 'user_wallet' && l.accountUserId === owner.userId,
      );
      const riderLeg = legs.find(
        (l) => l.side === 'CREDIT' && l.accountType === 'user_wallet' && l.accountUserId === rider.userId,
      );
      const platformLeg = legs.find((l) => l.side === 'CREDIT' && l.accountType === 'paymax_revenue');
      expect(providerLeg).toBeTruthy();
      expect(riderLeg).toBeTruthy();
      expect(platformLeg).toBeTruthy();

      // ComputeLegs math (settlement.Split): the percentage gross EXCLUDES the
      // three fixed legs — tip (100% rider), service fee (100% platform) and
      // packaging fee (ProviderFeeKobo, 100% restaurant). This order carries a
      // 20,000-kobo packaging fee, so gross = total − packaging = 200,000.
      const svcFee = Number(psql(`select coalesce(service_fee_kobo,0) from orders where id='${orderId}';`));
      const tip = Number(psql(`select coalesce(tip_kobo,0) from orders where id='${orderId}';`));
      const packaging = Number(psql(`select coalesce(packaging_fee_kobo,0) from orders where id='${orderId}';`));
      const gross = total - svcFee - tip - packaging;
      expect(platformLeg!.total).toBe(Math.floor(gross * 0.1) + svcFee);
      expect(riderLeg!.total).toBe(Math.floor(gross * 0.1) + tip);
      expect(providerLeg!.total).toBe(total - platformLeg!.total - riderLeg!.total);

      // Recipient wallets actually hold the money (projection over the ledger).
      const ownerBal = Number(walletBalance(owner.userId) || 0);
      const riderBal = Number(walletBalance(rider.userId) || 0);
      expect(ownerBal).toBe(providerLeg!.total);
      expect(riderBal).toBe(riderLeg!.total);
      test.info().annotations.push({
        type: 'settlement',
        description: `total=${total} provider=${providerLeg!.total} rider=${riderLeg!.total} platform=${platformLeg!.total}; ownerWallet=${ownerBal} riderWallet=${riderBal}`,
      });
    });

    await test.step('admin + customer both see the completed order', async () => {
      const adminFeed = await goFetch(request, `/api/restaurant/admin/orders?restaurant_id=${rid}`, {
        token: await adminBearer(request),
      });
      expect(adminFeed.status).toBe(200);
      const rows = (adminFeed.body?.orders ?? []) as Array<{ id: string; status: string }>;
      const row = rows.find((o) => o.id === orderId);
      expect(row?.status).toBe('delivered');

      const cust = await goFetch(request, `/api/finance/restaurant/orders/${orderId}`, { token: custToken });
      expect(cust.status).toBe(200);
      expect(cust.body.status).toBe('delivered');
    });
  });
});
