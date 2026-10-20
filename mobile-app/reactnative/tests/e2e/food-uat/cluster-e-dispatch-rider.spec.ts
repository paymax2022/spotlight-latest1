import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Cluster E — Dispatch, Rider, Tracking & Pickup (RST-UAT-0169 .. 0218).
 *
 * Two kinds of evidence:
 *  - UI cases drive the RN-web rider/customer screens (Food runs in mock mode
 *    by default: EXPO_PUBLIC_FOOD_USE_MOCK=true).
 *  - Backend-semantics cases are verified STATICALLY against product source
 *    (read-only) because no live rider/driver seed is available in the web
 *    harness. They are labelled "[static]".
 *
 * Cases that assert a defect use `test.fail()` — the case is EXPECTED to fail
 * today. When the defect is fixed, Playwright flags the unexpected pass; then
 * remove the `test.fail()` line. Defect IDs: FOOD-UAT-E-NNN (see results doc).
 */

const REPO = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(REPO, rel));

const DISPATCH = 'backend/internal/restaurant/dispatch.go';
const DELIVERY = 'backend/internal/restaurant/delivery.go';
const SERVICE = 'backend/internal/restaurant/service.go';
const ROUTES = 'backend/internal/app/finance_routes.go';
const RIDER_ACTIVE = 'mobile-app/reactnative/app/food/rider/[orderId].tsx';
const RIDER_OFFERS = 'mobile-app/reactnative/app/food/rider/index.tsx';
const ORDER_SCREEN = 'mobile-app/reactnative/app/food/orders/[orderId].tsx';

/** Body of a Go func (from its signature to the next top-level `\n}`). */
function goFunc(src: string, signature: string): string {
  const i = src.indexOf(signature);
  if (i < 0) throw new Error(`signature not found: ${signature}`);
  const end = src.indexOf('\n}\n', i);
  return src.slice(i, end + 3);
}

/** Every non-test .go file under backend/ (for "is it ever called" checks). */
function backendGoNonTest(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) out.push(p);
    }
  };
  walk(path.join(REPO, 'backend'));
  return out;
}
function callSites(symbol: string): number {
  const re = new RegExp(`\\.${symbol}\\(`);
  return backendGoNonTest().filter((f) => re.test(fs.readFileSync(f, 'utf8'))).length;
}

/**
 * The Metro dev server on :8083 runs with EXPO_PUBLIC_FOOD_USE_MOCK=false (live
 * mode), and the harness's fake Supabase token is 401'd by the Go API (which
 * triggers the global sign-out). So the Go food API is route-mocked here with a
 * small STATEFUL fake that speaks the CLIENT-expected wire shape. The Go-real
 * response shapes are asserted separately (see FOOD-UAT-E-018 cases).
 */
