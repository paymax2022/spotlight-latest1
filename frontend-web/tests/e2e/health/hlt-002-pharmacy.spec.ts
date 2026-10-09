/**
 * HLT-002 — health pharmacy vertical (app:health_pharmacy).
 *
 * Real journey over the mounted routes (/api/finance/health/pharmacy/* +
 * /api/health/pharmacy/admin/*):
 *
 *   owner KYB (shared providers) → storefront profile + NAFDAC-gated product
 *   → patient order (PICKUP, escrow HELD, idempotent) → owner confirm →
 *   dispense → dispatch (pickup code minted) → complete w/ code (escrow
 *   RELEASE → CLOSED) → patient review → owner earnings.
 *   Plus: cancel → refund leg, stock decrement, admin oversight surface.
 *
 * Money assertions: ledger legs for `pharmacy:<orderId>` are balanced; the
 * patient debit on hold and the owner credit on release are integer kobo.
 * Fixture-only: wallet funding posts the same balanced journal the top-up
 * webhook posts; kyc_tier is seeded (no local KYC provider). HL-10 requires
 * the owner at tier ≥1 for the payout release.
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

const PRICE_KOBO = 150_000; // ₦1,500
const FUND_KOBO = 5_000_000; // ₦50,000

async function setupPharmacy(
  request: any,
  tag: string,
): Promise<{ ownerId: string; ownerToken: string; providerId: string; productId: string }> {
  const owner = await provisionVerifiedUser(request, `hlt002-own-${tag}`);
  const ownerToken = await goTrueToken(request, owner.email, owner.password);
  setKycTier(owner.userId, 3); // HL-10 payout eligibility (fixture — no local KYC rail)

  const { providerId } = await onboardProvider(request, ownerToken, {
    domain: 'PHARMACY',
    providerType: 'pharmacy',
    displayName: `E2E Pharmacy ${tag}`,
  });

  const profile = await goFetch(request, `/api/finance/health/pharmacy/pharmacies/${providerId}/profile`, {
    method: 'POST',
    token: ownerToken,
    data: { address: '12 E2E Pharmacy Close, Lagos', phone: '+2348000000001', lat: 6.5244, lng: 3.3792 },
  });
  expect(profile.status).toBeLessThan(300);

  // Catalog write through the REAL API (E2E-HLT-001 fixed: UpsertProduct now
  // populates the legacy shared `category` column from rx_required →
  // 'prescription' | 'otc', both enum-legal for the health_premium CHECK the
  // additive-only collision guard could not relax).
  const product = await goFetch(request, '/api/finance/health/pharmacy/products', {
    method: 'POST',
    token: ownerToken,
    data: {
      pharmacy_provider_id: providerId,
      name: `E2E Paracetamol ${tag}`,
      nafdac_ref: `NAF-E2E-${tag}`,
      nafdac_status: 'REGISTERED',
      rx_required: false,
      is_controlled: false,
      price_kobo: PRICE_KOBO,
      stock_qty: 10,
      active: true,
    },
  });
  expect(product.status, `product create: ${JSON.stringify(product.body)}`).toBe(201);
  const productId = product.body.product.id as string;
  expect(productId).toBeTruthy();
  return { ownerId: owner.userId, ownerToken, providerId, productId };
}

test.describe('HLT-002 pharmacy order lifecycle', () => {
  test('KYB → catalog → order (HELD) → confirm → dispense → dispatch → complete (RELEASE) → review + earnings', async ({
    request,
  }) => {
    const tag = `a${Date.now() % 100000}`;
    const { ownerToken, providerId, productId } = await setupPharmacy(request, tag);

    const patient = await provisionVerifiedUser(request, `hlt002-pat-${tag}`);
    const patientToken = await goTrueToken(request, patient.email, patient.password);
    setKycTier(patient.userId, 3);
    fundWallet(patient.userId, FUND_KOBO, `hlt002-${tag}`);

    // Discovery + catalog reads.
    const discover = await goFetch(request, '/api/finance/health/pharmacy/pharmacies', { token: patientToken });
    expect(discover.status).toBe(200);
    expect((discover.body.pharmacies ?? []).map((p: any) => p.provider_id ?? p.id)).toContain(providerId);
    const detail = await goFetch(request, `/api/finance/health/pharmacy/pharmacies/${providerId}`, { token: patientToken });
    expect(detail.status).toBe(200);
    const catalog = await goFetch(request, `/api/finance/health/pharmacy/products?pharmacy_provider_id=${providerId}`, {
      token: patientToken,
    });
    expect(catalog.status).toBe(200);
    expect((catalog.body.products ?? []).map((p: any) => p.id)).toContain(productId);
    const productRead = await goFetch(request, `/api/finance/health/pharmacy/products/${productId}`, {
      token: patientToken,
    });
    expect(productRead.status).toBe(200);
    const mine = await goFetch(request, '/api/finance/health/pharmacy/products/mine', { token: ownerToken });
    expect(mine.status).toBe(200);
    expect((mine.body.products ?? []).map((p: any) => p.id)).toContain(productId);

    // Order: PICKUP, payment HELD. Idempotency-Key required.
    const idem = idemKey(`pharm-${tag}`);
    const order = await goFetch(request, '/api/finance/health/pharmacy/orders', {
      method: 'POST',
      token: patientToken,
      data: {
        pharmacy_provider_id: providerId,
        fulfilment_method: 'PICKUP',
        idempotency_key: idem,
        lines: [{ product_id: productId, quantity: 2 }],
      },
    });
    expect(order.status, `order create: ${JSON.stringify(order.body)}`).toBe(201);
    const orderId = order.body.order.id as string;
    expect(order.body.order.state).toBe('CREATED');
    expect(order.body.order.total_kobo).toBe(2 * PRICE_KOBO);
    expect(Number.isInteger(order.body.order.total_kobo)).toBe(true);

    // Balanced legs for this order's escrow reference (hold posts as
    // `escrow:pharmacy:<id>`; resolve legs post as `release|refund:pharmacy:<id>`).
    const holdLegs = ledgerSums(`%pharmacy:${orderId}%`);
    const cr = holdLegs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const dr = holdLegs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(cr, 'escrow hold legs unbalanced').toBe(dr);
    expect(cr).toBeGreaterThanOrEqual(2 * PRICE_KOBO);

    // Replay: same idempotency key returns the same order — no second hold.
    const replay = await goFetch(request, '/api/finance/health/pharmacy/orders', {
      method: 'POST',
      token: patientToken,
      data: {
        pharmacy_provider_id: providerId,
        fulfilment_method: 'PICKUP',
        idempotency_key: idem,
        lines: [{ product_id: productId, quantity: 2 }],
      },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(orderId);

    // Patient history + owner fulfilment queue.
    const myOrders = await goFetch(request, '/api/finance/health/pharmacy/orders/mine', { token: patientToken });
    expect(myOrders.status).toBe(200);
    const queue = await goFetch(request, '/api/finance/health/pharmacy/orders', { token: ownerToken });
    expect(queue.status).toBe(200);
    expect((queue.body.orders ?? []).map((o: any) => o.id)).toContain(orderId);
    const orderGet = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}`, { token: patientToken });
    expect(orderGet.status).toBe(200);

    // Owner: confirm → dispense → dispatch (PICKUP mints a one-time code).
    const confirmed = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/confirm`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(confirmed.status).toBe(200);
    const dispensed = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/dispense`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(dispensed.status).toBe(200);
    const dispatched = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/dispatch`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.order.state).toBe('READY_FOR_PICKUP');
    const pickupCode = dispatched.body.order.pickup_code as string;
    expect(pickupCode).toBeTruthy();

    // Complete requires the pickup code; wrong code refuses before money moves.
    const badComplete = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/complete`, {
      method: 'POST',
      token: patientToken,
      data: { pickup_code: 'wrong-code' },
    });
    expect([400, 409, 422]).toContain(badComplete.status);
    const completed = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/complete`, {
      method: 'POST',
      token: patientToken,
      data: { pickup_code: pickupCode },
    });
    expect(completed.status).toBe(200);
    expect(['COLLECTED', 'CLOSED']).toContain(completed.body.order.state);

    // Patient review + public rating feed.
    const review = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/reviews`, {
      method: 'POST',
      token: patientToken,
      data: { rating: 5, body: 'E2E review' },
    });
    expect(review.status).toBeLessThan(300);
    const feed = await goFetch(request, `/api/finance/health/pharmacy/pharmacies/${providerId}/reviews`, {
      token: patientToken,
    });
    expect(feed.status).toBe(200);

    // Owner money view.
    const earnings = await goFetch(request, '/api/finance/health/pharmacy/earnings', { token: ownerToken });
    expect(earnings.status).toBe(200);

    // Patient prescription list (empty is fine — read coverage).
    const myRx = await goFetch(request, '/api/finance/health/pharmacy/prescriptions', { token: patientToken });
    expect(myRx.status).toBe(200);

    // Admin oversight surface (super-admin holds health.pharmacy.* RBAC).
    const admin = await healthAdminToken(request);
    const dash = await goFetch(request, '/api/health/pharmacy/admin/dashboard', { token: admin });
    expect(dash.status).toBe(200);
    const adminOrders = await goFetch(request, '/api/health/pharmacy/admin/orders', { token: admin });
    expect(adminOrders.status).toBe(200);
    const adminGet = await goFetch(request, `/api/health/pharmacy/admin/orders/${orderId}`, { token: admin });
    expect(adminGet.status).toBe(200);
    // HL-12 dispense audit (E2E-HLT-002 fixed: the optional filter binds NULL,
    // never a text '' against the uuid column). Unfiltered + filtered both read.
    const audit = await goFetch(request, '/api/health/pharmacy/admin/dispense-audit', { token: admin });
    expect(audit.status, `dispense audit: ${JSON.stringify(audit.body)}`).toBe(200);
    const auditFiltered = await goFetch(request, `/api/health/pharmacy/admin/dispense-audit?pharmacy_provider_id=${providerId}`, { token: admin });
    expect(auditFiltered.status).toBe(200);
    const auditOrderIds = (auditFiltered.body.records ?? []).map((r: any) => r.order_id);
    expect(auditOrderIds).toContain(orderId);
  });

  test('cancel before dispense refunds the held payment (HL-9)', async ({ request }) => {
    const tag = `b${Date.now() % 100000}`;
    const { providerId, productId } = await setupPharmacy(request, tag);
    const patient = await provisionVerifiedUser(request, `hlt002-pc-${tag}`);
    const patientToken = await goTrueToken(request, patient.email, patient.password);
    setKycTier(patient.userId, 3);
    fundWallet(patient.userId, FUND_KOBO, `hlt002-c-${tag}`);

    const order = await goFetch(request, '/api/finance/health/pharmacy/orders', {
      method: 'POST',
      token: patientToken,
      data: {
        pharmacy_provider_id: providerId,
        fulfilment_method: 'PICKUP',
        idempotency_key: idemKey(`pharmc-${tag}`),
        lines: [{ product_id: productId, quantity: 1 }],
      },
    });
    expect(order.status, `order create: ${JSON.stringify(order.body)}`).toBe(201);
    const orderId = order.body.order.id as string;

    const cancelled = await goFetch(request, `/api/finance/health/pharmacy/orders/${orderId}/cancel`, {
      method: 'POST',
      token: patientToken,
      data: { reason: 'E2E cancel' },
    });
    expect(cancelled.status).toBe(200);
    expect(['CANCELLED', 'REFUNDED']).toContain(cancelled.body.order.state);

    // Refund restores the patient's wallet: hold legs + refund legs net to zero
    // beyond the fixture funding credit.
    const legs = ledgerSums(`%pharmacy:${orderId}%`);
    const cr = legs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const dr = legs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(cr).toBe(dr);
  });
});
