import { expect, test, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Food UAT 332 - Cluster B: Restaurant Store Setup & Catalog (RST-UAT-0064..0103).
 * Workbook lines 1161-1664. Results: docs/qa/food-uat-332/cluster-b-store-catalog.md
 *
 * Three kinds of test live here:
 *   LIVE   - drives the real Go API (:8080) as the local dev QA fixture, against a
 *            throwaway store it creates/reuses. Needs the dev login to work
 *            (scripts/dev/ensure-dev-login.sh). Overridable via E2E_FOOD_* env.
 *   UI     - drives the RN web merchant screens (:8083) with the store API route-mocked.
 *   N/A    - "[N/A proof]" tests assert the capability is ABSENT (404 route and/or
 *            source grep) so a future build that adds it flips the test red and
 *            forces the case to be re-triaged.
 */

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080';
const REST = `${API}/api/finance/restaurant`;
const OWNER = {
  email: process.env.E2E_FOOD_EMAIL ?? 'qa-claude-test@spotlight.internal',
  password: process.env.E2E_FOOD_PASSWORD ?? 'LocalDevAdmin123!', // documented in scripts/dev/ensure-dev-login.sh
};
const OTHER = {
  email: process.env.E2E_FOOD_OTHER_EMAIL ?? 'admin@spotlight.internal',
  password: process.env.E2E_FOOD_OTHER_PASSWORD ?? 'LocalDevAdmin123!',
};
const REPO = path.resolve(__dirname, '../../../../..');
const src = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// Token cache on disk: Playwright restarts the worker after every failed test, and each restart re-runs
// beforeAll - re-logging in every time trips the auth rate limiter and cascades into skips.
async function token(request: APIRequestContext, who: { email: string; password: string }) {
  const cache = path.join(os.tmpdir(), `food-uat-b-${who.email}.tok`);
  try {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (c.exp * 1000 > Date.now() + 60_000) return c.t as string;
  } catch { /* no cache */ }
  for (let i = 0; i < 4; i++) {
    const res = await request.post(`${API}/api/auth/login`, { data: who });
    if (res.ok()) {
      const t = ((await res.json()).session?.access_token as string) ?? null;
      if (t) {
        const exp = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp;
        try { fs.writeFileSync(cache, JSON.stringify({ t, exp })); } catch { /* ignore */ }
      }
      return t;
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}
const hdr = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

type Ctx = { t: string; other: string | null; storeId: string; outletId: string; catId: string };
const ctx: Partial<Ctx> = {};

async function ensureStore(request: APIRequestContext, t: string, name: string): Promise<string> {
  const mine = await (await request.get(`${REST}/mine`, { headers: hdr(t) })).json();
  const hit = (mine.data ?? []).find((s: any) => s.name === name);
  if (hit) return hit.id;
  const res = await request.post(REST, {
    headers: hdr(t),
    data: { name, description: 'UAT cluster B fixture', address: '12 Marina, Lagos' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

async function newItem(request: APIRequestContext, price = 250000, name = `UAT-B item ${Date.now()}${Math.floor(Math.random() * 1e3)}`) {
  const res = await request.post(`${REST}/${ctx.storeId}/menu/items`, {
    headers: hdr(ctx.t!),
    data: { category_id: ctx.catId, name, price_kobo: price },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as any;
}
async function getMenu(request: APIRequestContext, storeId = ctx.storeId!) {
  const res = await request.get(`${REST}/${storeId}`, { headers: hdr(ctx.t!) });
  expect(res.status()).toBe(200);
  return (await res.json()) as { restaurant: any; categories: any[] };
}
const findItem = (menu: { categories: any[] }, id: string) =>
  menu.categories.flatMap((c) => c.items ?? []).find((i) => i.id === id);

async function tryOrder(request: APIRequestContext, storeId: string, itemId: string, qty = 1) {
  const res = await request.post(`${REST}/${storeId}/orders`, {
    headers: { ...hdr(ctx.other ?? ctx.t!), 'Idempotency-Key': `uat-b-${Date.now()}-${Math.random()}` },
    data: { items: [{ item_id: itemId, quantity: qty }], delivery_address: '1 Test St, Lagos' },
  });
  return { status: res.status(), body: await res.text() };
}

// ---------------------------------------------------------------------------
// LIVE API
// ---------------------------------------------------------------------------
test.describe('Cluster B - live API (store, menu, availability, authz)', () => {
  test.beforeAll(async ({ request }) => {
    const t = await token(request, OWNER);
    test.skip(!t, 'Blocked: dev login failed - run scripts/dev/ensure-dev-login.sh');
    ctx.t = t!;
    ctx.other = await token(request, OTHER);
    ctx.storeId = await ensureStore(request, t!, 'UAT-B Store');
    ctx.outletId = await ensureStore(request, t!, 'UAT-B Outlet 2');
    // Reset any fixture damage left by a previous run (0065 intentionally writes bad values).
    await request.patch(`${REST}/${ctx.storeId}`, {
      headers: hdr(t!),
      data: { name: 'UAT-B Store', address: '12 Marina, Lagos', description: 'UAT cluster B fixture' },
    });
    const cat = await request.post(`${REST}/${ctx.storeId}/menu/categories`, {
      headers: hdr(t!),
      data: { name: `UAT-B cat ${Date.now()}` },
    });
    ctx.catId = (await cat.json()).id;
  });

  test('RST-UAT-0064 - Complete restaurant profile (name/description/address persist and read back)', async ({ request }) => {
    const res = await request.patch(`${REST}/${ctx.storeId}`, {
      headers: hdr(ctx.t!),
      data: { name: 'UAT-B Store', description: 'Jollof and suya, since 2019', address: '12 Marina, Lagos' },
    });
    expect(res.status()).toBe(200);
    const { restaurant } = await getMenu(request);
    expect(restaurant.name).toBe('UAT-B Store');
    expect(restaurant.description).toBe('Jollof and suya, since 2019');
    expect(restaurant.address).toBe('12 Marina, Lagos');
  });

  test('RST-UAT-0065 - Validate mandatory store details (blank name/address rejected by the API)', async ({ request }) => {
    for (const body of [{ name: '   ' }, { name: '' }, { address: '' }, { address: '   ' }]) {
      const res = await request.patch(`${REST}/${ctx.storeId}`, { headers: hdr(ctx.t!), data: body });
      expect.soft(res.status(), `PATCH ${JSON.stringify(body)} must be rejected`).toBeGreaterThanOrEqual(400);
    }
    // restore (a failing run leaves the fixture blank)
    await request.patch(`${REST}/${ctx.storeId}`, {
      headers: hdr(ctx.t!),
      data: { name: 'UAT-B Store', address: '12 Marina, Lagos' },
    });
  });

  test('RST-UAT-0066 - Moderate storefront images (presign rejects disallowed type; file:// ref refused)', async ({ request }) => {
    const probe = await request.post(`${REST}/${ctx.storeId}/images/presign`, {
      headers: hdr(ctx.t!),
      data: { kind: 'logo', file_name: 'a.png', content_type: 'image/png' },
    });
    test.skip(
      probe.status() === 404,
      'Blocked: :8080 image predates #807 (POST /:id/images/presign unmounted) - rebuild the api container, then re-run',
    );
    const bad = await request.post(`${REST}/${ctx.storeId}/images/presign`, {
      headers: hdr(ctx.t!),
      data: { kind: 'logo', file_name: 'x.exe', content_type: 'application/x-msdownload' },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    const file = await request.patch(`${REST}/${ctx.storeId}`, {
      headers: hdr(ctx.t!),
      data: { logo_url: 'file:///etc/passwd' },
    });
    expect(file.status()).toBeGreaterThanOrEqual(400);
  });

  test('RST-UAT-0067 - Configure payout profile (bank account saved, number masked on read)', async ({ request }) => {
    const res = await request.post(`${REST}/bank-accounts`, {
      headers: hdr(ctx.t!),
      data: { account_number: '0123456789', bank_code: '058', bank_name: 'GTBank', account_name: 'UAT B Owner' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const acct = await res.json();
    expect(acct.account_number_masked).toMatch(/^\*+6789$/);
    expect(JSON.stringify(acct)).not.toContain('0123456789');
    const list = await (await request.get(`${REST}/bank-accounts`, { headers: hdr(ctx.t!) })).json();
    expect(JSON.stringify(list)).not.toContain('0123456789');
    test.info().annotations.push({ type: 'observation', description: `is_verified=${acct.is_verified} (no resolver wired locally; soft-fail by design)` });
    await request.delete(`${REST}/bank-accounts/${acct.id}`, { headers: hdr(ctx.t!) });
    // short numbers rejected
    const short = await request.post(`${REST}/bank-accounts`, {
      headers: hdr(ctx.t!),
      data: { account_number: '123', bank_code: '058', bank_name: 'GTBank', account_name: 'X' },
    });
    expect(short.status()).toBe(400);
  });

  test('RST-UAT-0068 - Protect bank changes by step-up (no challenge => denied or held)', async ({ request }) => {
    const res = await request.post(`${REST}/bank-accounts`, {
      headers: hdr(ctx.t!), // deliberately no PIN / OTP / step-up token
      data: { account_number: '0123456780', bank_code: '058', bank_name: 'GTBank', account_name: 'Attacker Co' },
    });
    const body = await res.text();
    if (res.status() === 201) {
      await request.delete(`${REST}/bank-accounts/${JSON.parse(body).id}`, { headers: hdr(ctx.t!) });
    }
    expect(res.status(), `payout account added with no step-up: ${body}`).toBeGreaterThanOrEqual(400);
  });

  test('RST-UAT-0069 - Set food prep lead time (store default settable by owner; item override works)', async ({ request }) => {
    const before = (await getMenu(request)).restaurant.prep_time_minutes;
    const target = before === 25 ? 30 : 25;
    const res = await request.patch(`${REST}/${ctx.storeId}`, { headers: hdr(ctx.t!), data: { prep_time_minutes: target } });
    expect(res.status()).toBe(200);
    // The item-level override is the part that exists today:
    const it = await newItem(request);
    const ov = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { prep_time_minutes: 40 } });
    expect(ov.status()).toBe(200);
    expect((await ov.json()).prep_minutes).toBe(40);
    // ...and the store-level default must have moved.
    expect((await getMenu(request)).restaurant.prep_time_minutes, 'store default prep not owner-settable').toBe(target);
  });

  test('RST-UAT-0070 - Toggle store accepting orders (close persists; opening is KYB-gated; closed store refuses orders)', async ({ request }) => {
    const item = await newItem(request);
    const close = await request.patch(`${REST}/${ctx.storeId}/availability`, { headers: hdr(ctx.t!), data: { is_open: false } });
    expect(close.status()).toBe(200);
    expect((await getMenu(request)).restaurant.is_open).toBe(false);
    const open = await request.patch(`${REST}/${ctx.storeId}/availability`, { headers: hdr(ctx.t!), data: { is_open: true } });
    expect(open.status()).toBe(403); // FOOD-010 gate: no approved KYB
    const order = await tryOrder(request, ctx.storeId!, item.id);
    expect(order.status).toBeGreaterThanOrEqual(400);
    expect(order.body.toLowerCase()).toContain('closed');
  });

  test('RST-UAT-0071 - Prevent suspended store publishing [N/A proof: no merchant-suspension state]', async () => {
    const model = src('backend/internal/restaurant/model.go');
    const svc = src('backend/internal/restaurant/service.go') + src('backend/internal/restaurant/delivery.go');
    expect(/Restaurant struct[\s\S]{0,1500}?(Suspended|suspended|Status\s)/.test(model)).toBe(false);
    expect(/restaurants[^\n]*suspend|suspend[^\n]*restaurants/i.test(svc)).toBe(false);
    // nearest control: admin force-close (not a block on owner edits)
    expect(src('backend/internal/restaurant/handler_admin_store.go')).toContain('AdminSetAvailability');
  });

  test('RST-UAT-0072 - Create additional branch (outlet) linked to the same owner', async ({ request }) => {
    const mine = await (await request.get(`${REST}/mine`, { headers: hdr(ctx.t!) })).json();
    const ids = (mine.data ?? []).map((s: any) => s.id);
    expect(ids).toContain(ctx.storeId);
    expect(ids).toContain(ctx.outletId);
    // Gap note: outlet = independent restaurants row; no parent_id / branch-manager / per-branch prep in the create contract.
    expect(src('backend/internal/restaurant/model.go')).not.toMatch(/ParentRestaurantID|parent_restaurant_id|BranchManager/);
  });

  test('RST-UAT-0073 - Restrict manager to assigned branch (non-staff user cannot edit another store)', async ({ request }) => {
    test.skip(!ctx.other, 'Blocked: second fixture login unavailable');
    const item = await newItem(request);
    const calls = [
      request.patch(`${REST}/${ctx.storeId}`, { headers: hdr(ctx.other!), data: { name: 'hijack' } }),
      request.patch(`${REST}/${ctx.storeId}/menu/items/${item.id}`, { headers: hdr(ctx.other!), data: { is_available: false } }),
      request.patch(`${REST}/${ctx.storeId}/menu/items/availability/bulk`, { headers: hdr(ctx.other!), data: { ids: [item.id], is_available: false } }),
      request.post(`${REST}/${ctx.storeId}/menu/items`, { headers: hdr(ctx.other!), data: { category_id: ctx.catId, name: 'x', price_kobo: 100 } }),
    ];
    for (const r of await Promise.all(calls)) expect([401, 403, 404]).toContain(r.status());
    const after = findItem(await getMenu(request), item.id);
    expect(after.is_available).toBe(true);
    expect((await getMenu(request)).restaurant.name).toBe('UAT-B Store');
  });

  test('RST-UAT-0074 - Branch-specific menu (each outlet serves only its own items)', async ({ request }) => {
    const item = await newItem(request, 123400);
    const outlet = await getMenu(request, ctx.outletId!);
    test.info().annotations.push({ type: 'observation', description: `empty outlet menu categories = ${JSON.stringify(outlet.categories)} (null, not [])` });
    expect((outlet.categories ?? []).flatMap((c) => c.items ?? []).map((i) => i.id)).not.toContain(item.id);
    expect(findItem(await getMenu(request), item.id).price_kobo).toBe(123400);
    // per-branch hours: see 0099 [N/A proof].
  });

  test('RST-UAT-0075 - Route order to correct branch [Blocked: needs funded customer + open KYB-approved outlets]', async () => {
    test.skip(true, 'Blocked: order placement needs an open (KYB-approved) outlet and funded wallet - covered by Cluster D. Static: route is /:id/orders so the branch is explicit; dispatch reads restaurants.geo of that row.');
  });

  test('RST-UAT-0076 - Handle branch disabled (closed outlet refuses orders, sibling unaffected)', async ({ request }) => {
    const itemOutlet = await newItem(request); // item lives on store 1 only; use closed-ness of outlet
    const close = await request.patch(`${REST}/${ctx.outletId}/availability`, { headers: hdr(ctx.t!), data: { is_open: false } });
    expect(close.status()).toBe(200);
    const o = await tryOrder(request, ctx.outletId!, itemOutlet.id);
    expect(o.status).toBeGreaterThanOrEqual(400);
    expect(o.body.toLowerCase()).toContain('closed');
    // parent record unaffected by sibling toggle
    expect((await getMenu(request)).restaurant.name).toBe('UAT-B Store');
  });

  test('RST-UAT-0077 - Create category and food item (item appears under its category)', async ({ request }) => {
    const it = await newItem(request, 450000, `UAT-B Jollof ${Date.now()}`);
    expect(it.id).toBeTruthy();
    const menu = await getMenu(request);
    const cat = menu.categories.find((c) => c.id === ctx.catId);
    expect(cat.items.map((i: any) => i.id)).toContain(it.id);
    expect(new Set(menu.categories.flatMap((c) => c.items ?? []).map((i) => i.id)).size)
      .toBe(menu.categories.flatMap((c) => c.items ?? []).length); // unique identity
    // description + prep on CREATE: the create contract silently drops prep_time_minutes
    const withPrep = await request.post(`${REST}/${ctx.storeId}/menu/items`, {
      headers: hdr(ctx.t!),
      data: { category_id: ctx.catId, name: `UAT-B prep ${Date.now()}`, price_kobo: 1000, prep_time_minutes: 20 },
    });
    test.info().annotations.push({ type: 'observation', description: `create-with-prep -> ${await withPrep.text()}` });
  });

  test('RST-UAT-0078 - Save draft without publishing [N/A proof: no item draft/publish state]', async ({ request }) => {
    const it = await newItem(request);
    const res = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, {
      headers: hdr(ctx.t!),
      data: { is_published: false, status: 'draft' },
    });
    const body = await res.json();
    expect(body.is_published).toBeUndefined();
    expect(body.status).toBeUndefined();
    expect(src('backend/internal/restaurant/model.go').match(/type MenuItem struct[\s\S]*?\n}/)![0]).not.toMatch(/Published|Draft|Status/);
    // new items are immediately customer-visible + purchasable
    expect(findItem(await getMenu(request), it.id).is_available).toBe(true);
  });

  test('RST-UAT-0079 - Publish/unpublish item (mapped to availability flag; read reflects it)', async ({ request }) => {
    const it = await newItem(request);
    const off = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { is_available: false } });
    expect(off.status()).toBe(200);
    expect(findItem(await getMenu(request), it.id).is_available).toBe(false);
    const on = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { is_available: true } });
    expect(on.status()).toBe(200);
    expect(findItem(await getMenu(request), it.id).is_available).toBe(true);
  });

  test('RST-UAT-0080 - Update item price (new price on read; order lines snapshot price)', async ({ request }) => {
    const it = await newItem(request, 100000);
    const upd = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { price_kobo: 150000 } });
    expect(upd.status()).toBe(200);
    expect(findItem(await getMenu(request), it.id).price_kobo).toBe(150000);
    // snapshot: order_items carry their own price_kobo + subtotal (model.go OrderItem)
    expect(src('backend/internal/restaurant/model.go')).toMatch(/SubtotalKobo/);
  });

  test('RST-UAT-0081 - Reject invalid item price (negative / fractional / string / over ceiling => 400)', async ({ request }) => {
    const post = (price: unknown) =>
      request.post(`${REST}/${ctx.storeId}/menu/items`, { headers: hdr(ctx.t!), data: { category_id: ctx.catId, name: 'bad', price_kobo: price } });
    for (const p of [-100, 12.5, 'abc', null]) {
      const r = await post(p);
      expect(r.status(), `price ${JSON.stringify(p)}`).toBe(400);
    }
    for (const p of [100_000_001, 1_000_000_000_000]) {
      const r = await post(p);
      // blocked is mandatory; 400 is the validation contract (403 reads as "forbidden" to clients)
      expect(r.status()).toBeGreaterThanOrEqual(400);
      expect.soft(r.status(), `over-ceiling price ${p} status`).toBe(400);
    }
    const it = await newItem(request);
    const upd = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { price_kobo: -5 } });
    expect.soft(upd.status(), 'PATCH negative price status').toBe(400);
    expect(findItem(await getMenu(request), it.id).price_kobo).toBe(250000);
  });

  test('RST-UAT-0082 - Reorder categories and featured meals [N/A proof: no sort_order / featured on menu]', async ({ request }) => {
    const it = await newItem(request);
    const res = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, {
      headers: hdr(ctx.t!),
      data: { sort_order: 1, is_featured: true },
    });
    const body = await res.json();
    expect(body.sort_order).toBeUndefined();
    expect(body.is_featured).toBeUndefined();
    expect(src('backend/internal/restaurant/delivery.go')).not.toMatch(/sort_order|SortOrder/);
  });

  test('RST-UAT-0083 - Replace and delete item photo [N/A proof: no item-image route]', async ({ request }) => {
    const upd = src('backend/internal/restaurant/delivery.go').match(/type UpdateItemRequest struct[\s\S]*?\n}/)![0];
    expect(upd).not.toMatch(/image/i);
    const routes = src('backend/internal/app/finance_routes.go');
    expect(routes).not.toMatch(/menu\/items\/:itemId\/(image|photo)/);
    const it = await newItem(request);
    const probe = await request.post(`${REST}/${ctx.storeId}/menu/items/${it.id}/images/presign`, { headers: hdr(ctx.t!), data: {} });
    expect(probe.status()).toBe(404);
  });

  test('RST-UAT-0084 - Bulk update menu items (bulk availability: bad id must not half-apply) [CSV import N/A]', async ({ request }) => {
    expect(src('backend/internal/app/finance_routes.go')).not.toMatch(/menu\/(import|csv)/i);
    const a = await newItem(request);
    const b = await newItem(request);
    const res = await request.patch(`${REST}/${ctx.storeId}/menu/items/availability/bulk`, {
      headers: hdr(ctx.t!),
      data: { ids: [a.id, 'not-a-uuid', b.id], is_available: false },
    });
    const menu = await getMenu(request);
    const states = [findItem(menu, a.id).is_available, findItem(menu, b.id).is_available];
    if (res.status() >= 400) {
      expect(states).toEqual([true, true]); // rejected => untouched
    } else {
      expect(res.status()).toBe(200); // accepted => the valid rows applied, malformed row reported/ignored
      expect(states).toEqual([false, false]);
    }
  });

  test('RST-UAT-0085 - Prevent concurrent overwrite of menu (stale write is rejected with a conflict)', async ({ request }) => {
    const it = await newItem(request, 100000);
    const staleHdr = { ...hdr(ctx.t!), 'If-Match': '"stale-version"' };
    const a = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { price_kobo: 110000 } });
    expect(a.status()).toBe(200);
    const b = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: staleHdr, data: { price_kobo: 120000 } });
    expect([409, 412, 428], `last-write-wins: stale write returned ${b.status()}`).toContain(b.status());
  });

  // ---- Modifiers (FOOD-011) -------------------------------------------------
  const modifierNA = (id: string, title: string) =>
    test(`${id} - ${title} [N/A proof: FOOD-011 modifier groups unreachable]`, async ({ request }) => {
      const it = await newItem(request);
      for (const suffix of ['modifier-groups', 'modifiers', 'options', 'option-groups']) {
        for (const method of ['GET', 'POST'] as const) {
          const r = await request.fetch(`${REST}/${ctx.storeId}/menu/items/${it.id}/${suffix}`, { method, headers: hdr(ctx.t!), data: method === 'POST' ? {} : undefined });
          expect(r.status(), `${method} ${suffix}`).toBe(404);
        }
      }
      const routes = src('backend/internal/app/finance_routes.go');
      expect(routes).not.toMatch(/CreateModifierGroup|AddModifier|ListItemModifierGroups/);
    });
  modifierNA('RST-UAT-0086', 'Create required option group');
  modifierNA('RST-UAT-0087', 'Enforce modifier min and max');
  modifierNA('RST-UAT-0088', 'Price optional extras accurately');
  modifierNA('RST-UAT-0092', 'Do not silently substitute modifier after order');

  test('RST-UAT-0089 - Persist kitchen preparation note [Blocked: needs funded customer + open outlet]', async () => {
    test.skip(true, 'Blocked: instruction sanitiser (menucart.go sanitizeInstructions, wired service.go:949) is only reachable through PlaceOrder on an open KYB-approved store - Cluster D. Go unit tests: menucart_test.go.');
  });

  test('RST-UAT-0090 - Display allergens and dietary flags (stored+returned by API; customer UI renders them)', async ({ request }) => {
    const res = await request.post(`${REST}/${ctx.storeId}/menu/items`, {
      headers: hdr(ctx.t!),
      data: { category_id: ctx.catId, name: `UAT-B nutty ${Date.now()}`, price_kobo: 5000, dietary_tags: ['Contains Nuts', 'vegetarian'] },
    });
    expect(res.status()).toBe(201);
    const it = await res.json();
    const read = findItem(await getMenu(request), it.id);
    expect(read.dietary_tags).toEqual(['contains_nuts', 'vegetarian']);
    // Customer-side: the food feature must map + render dietary_tags (otherwise allergen data is invisible to diners).
    const hits = ['mobile-app/reactnative/src/features/food', 'mobile-app/reactnative/app/food']
      .flatMap((d) => grepDir(path.join(REPO, d), /dietary_?tags|dietaryTags/i));
    expect(hits, 'no customer-facing food code reads dietary_tags').not.toHaveLength(0);
  });

  test('RST-UAT-0091 - Reject unsafe input as instructions (stored text is inert in merchant UI) [see UI block]', async ({ request }) => {
    const r = await request.patch(`${REST}/${ctx.storeId}`, { headers: hdr(ctx.t!), data: { description: '<script>window.__x=1</script>' } });
    expect(r.status()).toBe(200);
    expect((r.headers()['content-type'] ?? '')).toContain('application/json'); // never text/html
    await request.patch(`${REST}/${ctx.storeId}`, { headers: hdr(ctx.t!), data: { description: 'UAT cluster B fixture' } });
  });

  test('RST-UAT-0093 - Mark item sold out (read shows unavailable; order for it is refused)', async ({ request }) => {
    const it = await newItem(request);
    await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { is_available: false } });
    expect(findItem(await getMenu(request), it.id).is_available).toBe(false);
    const o = await tryOrder(request, ctx.storeId!, it.id);
    expect(o.status).toBeGreaterThanOrEqual(400);
  });

  test('RST-UAT-0094 - Restore inventory (timed restock + manual restore; past restock refused)', async ({ request }) => {
    const it = await newItem(request);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const off = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { is_available: false, unavailable_until: future } });
    expect(off.status()).toBe(200);
    expect(findItem(await getMenu(request), it.id).is_available).toBe(false);
    const on = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { is_available: true } });
    expect(on.status()).toBe(200);
    expect(findItem(await getMenu(request), it.id).is_available).toBe(true);
    const past = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, {
      headers: hdr(ctx.t!),
      data: { is_available: false, unavailable_until: '2020-01-01T00:00:00Z' },
    });
    expect(past.status(), 'past restock time must be refused').toBeGreaterThanOrEqual(400);
  });

  test('RST-UAT-0095 - Prevent oversell at checkout [N/A proof: no stock counts, availability is boolean + restock time]', async ({ request }) => {
    const it = await newItem(request);
    const res = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { stock_quantity: 1 } });
    expect((await res.json()).stock_quantity).toBeUndefined();
    expect(src('backend/internal/restaurant/availability.go')).not.toMatch(/stock_quantity|stock_count|quantity_available/);
  });

  test('RST-UAT-0096 - Release reserved stock on failure [N/A proof: no stock reservation]', async () => {
    const files = ['service.go', 'availability.go', 'menucart.go'].map((f) => src(`backend/internal/restaurant/${f}`)).join('\n');
    expect(files).not.toMatch(/reserveStock|stock_reservation|ReleaseStock/i);
  });

  test('RST-UAT-0097 - Apply max per-item quantity (seller-configured cap enforced server-side)', async ({ request }) => {
    const it = await newItem(request);
    // Seller-configurable limit: no field on the item contract.
    const set = await request.patch(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!), data: { max_per_order: 2 } });
    expect((await set.json()).max_per_order, 'no seller-configured per-item max exists').toBe(2);
  });

  test('RST-UAT-0098 - Hide deleted item from new cart (deleted item gone from menu; order refused, no substitution)', async ({ request }) => {
    const it = await newItem(request);
    const del = await request.delete(`${REST}/${ctx.storeId}/menu/items/${it.id}`, { headers: hdr(ctx.t!) });
    expect([200, 204]).toContain(del.status());
    expect(findItem(await getMenu(request), it.id)).toBeUndefined();
    const o = await tryOrder(request, ctx.storeId!, it.id);
    expect(o.status).toBeGreaterThanOrEqual(400);
  });

  // ---- Hours & closures: service + read-side exist, owner write routes do not ----
  const hoursNA = (id: string, title: string, probes: Array<[string, 'GET' | 'PUT' | 'POST' | 'PATCH']>) =>
    test(`${id} - ${title} [N/A proof: no owner route to set hours/closures]`, async ({ request }) => {
      for (const [suffix, method] of probes) {
        const r = await request.fetch(`${REST}/${ctx.storeId}/${suffix}`, { method, headers: hdr(ctx.t!), data: method === 'GET' ? undefined : {} });
        expect(r.status(), `${method} /${suffix}`).toBe(404);
      }
      const routes = src('backend/internal/app/finance_routes.go');
      expect(routes).not.toMatch(/SetBusinessHours|SetHoliday|DeleteHoliday|GetBusinessHours/);
    });
  hoursNA('RST-UAT-0099', 'Configure recurring hours', [['hours', 'GET'], ['hours', 'PUT'], ['business-hours', 'PUT']]);
  hoursNA('RST-UAT-0100', 'Respect overnight opening', [['hours', 'PUT'], ['business-hours', 'PUT']]);
  hoursNA('RST-UAT-0102', 'Close on holiday exception', [['holidays', 'POST'], ['holiday', 'PUT'], ['closures', 'POST']]);

  test('RST-UAT-0101 - Pause orders temporarily (no timed pause; manual close blocks new orders)', async ({ request }) => {
    for (const [suffix, method] of [['pause', 'POST'], ['pause', 'PATCH']] as const) {
      const r = await request.fetch(`${REST}/${ctx.storeId}/${suffix}`, { method, headers: hdr(ctx.t!), data: { minutes: 30 } });
      expect.soft(r.status(), `timed pause ${method} /${suffix}`).not.toBe(404);
    }
    const item = await newItem(request);
    const o = await tryOrder(request, ctx.storeId!, item.id);
    expect(o.status).toBeGreaterThanOrEqual(400); // manual close path works today
  });

  test('RST-UAT-0103 - Prevent last-second closed-store payment (PlaceOrder re-checks is_open at submit)', async ({ request }) => {
    const svc = src('backend/internal/restaurant/service.go');
    expect(svc).toMatch(/!isOpen && scheduledFor == nil/);
    expect(svc).toMatch(/ErrRestaurantClosed/);
    const item = await newItem(request);
    await request.patch(`${REST}/${ctx.storeId}/availability`, { headers: hdr(ctx.t!), data: { is_open: false } });
    const o = await tryOrder(request, ctx.storeId!, item.id);
    expect(o.status).toBeGreaterThanOrEqual(400);
    expect(o.body.toLowerCase()).toContain('closed');
  });
});