const PICKUP_CODE = '4321';
const DELIVERY_CODE = '8765';
type FakeOrder = Record<string, any>;
function freshOrder(): FakeOrder {
  return {
    id: 'ord-e-1',
    restaurantId: 'rest-1',
    restaurantName: 'Chicken Republic',
    status: 'ready',
    dispatchStatus: 'searching',
    items: [{ itemId: 'm1', name: 'Combo Meal', qty: 2, priceKobo: 280000 }],
    subtotalKobo: 560000,
    totalKobo: 640000,
    deliveryAddress: '8 Opebi Road, Ikeja',
    restaurantLocation: { lat: 6.6018, lng: 3.3515 },
    deliveryLocation: { lat: 6.585, lng: 3.357 },
    rider: null,
    riderId: null,
    deliveryCode: DELIVERY_CODE,
    createdAt: new Date().toISOString(),
  };
}
async function installFoodApiFake(page: Page) {
  const st = { order: freshOrder(), declined: false, handoffPosts: 0, pickupPosts: 0, locationPosts: [] as any[] };
  const json = (route: any, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/food/cart**', (r) => json(r, { data: null }));
  await page.route('**/api/v1/restaurant/orders/*/ws', (r) => r.abort());
  await page.route('**/api/finance/restaurant/**', async (route) => {
    const u = new URL(route.request().url());
    const m = route.request().method();
    const p = u.pathname.replace('/api/finance/restaurant', '');
    const o = st.order;
    if (m === 'GET' && p === '/rider/offers') {
      const open = o.status === 'ready' && !o.riderId && !st.declined;
      return json(route, { data: open ? [{
        order_id: o.id, restaurant_name: o.restaurantName, delivery_address: o.deliveryAddress,
        payout_kobo: 90000, distance_meters: 2800, item_count: 2,
        restaurant_location: o.restaurantLocation, delivery_location: o.deliveryLocation,
      }] : [] });
    }
    if (m === 'GET' && p === '/rider/active') {
      return json(route, { data: o.riderId && o.status !== 'delivered' ? o : null });
    }
    if (m === 'GET' && p === `/orders/${o.id}`) return json(route, { data: o });
    if (m === 'GET' && p.endsWith('/messages')) return json(route, { data: [] });
    if (m === 'POST' && p === `/orders/${o.id}/accept`) {
      Object.assign(o, { status: 'assigned', dispatchStatus: 'assigned', riderId: 'rider-1',
        rider: { id: 'rider-1', name: 'Tunde A.', vehicle: 'Bike', rating: 4.9, location: o.restaurantLocation } });
      return json(route, { data: o });
    }
    if (m === 'POST' && p === `/orders/${o.id}/decline`) { st.declined = true; return json(route, { ok: true }); }
    if (m === 'POST' && p === `/orders/${o.id}/pickup`) {
      st.pickupPosts++;
      const code = JSON.parse(route.request().postData() || '{}').code;
      if (code !== PICKUP_CODE) return json(route, { error: 'restaurant: incorrect pickup code' }, 400);
      o.status = 'picked_up';
      return json(route, { data: o });
    }
    if (m === 'POST' && p === `/orders/${o.id}/handoff`) {
      st.handoffPosts++;
      const code = JSON.parse(route.request().postData() || '{}').code;
      if (o.status !== 'picked_up') return json(route, { error: `restaurant: cannot move order from ${o.status} to delivered` }, 400);
      if (code !== DELIVERY_CODE) return json(route, { error: 'restaurant: incorrect delivery code' }, 400);
      Object.assign(o, { status: 'delivered', dispatchStatus: 'delivered' });
      return json(route, { data: o });
    }
    if (m === 'POST' && p === `/orders/${o.id}/location`) {
      st.locationPosts.push(JSON.parse(route.request().postData() || '{}'));
      return json(route, { ok: true }, 202);
    }
    return json(route, { data: null });
  });
  return st;
}

async function openAsRider(page: Page) {
  await mockAmbientRequests(page);
  const st = await installFoodApiFake(page);
  await loginAs(page);
  await page.goto('/food/rider');
  return st;
}

/** Rider accepts the offer and lands on the active-delivery screen. */
async function acceptOffer(page: Page) {
  const st = await openAsRider(page);
  await expect(page.getByText('Accept delivery').first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('Accept delivery').first().click();
  await expect(page.getByText('Active delivery', { exact: true })).toBeVisible({ timeout: 30_000 });
  return st;
}

// ───────────────────────── Dispatch and Assignment ─────────────────────────
test.describe('Dispatch and Assignment (RST-UAT-0169..0179)', () => {
  test('RST-UAT-0169 — Create dispatch request once [static]', () => {
    const d = read(DISPATCH);
    const fn = goFunc(d, 'func (s *Service) DispatchOrder');
    expect(fn).toContain('if existingRider != nil');
    expect(fn).toContain('ON CONFLICT (order_id, rider_id) DO NOTHING');
    expect(read('supabase/migrations/20260708000000_restaurant_autodispatch.sql')).toContain(
      'UNIQUE (order_id, rider_id)',
    );
  });

  test('RST-UAT-0170 — Assign nearest eligible online rider [static]', () => {
    const d = read(DISPATCH);
    expect(d).toContain("d.status = 'online' AND d.verification_status = 'approved'");
    expect(d).toContain('return a.DistanceSq < b.DistanceSq'); // nearest first
  });

  test('RST-UAT-0170b — dispatch honours service-zone / max radius (FOOD-UAT-E-001)', () => {
    test.fail(true, 'FOOD-UAT-E-001: no zone/radius predicate in rider sourcing query');
    const q = goFunc(read(DISPATCH), 'func (s *Service) DispatchOrder');
    expect(q).toMatch(/zone|radius|max_distance|ST_DWithin/i);
  });

  test('RST-UAT-0171 — Exclude offline or suspended rider (offer side) [static]', () => {
    expect(read(DISPATCH)).toContain("d.status = 'online' AND d.verification_status = 'approved'");
  });

  test('RST-UAT-0171b — offline rider cannot ACCEPT a stale offer (FOOD-UAT-E-002)', () => {
    test.fail(true, 'FOOD-UAT-E-002: AcceptDelivery checks approved only, not online/capacity');
    const fn = goFunc(read(DELIVERY), 'func (s *Service) AcceptDelivery');
    expect(fn).toMatch(/d\.status\s*=\s*'online'|status\s*=\s*'online'/);
  });

  test('RST-UAT-0172 — Enforce rider capacity (offer side) [static]', () => {
    const d = read(DISPATCH);
    expect(d).toContain('baseMaxRiderLoad = 3');
    expect(d).toContain('if c.ActiveLoad < maxLoad');
  });

  test('RST-UAT-0172b — capacity re-checked at accept time (FOOD-UAT-E-002)', () => {
    test.fail(true, 'FOOD-UAT-E-002: fan-out offers N orders to the same rider; accept never re-checks load');
    const fn = goFunc(read(DELIVERY), 'func (s *Service) AcceptDelivery');
    expect(fn).toMatch(/active_load|maxLoad|MaxRiderLoad|count\(\*\)\s+FROM orders/i);
  });

  test('RST-UAT-0173 — Offer with limited acceptance window (FOOD-UAT-E-003)', () => {
    test.fail(true, 'FOOD-UAT-E-003: offers have no expiry; sweepers have no caller');
    const mig = read('supabase/migrations/20260708000000_restaurant_autodispatch.sql');
    expect(mig).toMatch(/expires_at/i);
  });

  test('RST-UAT-0174 — Prevent double-claim race [static]', () => {
    const fn = goFunc(read(DELIVERY), 'func (s *Service) AcceptDelivery');
    expect(fn).toContain('FOR UPDATE');
    expect(fn).toContain('order already has a rider');
  });

  test('RST-UAT-0175 — Reassign rejected job [static]', () => {
    const fn = goFunc(read(DISPATCH), 'func (s *Service) DeclineDelivery');
    expect(fn).toContain("status='declined'");
    expect(fn).toContain('openOffers == 0');
    expect(fn).toContain('s.DispatchOrder');
  });

  test('RST-UAT-0175b — re-dispatch reaches riders beyond the already-declined (FOOD-UAT-E-004)', () => {
    test.fail(true, 'FOOD-UAT-E-004: sourcing query does not exclude riders who already have an offer row');
    const fn = goFunc(read(DISPATCH), 'func (s *Service) DispatchOrder');
    expect(fn).toMatch(/NOT EXISTS[\s\S]{0,200}restaurant_delivery_offers/i);
  });

  test('RST-UAT-0176 — Recover when no rider available (honest status) [static]', () => {
    const fn = goFunc(read(DISPATCH), 'func (s *Service) DispatchOrder');
    expect(fn).toContain('EventOrderNoRiders');
    expect(fn).toContain('searching_rider');
    expect(read(ORDER_SCREEN)).toContain('Finding a rider for your order');
  });

  test('RST-UAT-0176b — stalled-dispatch refund sweeper is actually scheduled (FOOD-UAT-E-003)', () => {
    test.fail(true, 'FOOD-UAT-E-003: SweepStalledDispatch has zero non-test callers');
    expect(callSites('SweepStalledDispatch')).toBeGreaterThan(0);
  });

  test('RST-UAT-0177 — Reassign rider no-show (pickup-SLA policy) (FOOD-UAT-E-003)', () => {
    test.fail(true, 'FOOD-UAT-E-003: only manual/offline reassign; no pickup-SLA no-show trigger, sweeper unscheduled');
    expect(callSites('SweepOfflineAssigned')).toBeGreaterThan(0);
  });

  test('RST-UAT-0178 — Prevent post-pickup silent reassignment [static]', () => {
    const fn = goFunc(read(DISPATCH), 'func (s *Service) ReassignOrder');
    expect(fn).toContain('OrderPickedUp');
    expect(fn).toContain('cannot reassign an order already picked up or delivered');
  });

  test.skip('RST-UAT-0179 — Exclude ineligible vehicle mode — N/A: no per-order vehicle requirement; dispatch.go/delivery.go never reference vehicle', () => {});
});

// ───────────────────────── Rider Availability and Jobs ─────────────────────
test.describe('Rider Availability and Jobs (RST-UAT-0180..0196)', () => {
  test('RST-UAT-0180 — Go online after approval (Food rider console has no availability control)', async ({ page }) => {
    await openAsRider(page);
    await expect(page.getByText('Rider · Offers')).toBeVisible();
    // Blocked: availability is owned by the shared transport `drivers` pool.
    test.info().annotations.push({ type: 'blocked', description: 'No online/offline switch in app/food/rider/*; drivers.status owned by transport module' });
    expect(await page.getByRole('switch').count()).toBe(0);
  });

  test('RST-UAT-0181 — Reject go-online while pending [static]', () => {
    // Pending/unapproved riders are never sourced and cannot accept.
    expect(read(DISPATCH)).toContain("d.verification_status = 'approved'");
    expect(goFunc(read(DELIVERY), 'func (s *Service) AcceptDelivery')).toContain('only an approved rider may accept');
  });

  test.skip('RST-UAT-0182 — Go offline when idle — BLOCKED: toggle lives in transport driver module, not Food rider screens', () => {});
  test.skip('RST-UAT-0183 — Handle offline during active job — BLOCKED: no offline control in Food; SweepOfflineAssigned only covers pre-pickup and is unscheduled', () => {});

  test('RST-UAT-0184 — Accept valid job offer (payout shown, route, masked address)', async ({ page }) => {
    await openAsRider(page);
    await expect(page.getByText('Available offers')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Chicken Republic').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/₦\s?900/).first()).toBeVisible(); // payout estimate
    await page.getByText('Accept delivery').first().click();
    await expect(page.getByText('Active delivery', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Drop-off:').first()).toBeVisible();
    // Contact masking: the rider screen exposes no customer phone, chat only.
    expect(await page.getByText(/\+234\d{9,}/).count()).toBe(0);
    // Server-side masking before accept
    expect(goFunc(read(DELIVERY), 'func (s *Service) RiderOffers')).toContain('maskDeliveryAddress');
  });

  test('RST-UAT-0184b — Go-real /rider/offers shape renders offers (FOOD-UAT-E-018)', async ({ page }) => {
    test.fail(true, 'FOOD-UAT-E-018: Go returns {"offers":[Order]}; client getRiderOffers expects a flat array of {order_id,payout_kobo,item_count,...}');
    await mockAmbientRequests(page);
    await page.route('**/api/v1/food/cart**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' }));
    await page.route('**/api/finance/restaurant/rider/active', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"deliveries":[]}' }));
    // Exactly what handler_delivery.go RiderOffers emits (orders.Order JSON, snake_case):
    await page.route('**/api/finance/restaurant/rider/offers', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ offers: [{
        id: 'ord-go-1', customer_id: 'c1', restaurant_id: 'r1', items: [], subtotal_kobo: 500000, delivery_kobo: 90000,
        total_kobo: 640000, status: 'ready', delivery_address: 'Ikeja (approx.)', dispatch_status: 'searching',
      }] }) }));
    await loginAs(page);
    await page.goto('/food/rider');
    await expect(page.getByText('Accept delivery').first()).toBeVisible({ timeout: 20_000 });
  });

  test('RST-UAT-0185 — Reject job without side effects', async ({ page }) => {
    const st = await openAsRider(page);
    await expect(page.getByText('Decline').first()).toBeVisible({ timeout: 30_000 });
    page.on('dialog', (d) => d.accept());
    await page.getByText('Decline', { exact: true }).first().click();
    if (await page.getByText('Decline this delivery?').isVisible().catch(() => false)) {
      await page.getByText('Decline', { exact: true }).last().click();
    }
    await expect(page.getByText('No offers right now')).toBeVisible({ timeout: 20_000 });
    expect(st.order.status).toBe('ready'); // order untouched, only hidden from this rider
    expect(st.order.riderId).toBeNull();
    expect(goFunc(read(DISPATCH), 'func (s *Service) DeclineDelivery')).not.toMatch(/settle|ledger|refund|earning/i);
  });

  test('RST-UAT-0186 — Arrive at restaurant and confirm pickup with correct code', async ({ page }) => {
    const st = await acceptOffer(page);
    await expect(page.getByText('Confirm pickup').first()).toBeVisible();
    await page.getByLabel('Pickup code').fill(PICKUP_CODE);
    await page.getByText('Confirm pickup', { exact: true }).last().click();
    await expect(page.getByText('Confirm handoff').first()).toBeVisible({ timeout: 20_000 });
    expect(st.order.status).toBe('picked_up');
    const fn = goFunc(read(DISPATCH), 'func (s *Service) ConfirmPickup'); // [static] custody evidence
    expect(fn).toContain('picked_up_at=COALESCE(picked_up_at, now())');
  });

  test('RST-UAT-0187 — Reject incorrect pickup code (UI)', async ({ page }) => {
    const st = await acceptOffer(page);
    const dialogs: string[] = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    await page.getByLabel('Pickup code').fill('0000');
    await page.getByText('Confirm pickup', { exact: true }).last().click();
    await expect.poll(() => st.pickupPosts, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.getByText('Confirm handoff')).toHaveCount(0);
    expect(st.order.status).toBe('assigned');
  });

  test('RST-UAT-0187b — pickup-code attempts are rate-limited / locked out (FOOD-UAT-E-008)', () => {
    test.fail(true, 'FOOD-UAT-E-008: 4-digit pickup/delivery codes, unlimited guesses, no per-order attempt counter or route limiter');
    const fn = goFunc(read(DISPATCH), 'func (s *Service) ConfirmPickup');
    expect(fn).toMatch(/attempt|lock|rate|ConstantTimeCompare/i);
    const routes = read(ROUTES);
    expect(routes).toMatch(/orders\/:orderId\/pickup",[^\n]*(RateLimit|rate)/i);
  });

  test('RST-UAT-0188 — Block premature delivery status (rejected, but not atomically) (FOOD-UAT-E-009)', () => {
    // Rejection holds: public UpdateStatus forbids delivered; FSM refuses ready→delivered.
    expect(goFunc(read(SERVICE), 'func (s *Service) UpdateStatus')).toContain('authorizeStatusChange');
    test.fail(true, 'FOOD-UAT-E-009: ConfirmHandoff writes delivered_at + dispatch_status=delivered BEFORE the FSM guard, outside a tx');
    const fn = goFunc(read(DISPATCH), 'func (s *Service) ConfirmHandoff');
    const writeIdx = fn.indexOf("dispatch_status='delivered'");
    const guardIdx = fn.indexOf('transitionInternal');
    expect(writeIdx).toBeGreaterThan(guardIdx); // expected: write AFTER guard
  });

  test.skip('RST-UAT-0189 — Confirm destination arrival — N/A: no arrived-at-destination state in order FSM (model.go statuses, rider/[orderId].tsx); logged as feature gap FOOD-UAT-E-010', () => {});

  test('RST-UAT-0190 — Complete delivery with proof (delivery code) [static]', () => {
    const fn = goFunc(read(DISPATCH), 'func (s *Service) ConfirmHandoff');
    expect(fn).toContain('incorrect delivery code');
    expect(fn).toContain('OrderDelivered');
    expect(goFunc(read(SERVICE), 'func (s *Service) transitionInternal')).toContain('settleOrder');
    expect(read(RIDER_ACTIVE)).toContain('Confirm handoff & complete');
  });

  test('RST-UAT-0191 — Reject fake delivery proof (wrong code rejected; brute force open) (FOOD-UAT-E-008)', () => {
    expect(goFunc(read(DISPATCH), 'func (s *Service) ConfirmHandoff')).toContain('code != *dbCode');
    test.fail(true, 'FOOD-UAT-E-008: wrong delivery code is rejected but guesses are unlimited (10^4 space)');
    expect(goFunc(read(DISPATCH), 'func (s *Service) ConfirmHandoff')).toMatch(/attempt|lock|rate/i);
  });

  test('RST-UAT-0192 — Avoid duplicate delivery settlement [static + UI]', () => {
    // Second call hits terminal state: delivered→delivered not in FSM.
    expect(read(SERVICE)).toMatch(/OrderPickedUp:\s+fsm\.Set\(OrderDelivered, OrderDeliveryFailed\)/);
    // UI button disabled while pending
    expect(read(RIDER_ACTIVE)).toContain('loading={confirmHandoff.isPending}');
  });

  test('RST-UAT-0188b — premature Delivered cannot be driven from the rider UI', async ({ page }) => {
    const st = await acceptOffer(page);
    // Before pickup the handoff card must not exist at all.
    await expect(page.getByLabel('Delivery code')).toHaveCount(0);
    await expect(page.getByText('Confirm handoff & complete')).toHaveCount(0);
    expect(st.handoffPosts).toBe(0);
  });

  test('RST-UAT-0190b — complete delivery with correct code; double-tap posts once', async ({ page }) => {
    const st = await acceptOffer(page);
    await page.getByLabel('Pickup code').fill(PICKUP_CODE);
    await page.getByText('Confirm pickup', { exact: true }).last().click();
    await expect(page.getByLabel('Delivery code')).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Delivery code').fill(DELIVERY_CODE);
    const btn = page.getByText('Confirm handoff & complete');
    await btn.click();
    await btn.click({ timeout: 1000 }).catch(() => {});
    await expect(page.getByText('Delivery confirmed. Nice work!')).toBeVisible({ timeout: 20_000 });
    expect(st.handoffPosts).toBe(1);
    expect(st.order.status).toBe('delivered');
  });

  test('RST-UAT-0193 — Report failed delivery attempt is reachable (FOOD-UAT-E-011)', () => {
    test.fail(true, 'FOOD-UAT-E-011: MarkDeliveryFailed has no route, handler or rider UI');
    expect(callSites('MarkDeliveryFailed')).toBeGreaterThan(0);
    expect(read(ROUTES)).toMatch(/delivery-failed|failed-delivery|deliveryfailed/i);
  });

  test.skip('RST-UAT-0194 — Use route deep link safely — N/A: no maps deep-link (Linking/openURL) in app/food/rider/*; in-app MobilityMap only', () => {});

  test('RST-UAT-0195 — Recover interrupted rider session [static]', () => {
    expect(read(RIDER_OFFERS)).toContain('You have an active delivery');
    expect(read(DELIVERY)).toContain('func (s *Service) RiderActive');
  });

  test('RST-UAT-0195b — /rider/active wire shape matches client (FOOD-UAT-E-018)', () => {
    test.fail(true, 'FOOD-UAT-E-018: Go emits {"deliveries":[Order]} (array); client getRiderActive unwraps a single Order|null');
    expect(read('backend/internal/restaurant/handler_delivery.go')).not.toMatch(/gin\.H\{"deliveries": active\}/);
  });

  test('RST-UAT-0196 — Handle expiring rider credential mid-shift [static]', () => {
    // New sourcing gated on verification_status='approved'; in-flight job untouched.
    expect(read(DISPATCH)).toContain("d.verification_status = 'approved'");
    expect(goFunc(read(DELIVERY), 'func (s *Service) AcceptDelivery')).toContain('verification_status');
  });
});

