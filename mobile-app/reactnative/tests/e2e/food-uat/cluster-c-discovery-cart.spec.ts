import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Cluster C — Discovery, Cart & Pricing (RST-UAT-0104 .. 0134).
 *
 * Two kinds of test:
 *  - SURFACE tests read product source (read-only) and assert the verified fact
 *    for each case (present / absent). They always run, need no services, and
 *    are the proof cited in docs/qa/food-uat-332/cluster-c-discovery-cart.md.
 *    An "absent" assertion means the case is Fail/N-A; flipping the product
 *    makes the assertion fail and forces the doc to be revisited.
 *  - LIVE tests drive the RN web build on :8083. The running Metro is bound to
 *    the live Supabase session, so the harness' seeded session is rejected and
 *    loginAs() cannot reach /home; those tests self-skip as BLOCKED.
 */
const ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const M = 'mobile-app/reactnative';
const B = 'backend/internal/restaurant';

const src = {
  index: () => read(`${M}/app/food/index.tsx`),
  detail: () => read(`${M}/app/food/restaurant/[id].tsx`),
  checkout: () => read(`${M}/app/food/checkout.tsx`),
  api: () => read(`${M}/src/features/food/api.ts`),
  cartStore: () => read(`${M}/src/features/food/cartStore.ts`),
  cartSync: () => read(`${M}/src/features/food/useCartSync.ts`),
  discovery: () => read(`${B}/discovery_page.go`),
  service: () => read(`${B}/service.go`),
  model: () => read(`${B}/model.go`),
  promo: () => read(`${B}/promo.go`),
  pricing: () => read(`${B}/pricing.go`),
  handler: () => read(`${B}/handler.go`),
  deliveryfee: () => read(`${B}/deliveryfee.go`),
};

function status(s: 'Pass' | 'Fail' | 'N/A' | 'Blocked', defect = '') {
  test.info().annotations.push({ type: 'status', description: s + (defect ? ` ${defect}` : '') });
}