function grepDir(dir: string, re: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) grepDir(p, re, out);
    else if (/\.(ts|tsx)$/.test(e.name) && re.test(fs.readFileSync(p, 'utf8'))) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// UI (RN web, store API route-mocked)
// ---------------------------------------------------------------------------
async function mockStoreApi(page: Page, opts: { description?: string; withCategory?: boolean; empty?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  const store = {
    id: 'r-uat', owner_id: 'usr_self', name: 'My Kitchen', description: opts.description ?? 'Best jollof',
    address: '1 Demo Street, Lagos', is_open: false, created_at: '2026-06-14T00:00:00.000Z', packaging_fee_kobo: 20000,
  };
  await page.route('**/api/finance/restaurant/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let body: any = null;
    try { body = req.postDataJSON(); } catch { /* none */ }
    calls.push({ method: req.method(), url: url.pathname, body });
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const p = url.pathname.replace('/api/finance/restaurant', '');
    if (req.method() === 'GET' && p === '/mine') return json({ data: opts.empty ? [] : [store] });
    if (req.method() === 'GET' && p === '/r-uat') {
      return json({
        restaurant: store,
        categories: opts.withCategory ? [{ id: 'c1', restaurant_id: 'r-uat', name: 'Mains', items: [{ id: 'i1', category_id: 'c1', restaurant_id: 'r-uat', name: 'Jollof', price_kobo: 250000, is_available: true }] }] : [],
      });
    }
    if (req.method() === 'GET' && p === '/payout-readiness') return json({ data: [{ restaurant_id: 'r-uat', name: 'My Kitchen', kyb_status: 'approved', payable: true, unpaid_kobo: 0 }] });
    if (req.method() === 'GET' && p.endsWith('/kyb')) return json({ data: { status: 'approved' } });
    if (req.method() === 'PATCH' && p === '/r-uat/availability') return json({ ...store, is_open: !!body?.is_open });
    if (req.method() === 'PATCH' && p === '/r-uat') return json({ ...store, ...body });
    if (req.method() === 'POST' && p === '') return json({ ...store, ...body, id: 'r-new' }, 201);
    return json({ data: [] });
  });
  return calls;
}