// ───────────────────────── Tracking, ETA and Privacy ───────────────────────
test.describe('Tracking, ETA and Privacy (RST-UAT-0197..0202)', () => {
  test('RST-UAT-0197 — Show correct live stage (rider view, forward-only FSM)', async ({ page }) => {
    await acceptOffer(page);
    await expect(page.getByText('Pickup:').first()).toBeVisible();
    expect(read(SERVICE)).toMatch(/OrderPickedUp:\s+fsm\.Set\(OrderDelivered, OrderDeliveryFailed\)/);
  });

  test('RST-UAT-0198 — Customer sees live rider map once assigned', async ({ page }) => {
    const st = await acceptOffer(page);
    expect(st.order.status).toBe('assigned');
    await page.goto(`/food/orders/${st.order.id}`);
    await expect(page.getByText('Live rider tracking')).toBeVisible({ timeout: 30_000 });
  });

  test('RST-UAT-0198b — tracking shows a live ETA (FOOD-UAT-E-014)', () => {
    test.fail(true, 'FOOD-UAT-E-014: order tracking screen never renders an ETA');
    expect(read(ORDER_SCREEN)).toMatch(/\bETA\b|eta[A-Z]|arriv(es|ing) in/i);
  });

  test('RST-UAT-0199 — Handle GPS unavailable mid-trip: rider app posts real device GPS + last-updated shown (FOOD-UAT-E-012)', () => {
    test.fail(true, 'FOOD-UAT-E-012: rider heartbeat re-posts order.rider.location (server echo), never device GPS; no last-updated on customer map');
    expect(read(RIDER_ACTIVE)).toMatch(/useDeviceCoords|Location\.watchPosition|geolocation/);
    expect(read(ORDER_SCREEN)).toMatch(/last updated|updated .* ago/i);
  });

  test('RST-UAT-0200 — Stop location visibility after completion', () => {
    // UI: rider card + map hidden once terminal.
    const src = read(ORDER_SCREEN);
    expect(src).toContain('order.rider && !isTerminalStatus(status)');
    expect(src).toContain('isLiveTrackable(status)');
    // Socket is order-bound + participant-gated.
    expect(read('backend/internal/restaurant/ws_tracking.go')).toContain('p.OrderID != orderID');
  });

  test('RST-UAT-0200b — rider position posts rejected / purged after delivery (FOOD-UAT-E-013)', () => {
    test.fail(true, 'FOOD-UAT-E-013: PostLocation has no status gate and restaurant_rider_locations has no retention');
    const fn = goFunc(read(DELIVERY), 'func (s *Service) PostLocation');
    expect(fn).toMatch(/status|delivered|terminal/i);
  });

  test('RST-UAT-0201 — No customer access to other orders [static]', () => {
    const fn = goFunc(read(DELIVERY), 'func (s *Service) GetOrder');
    expect(fn).toContain('not a participant of this order');
    expect(goFunc(read(DELIVERY), 'func (s *Service) PostLocation')).toContain('only the assigned rider may post location');
    expect(read('backend/internal/restaurant/ws_tracking.go')).toContain('hmac.Equal');
  });

  test('RST-UAT-0202 — Avoid false ETA under route failure (no fabricated ETA shown)', () => {
    expect(read(ORDER_SCREEN)).not.toMatch(/\b\d+\s*min\b.*arriv/i);
  });
});