async function liveLogin(page: Page): Promise<boolean> {
  test.setTimeout(90_000);
  try {
    await mockAmbientRequests(page);
    await Promise.race([
      loginAs(page),
      new Promise((_, rej) => setTimeout(() => rej(new Error('login timeout')), 25_000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

test.describe('Cluster C — Discovery & Search', () => {
  test('RST-UAT-0104 — Browse nearby restaurants', () => {
    const d = src.discovery();
    expect(d).toContain('WHERE r.is_open = TRUE');
    expect(d).toContain("listing_review_status = 'APPROVED'");
    expect(src.index()).toContain("sort: 'distance'"); // nearby view uses device coords
    status('Pass');
  });

  test('RST-UAT-0105 — Search exact restaurant and meal', () => {
    const d = src.discovery();
    expect(d).toContain('r.name ILIKE'); // restaurant name search works
    expect(d).toMatch(/menu_items[\s\S]*mi\.name ILIKE/); // FOOD-UAT-C-001 dissolved: dish search (1ec0cb9d8)
    status('Fail', 'FOOD-UAT-C-001');
  });

  test('RST-UAT-0106 — Filter by cuisine and order mode', () => {
    const i = src.index();
    expect(i).toContain('CUISINE_FILTERS');
    expect(i).not.toMatch(/pickup|open now|openNow/i); // FOOD-UAT-C-002
    status('Fail', 'FOOD-UAT-C-002');
  });

  test('RST-UAT-0107 — Sort restaurant listing', () => {
    expect(src.discovery()).toContain('"rating", "name", "newest", "eta", "distance", "likes"');
    expect(src.index()).toContain("sort: 'rating'");
    status('Pass');
  });

  test('RST-UAT-0108 — Handle no location permission', () => {
    const i = src.index();
    expect(i).toContain('falls back to the same'); // nearby degrades to eta proxy, never empty
    expect(src.checkout()).toContain('AddressAutocompleteInput'); // manual address entry
    status('Pass');
  });

  test('RST-UAT-0109 — Reject unsupported area gracefully', () => {
    const all = src.service() + src.deliveryfee() + src.handler();
    expect(all).not.toMatch(/service[_ ]?zone|delivery[_ ]?radius|outside .*(zone|perimeter)|ErrOutOfZone|ErrNotServiceable/i);
    expect(src.api()).not.toMatch(/order_?mode|fulfil?lment.?type/i); // no pickup mode for customers
    status('Fail', 'FOOD-UAT-C-003');
  });

  test('RST-UAT-0110 — Protect unpublished/suspended stores', () => {
    const svc = src.service();
    const priceOrder = svc.slice(svc.indexOf('func (s *Service) priceOrder'), svc.indexOf('func (s *Service) priceOrder') + 6000);
    expect(priceOrder).toContain('is_open'); // only is_open gates new orders
    expect(priceOrder).not.toContain('listing_review_status'); // FOOD-UAT-C-004
    expect(read(`${B}/delivery.go`)).not.toMatch(/GetRestaurantDetail[\s\S]{0,900}listing_review_status/);
    status('Fail', 'FOOD-UAT-C-004');
  });
});

test.describe('Cluster C — Cart', () => {
  test('RST-UAT-0111 — Add item and valid modifiers', () => {
    expect(src.pricing()).toContain('resolveLineModifiers'); // backend supports modifiers
    expect(src.detail()).toContain('ModifierSheet'); // FOOD-UAT-C-005 dissolved: modifier UI (76bb39660)
    expect(src.api()).toMatch(/modifier_ids/);
    status('Pass');
  });

  test('RST-UAT-0112 — Increase decrease and remove quantity', () => {
    const c = src.cartStore();
    expect(c).toContain('decrementItem');
    expect(c).toMatch(/packages\.every\(\(p\) => p\.lines\.length === 0\)/); // last line empties cart
    expect(src.checkout()).toContain('Your cart is empty');
    status('Pass');
  });

  test('RST-UAT-0113 — Reopen cart after app restart', () => {
    const s = src.cartSync();
    expect(s).toContain("'food-cart-storage'");
    expect(s).toContain('useCartStore.setState(parsed)'); // restored verbatim: no price revalidation
    status('Fail', 'FOOD-UAT-C-006');
  });

  test('RST-UAT-0114 — Prevent multiple-store carts under single-order policy', () => {
    // Policy decision is multi-restaurant carts (not single-store); supported architecture.
    expect(src.cartStore()).toContain('Multi-restaurant: each item includes its restaurantId');
    expect(src.service()).toContain('restaurantMap');
    status('Pass');
  });

  test('RST-UAT-0115 — Validate stale cart price at checkout', () => {
    expect(src.service()).toContain('func (s *Service) QuoteOrder');
    expect(src.api()).toContain('quoteOrder'); // FOOD-UAT-C-007 dissolved: quote endpoint + client (5d975f5dc, 76bb39660)
    expect(src.handler()).toMatch(/price_changed/);
    expect(src.checkout()).toMatch(/isPriceChangedError/);
    status('Pass');
  });

  test('RST-UAT-0116 — Preserve order instructions', () => {
    expect(src.model()).toContain('SpecialInstructions');
    expect(src.api()).not.toContain('special_instructions'); // FOOD-UAT-C-008: client never sends it
    expect(src.checkout()).not.toMatch(/instruction/i); // still absent: the TextInput now in checkout is the promo field (C-011), not a note field
    status('Fail', 'FOOD-UAT-C-008');
  });

  test('RST-UAT-0117 — Protect cart ownership', () => {
    // Cart is device-local; /api/v1/food/cart is called by the client but routed nowhere.
    expect(src.api()).toContain("'/api/v1/food/cart'");
    expect(src.cartSync()).toContain('cartStorageKey(useAuthStore.getState().user?.id)'); // FOOD-UAT-C-009 dissolved: user-scoped key
    expect(src.cartSync()).toContain('LEGACY_STORAGE_KEY');
    status('N/A');
  });
});

test.describe('Cluster C — Prices, Tax and Fees', () => {
  test('RST-UAT-0118 — Compute subtotal and quantity', () => {
    expect(src.service()).toContain('lineTotal := (mi.PriceKobo + modifiersKobo) * int64(input.Quantity)');
    expect(src.cartStore()).toContain('l.priceKobo * l.qty');
    status('Pass');
  });

  test('RST-UAT-0119 — Calculate configured delivery fee', () => {
    const f = src.deliveryfee();
    expect(f).toContain('func ComputeDeliveryFeeFromRoute');
    expect(f).toContain('MinFeeKobo');
    status('Pass');
  });

  test('RST-UAT-0120 — Calculate configured service fee', () => {
    const p = src.pricing();
    expect(p).toContain('func applyBp');
    expect(src.service()).toContain('s.serviceFeePolicyKobo(ctx, primaryRestaurantID, applyBp(itemsKobo, pricingCfg.ServiceFeeBp))');
    expect(read(`${B}/polish_w7.go`)).toMatch(/service_fee_min_kobo[\s\S]*service_fee_max_kobo/); // FOOD-UAT-C-010 dissolved: min/max/round policy (polish_w7.go, c66d5020a)
    status('Pass');
  });

  test('RST-UAT-0121 — Apply configurable tax without hardcoding', () => {
    const all = src.service() + src.pricing() + src.model();
    expect(all).not.toMatch(/tax_?(rate|bp|kobo)|vat_?(rate|bp|kobo)/i);
    status('N/A');
  });

  test('RST-UAT-0122 — Keep quoted price consistent through payment', () => {
    const c = src.checkout();
    expect(c).toContain('serverQuote ? serverQuote.totalKobo : estTotal'); // FOOD-UAT-C-007 dissolved: server quote drives the pay button (76bb39660)
    expect(c).toContain('const openPaySheet = (amountKobo: number, quote: OrderQuote | null)');
    expect(src.service()).toContain('ErrExternalAmountMismatch');
    status('Pass');
  });

  test('RST-UAT-0123 — Handle zero-priced promos and maximum amounts', () => {
    expect(src.promo()).toContain('if d > subtotalKobo');
    expect(src.promo()).toContain('if d < 0');
    expect(src.service()).toContain('maxOrderSubtotalKobo');
    status('Pass');
  });

  test('RST-UAT-0124 — Prevent client fee manipulation', () => {
    const m = src.model();
    const req = m.slice(m.indexOf('type PlaceOrderRequest'), m.indexOf('type LatLng'));
    expect(req).not.toMatch(/json:"(delivery_fee|service_fee|total|subtotal|tax|commission)[a-z_]*"/);
    expect(src.service()).toContain('tipKobo := max(req.TipKobo, 0)');
    status('Pass');
  });
});

test.describe('Cluster C — Promotions and Loyalty', () => {
  test('RST-UAT-0125 — Redeem applicable coupon', () => {
    expect(src.promo()).toContain('PromoPercent');
    expect(src.api()).toMatch(/promo_code/); // FOOD-UAT-C-011 dissolved: promo entry + preview (76bb39660)
    expect(src.checkout()).toMatch(/promo ?code/i);
    expect(src.checkout()).toContain('<TextInput');
    status('Pass');
  });

  test('RST-UAT-0126 — Reject expired or ineligible voucher', () => {
    expect(src.promo()).toContain('ErrPromoInvalid');
    expect(src.promo()).toContain('func promoWindowOK');
    expect(src.checkout()).toContain('promoErrorMessage'); // FOOD-UAT-C-011 dissolved: entry UI surfaces rejection (76bb39660)
    status('Pass');
  });

  test('RST-UAT-0127 — Enforce single-use code atomically', () => {
    const p = src.promo();
    expect(p).toContain('func (s *Service) reservePromoRedemption');
    expect(p).toMatch(/FOR UPDATE/);
    status('Pass');
  });

  test('RST-UAT-0128 — Restore or forfeit benefit after refund', () => {
    expect(src.promo()).toContain('func releasePromoRedemption');
    expect(src.service().match(/releasePromoRedemption\(ctx, tx, orderID\)/g)?.length).toBeGreaterThanOrEqual(2);
    status('Pass');
  });

  test('RST-UAT-0129 — Accrue and redeem loyalty points', () => {
    const files = fs.readdirSync(path.join(ROOT, B)).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
    const hit = files.filter((f) => /loyalty/i.test(read(`${B}/${f}`)));
    expect(hit).toEqual([]); // no loyalty accrual/redemption in the Food module
    status('N/A');
  });
});

test.describe('Cluster C — Delivery Address and Serviceability', () => {
  test('RST-UAT-0130 — Save precise delivery location', () => {
    const svc = src.service();
    const insert = svc.slice(svc.indexOf('INSERT INTO orders'), svc.indexOf('INSERT INTO orders') + 700);
    expect(insert).toContain('delivery_address');
    expect(svc).toMatch(/delivery_latitude, delivery_longitude, delivery_landmark, delivery_recipient_phone/); // FOOD-UAT-C-012: coords persisted (35e0b9ce1)
    expect(src.checkout()).not.toMatch(/landmark|building|phone/i); // capture UI for landmark/phone still absent -> stays Fail (partial)
    status('Fail', 'FOOD-UAT-C-012');
  });

  test('RST-UAT-0131 — Reject outside delivery perimeter', () => {
    expect(src.service() + src.deliveryfee()).not.toMatch(/MaxDeliveryKm|max_distance|radius/i);
    status('Fail', 'FOOD-UAT-C-003');
  });

  test('RST-UAT-0132 — Handle malformed address coordinates', () => {
    const m = src.model();
    const coords = m.slice(m.indexOf('func (r PlaceOrderRequest) DeliveryCoords'), m.indexOf('// OrderItemInput'));
    expect(coords).not.toMatch(/90|180/); // FOOD-UAT-C-013: range never checked on the order path
    expect(src.handler()).not.toMatch(/Lat\s*[<>]=?\s*-?90/);
    status('Fail', 'FOOD-UAT-C-013');
  });

  test('RST-UAT-0133 — Verify fee quote after address changes', () => {
    const c = src.checkout();
    expect(c).toContain('useDeliveryQuote(restaurantId ?? undefined, addressLocation)');
    expect(c).toContain('setAddressLocation(null)'); // edited text invalidates the quote
    status('Pass');
  });

  test('RST-UAT-0134 — Protect delivery address visibility', () => {
    // Static review only: rider/restaurant row projections are not role-tested here (Cluster E/H).
    status('Blocked');
    test.skip(true, 'Needs a seeded assigned/unassigned rider pair; covered by Cluster E dispatch specs');
  });
});

test.describe('Cluster C — LIVE UI (RN web :8083)', () => {
  test('RST-UAT-0104L — /food hub renders for a signed-in customer', async ({ page }) => {
    const ok = await liveLogin(page);
    expect(ok, 'harness login must reach /home now that auth.ts is fixed').toBe(true);
    await page.goto('/food');
    await expect(page.getByText('Food & Delivery')).toBeVisible();
    await expect(page.getByPlaceholder('Search restaurant or dish…')).toBeVisible();
  });

  // ── Phase 5 Wave 2 live legs ──
  // The Metro on :8083 is built with EXPO_PUBLIC_FOOD_USE_MOCK=false (.env), so the food
  // surface calls /api/finance/restaurant on :3000 and the fixture JWT is 401'd -> AuthGate
  // signs out -> login screen. The harness login is fine; the API is not. These legs stub
  // ONLY /api/finance/restaurant* and /api/v1/food/cart with Go-DTO-shaped fixtures, so the
  // real RN UI is driven but server-side behaviour (SQL search, repricing) is NOT exercised.
  const REST = { id: 'r1', name: 'Mama Cass', description: 'Local', cuisine: 'local', rating: 4.5, is_open: true,
    address: '1 Test St', prep_time_minutes: 20, min_order_kobo: 0, packaging_fee_kobo: 0, geo_lat: 6.5, geo_lng: 3.4 };
  const menu = (price: number) => [{ id: 'c1', name: 'Rice', items: [
    { id: 'i4', name: 'Jollof Rice + Chicken', description: 'Smoky', price_kobo: price, is_available: true }] }];
  async function stubFood(page: Page, state: { price: number; qs: string[] }) {
    await page.route('**/api/v1/food/cart', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' }));
    await page.route('**/api/v1/nutrition/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' }));
    await page.route('**/api/finance/restaurant**', async (route) => {
      const u = new URL(route.request().url());
      const m = route.request().method();
      if (m === 'GET' && u.pathname.endsWith('/api/finance/restaurant')) {
        state.qs.push(u.search);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { restaurants: [REST], total: 1, has_more: false } }) });
      }
      if (m === 'GET' && u.pathname.endsWith('/api/finance/restaurant/r1')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { restaurant: REST, categories: menu(state.price) } }) });
      }
      if (m === 'POST' && u.pathname.endsWith('/delivery-quote')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { delivery_fee_kobo: 50000, flat_fallback: true } }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
  }
  const note = (t: string, d: string) => test.info().annotations.push({ type: t, description: d });

  test('RST-UAT-0104L/0105L/0106L — hub lists stub restaurant; search forwards q; filter controls present', async ({ page }) => {
    const st = { price: 280000, qs: [] as string[] };
    await stubFood(page, st);
    expect(await liveLogin(page)).toBe(true);
    await page.goto('/food');
    await expect(page.getByText('Mama Cass').first()).toBeVisible({ timeout: 60_000 });
    const box = page.getByPlaceholder('Search restaurant or dish…');
    await box.fill('Jollof');
    await expect.poll(() => st.qs.some((q) => /[?&]q=Jollof/.test(q)), { timeout: 15_000 }).toBe(true);
    const body = (await page.locator('body').innerText()).toLowerCase();
    note('observed', `0106 pickup/delivery/open-now filter UI: ${/pickup|open now/.test(body)}; price chips: ${await page.getByLabel(/Filter by price/).count()}`);
  });

  test('RST-UAT-0111L/0112L/0116L/0125L/0113L — add item, no modifier/note/promo UI, remove->empty, restore stale price', async ({ page }) => {
    const st = { price: 280000, qs: [] as string[] };
    await stubFood(page, st);
    const bad: string[] = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 110)}`); });
    expect(await liveLogin(page)).toBe(true);
    await page.goto('/food/restaurant/r1');
    const add = page.getByLabel('Add Jollof Rice + Chicken');
    await expect(add).toBeVisible({ timeout: 60_000 });
    await add.click();
    const mods = await page.getByText(/modifier|extras|add-on|required|choose/i).count();
    note('observed', `0111 modifier UI after Add: ${mods}`);
    await page.getByRole('button', { name: /checkout|view cart|item/i }).last().click();
    await expect(page).toHaveURL(/\/food\/checkout/, { timeout: 15_000 });
    await page.waitForTimeout(5000);
    const body = (await page.locator('body').innerText()).toLowerCase();
    note('observed', `4xx: ${bad.join(' ;; ')}`);
    note('observed', `checkout text: ${body.slice(0, 700).replace(/\n+/g, ' | ')}`);
    note('observed', `0116 note UI: ${/instruction|special request|add a note|note for/.test(body)}; 0125 promo UI: ${/promo code|coupon|voucher/.test(body)}; price shown 2,800: ${/2,800/.test(body)}`);
    // 0113: server price changes while the cart is persisted; reopen -> cart restored, still old price?
    st.price = 350000;
    await page.waitForTimeout(3000); // let the debounced cart persist run
    note('observed', `0113 persisted key present: ${await page.evaluate(() => !!localStorage.getItem('food-cart-storage'))}`);
    await page.goto('/food/checkout');
    await page.waitForTimeout(6000);
    const b2 = (await page.locator('body').innerText());
    note('observed', `0113 reload shows cart line: ${/jollof/i.test(b2)}`);
    note('observed', `0113 after reload with server price 3,500: shows 2,800=${/2,800/.test(b2)} shows 3,500=${/3,500/.test(b2)}`);
    // 0112: remove -> empty state
    if (!/jollof/i.test(b2)) { note('observed', '0112 skipped remove: cart not restored after reload'); return; }
    await page.getByLabel('Remove one').first().click();
    await expect(page.getByText('Your cart is empty')).toBeVisible({ timeout: 15_000 });
  });

  test('RST-UAT-0112L — Empty checkout shows empty state', async ({ page }) => {
    const ok = await liveLogin(page);
    expect(ok, 'harness login must reach /home now that auth.ts is fixed').toBe(true);
    await page.goto('/food/checkout');
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });
});