test.describe('Cluster B - merchant UI (:8083)', () => {
  // Serial: if loginAs() cannot reach /home (known harness issue on the shared :8083 Metro - see
  // cluster A/C notes) the first test fails and the rest are skipped rather than burning 45s each.
  test.describe.configure({ mode: 'serial', timeout: 25_000 });
  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.E2E_FOOD_UI,
      'Blocked (harness): loginAs() never reaches /home on the shared :8083 Metro (same as clusters A/C). Set E2E_FOOD_UI=1 once the harness serves a seedable bundle.',
    );
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['restaurant']);
    await loginAs(page);
  });

  test('RST-UAT-0064 - Complete restaurant profile (UI exposes name, description, address, logo/banner)', async ({ page }) => {
    await mockStoreApi(page);
    await page.goto('/food/restaurant/manage');
    await expect(page.getByText('Store details')).toBeVisible();
    await expect(page.getByPlaceholder('Blue Yam Kitchen')).toHaveValue('My Kitchen');
    await expect(page.getByPlaceholder("What you're known for")).toHaveValue('Best jollof');
    await expect(page.getByPlaceholder('12 Marina, Lagos')).toHaveValue('1 Demo Street, Lagos');
  });

  test('RST-UAT-0065 - Validate mandatory store details (UI create blocks blank name/address, no POST)', async ({ page }) => {
    const calls = await mockStoreApi(page, { empty: true });
    await page.goto('/food/restaurant/manage');
    await expect(page.getByText('Set up your restaurant to start receiving orders.')).toBeVisible();
    const submit = page.getByRole('button', { name: /create|save|continue/i }).first();
    if (await submit.count()) await submit.click({ trial: false }).catch(() => undefined);
    await page.waitForTimeout(400);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/restaurant'))).toHaveLength(0);
  });

  test('RST-UAT-0070 - Toggle store accepting orders (switch sends PATCH /availability {is_open:true})', async ({ page }) => {
    const calls = await mockStoreApi(page);
    await page.goto('/food/restaurant/manage');
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
    await page.getByRole('switch').first().click();
    await expect.poll(() => calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/availability') && c.body?.is_open === true)).toBe(true);
  });

  test('RST-UAT-0072 - Create additional branch (UI offers Add outlet)', async ({ page }) => {
    await mockStoreApi(page);
    await page.goto('/food/restaurant/manage');
    await expect(page.getByLabel('Add another outlet').or(page.getByText('Add outlet'))).toBeVisible();
  });

  test('RST-UAT-0081 - Reject invalid item price (UI shows validation, sends no POST)', async ({ page }) => {
    const calls = await mockStoreApi(page, { withCategory: true });
    await page.goto('/food/restaurant/manage');
    await expect(page.getByText('Jollof')).toBeVisible();
    const name = page.getByPlaceholder('Item name').first();
    const price = page.getByLabel('Item price in naira').first();
    for (const bad of ['-5', '12.345', 'abc', '99999999']) {
      await name.fill('Bad price');
      await price.fill(bad);
      await page.getByLabel('Add item').first().click();
      await expect(page.locator('text=/price|naira|₦|amount|valid/i').last()).toBeVisible();
    }
    expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/menu/items'))).toHaveLength(0);
  });

  test('RST-UAT-0091 - Reject unsafe input as instructions (script/HTML in description is inert text)', async ({ page }) => {
    await mockStoreApi(page, { description: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>' });
    let dialog = false;
    page.on('dialog', () => { dialog = true; });
    await page.goto('/food/restaurant/manage');
    await expect(page.getByText('Store details')).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(dialog).toBe(false);
  });

  test('RST-UAT-0093 - Mark item sold out (merchant list shows In stock switch per item)', async ({ page }) => {
    await mockStoreApi(page, { withCategory: true });
    await page.goto('/food/restaurant/manage');
    await expect(page.getByLabel('Jollof in stock')).toBeVisible();
  });
});