// ───────────────────────── Pickup Journey (customer self-collect) ──────────
const PICKUP_NA =
  'N/A — no customer self-pickup fulfilment: checkout.tsx / features/food/types.ts / restaurant model.go have no pickup|collect fulfilment type; orders.delivery_address is mandatory; `pickup_code` is the restaurant→RIDER handoff only';
test.describe('Pickup Journey (RST-UAT-0203..0208)', () => {
  test('RST-UAT-0203..0208 pre-check — checkout offers no Pickup/Collect option', () => {
    const checkout = read('mobile-app/reactnative/app/food/checkout.tsx');
    expect(checkout).not.toMatch(/fulfil|self.?pickup|collect(ion)?\b|dine.?in/i);
  });
  for (const [id, t] of [
    ['0203', 'Place restaurant pickup order'],
    ['0204', 'Issue pickup reference securely'],
    ['0205', 'Confirm correct handover'],
    ['0206', 'Reject wrong pickup code'],
    ['0207', 'Prevent repeat collection'],
    ['0208', 'Handle no-show pickup'],
  ]) {
    test.skip(`RST-UAT-${id} — ${t} — ${PICKUP_NA}`, () => {});
  }
});

// ───────────────────────── Dine-In & Reservations ──────────────────────────
const DINE_NA =
  'N/A — no dine-in/table/reservation surface in current Food module (per code search in backend/internal/restaurant/ and mobile-app/reactnative/app/food/)';
test.describe('Dine-In and Tables / Reservations (RST-UAT-0209..0218)', () => {
  test('RST-UAT-0209..0218 pre-check — no table/dine-in/reservation code in Food module', () => {
    const dirs = ['backend/internal/restaurant', 'mobile-app/reactnative/app/food'];
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.(go|tsx?)$/.test(e.name) || e.name.endsWith('_test.go')) continue;
        const txt = read(rel);
        if (/dine.?in|table_?(number|id|session)|table[ _]qr|reservation(s)?\b(?![\s\S]{0,40}(promo|escrow))/i.test(txt)) {
          // promo.go/service.go only say "reservation" for promo-allowance/escrow bookkeeping
          if (!/promo|escrow/i.test(txt.match(/.{0,80}reservation.{0,80}/i)?.[0] ?? 'promo')) hits.push(rel);
        }
      }
    };
    dirs.forEach(walk);
    expect(hits).toEqual([]);
    expect(exists('backend/internal/restaurant/reservations.go')).toBe(false);
  });
  for (const [id, t] of [
    ['0209', 'Scan table QR and open menu'],
    ['0210', 'Reject tampered QR table id'],
    ['0211', 'Add orders to active table session'],
    ['0212', 'Settle table and close session'],
    ['0213', 'Prevent editing another table'],
    ['0214', 'Reserve available slot'],
    ['0215', 'Prevent capacity overbooking'],
    ['0216', 'Reject booking in closed period'],
    ['0217', 'Modify and cancel booking'],
    ['0218', 'Process guest arrival and no-show'],
  ]) {
    test.skip(`RST-UAT-${id} — ${t} — ${DINE_NA}`, () => {});
  }
});
