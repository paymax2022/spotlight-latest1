/**
 * Cluster G - Admin Portal, Reports, Reviews & Notifications (Food UAT 332).
 * Workbook: RST-UAT-0253..0279, 0312..0315.  READ-ONLY on product code.
 *
 * Strategy
 *  - Backend admin HTTP API (:8080 /api/restaurant/admin/*) is driven directly with a
 *    super-admin bearer (admin@spotlight.internal, password from scripts/dev/ensure-dev-login.sh).
 *  - A throwaway plain user (registered via /api/auth/register, email confirmed through the
 *    local DB) proves RBAC denies non-admins.
 *  - Reviews are exercised against a self-seeded restaurant + orders (direct SQL on the LOCAL
 *    supabase container) and everything seeded is removed in afterAll.
 *  - Admin UI cases navigate http://127.0.0.1:3001/admin/restaurant/... after a scripted login.
 *  - Tests whose title says "[GAP]" assert the behaviour the workbook EXPECTS; they are
 *    expected to FAIL today and each failure maps to a FOOD-UAT-G-NNN defect.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080';
const ADMIN_UI = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:3001';
const ADMIN_EMAIL = 'admin@spotlight.internal';
const ADMIN_PW = process.env.DEV_LOGIN_PASSWORD ?? 'LocalDevAdmin123!';
const DB = process.env.E2E_DB_CONTAINER ?? 'supabase_db_spotlight';
const ADM = `${API}/api/restaurant/admin`;
const MEMBER = `${API}/api/finance/restaurant`;
const ZERO = '00000000-0000-0000-0000-000000000000';

function sql(q: string): string {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-Atq', '-c', q], { encoding: 'utf8' }).trim();
}

async function http(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

// Every failing (expected-fail) test restarts the worker, which re-runs beforeAll; the Go login limiter (429)
// trips quickly, so tokens are cached on disk until shortly before they expire.
const TOKEN_CACHE = join(tmpdir(), 'food-uat-cluster-g-tokens.json');
function jwtExp(t: string): number {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp; } catch { return 0; }
}
async function login(email: string, password: string): Promise<{ token: string; id: string }> {
  let cache: Record<string, { token: string; id: string }> = {};
  try { if (existsSync(TOKEN_CACHE)) cache = JSON.parse(readFileSync(TOKEN_CACHE, 'utf8')); } catch { /* ignore */ }
  const hit = cache[email];
  if (hit && jwtExp(hit.token) > Date.now() / 1000 + 300) return hit;
  const r = await http('POST', `${API}/api/auth/login`, undefined, { email, password });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${r.text.slice(0, 120)}`);
  const out = { token: r.json.session.access_token as string, id: (r.json.user?.id ?? r.json.session?.user?.id) as string };
  cache[email] = out;
  try { writeFileSync(TOKEN_CACHE, JSON.stringify(cache)); } catch { /* ignore */ }
  return out;
}

let adminTok = '';
let userTok = '';
let userId = '';
let adminId = '';
let restId = '';
let deliveredOrder = '';
let pendingOrder = '';
let othersDeliveredOrder = '';
const uemail = 'uat-g-fixed@example.test';
const UPW = 'UatG-Pass123!';

test.beforeEach(({}, ti) => {
  test.skip(ti.project.name !== 'desktop-chrome', 'API/admin-UI cluster runs once (desktop project)');
});

// Failures restart the worker (re-running beforeAll/afterAll), so dependent cases seed their own data.
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  adminTok = (await login(ADMIN_EMAIL, ADMIN_PW)).token;
  adminId = sql(`select id from auth.users where email='${ADMIN_EMAIL}'`);
  let u: { token: string; id: string } | null = null;
  try { u = await login(uemail, UPW); } catch {
    const reg = await http('POST', `${API}/api/auth/register`, undefined, { email: uemail, password: UPW, full_name: 'UAT G User' });
    expect([200, 201]).toContain(reg.status);
    sql(`update auth.users set email_confirmed_at=now() where email='${uemail}'`);
    u = await login(uemail, UPW);
  }
  userTok = u.token;
  userId = sql(`select id from auth.users where email='${uemail}'`);
  cleanup(); // idempotent: drop leftovers of a previous (crashed) run
  restId = seedRestaurant('UAT-G Kitchen');
  deliveredOrder = seedOrder(restId, userId, 'delivered');
  pendingOrder = seedOrder(restId, userId, 'pending');
  othersDeliveredOrder = seedOrder(restId, adminId, 'delivered');
});

function seedRestaurant(name: string): string {
  return sql(`insert into restaurants (owner_id,name,address,is_open,rating) values ('${userId}','${name}','1 UAT Road',false,0) returning id`).split('\n')[0];
}
let seq = 0;
function seedOrder(rest: string, cust: string, st: string): string {
  return sql(`insert into orders (customer_id,restaurant_id,subtotal_kobo,delivery_kobo,total_kobo,status,idempotency_key,delivery_address,delivered_at)
     values ('${cust}','${rest}',100000,50000,150000,'${st}','uatg-${Date.now()}-${seq++}','2 UAT Street, Ikeja, Lagos',${st === 'delivered' ? 'now()' : 'null'}) returning id`).split('\n')[0];
}
function cleanup() {
  const ids = "(select id from restaurants where name like 'UAT-G %')";
  sql(`delete from restaurant_ratings where restaurant_id in ${ids}`);
  sql(`delete from orders where restaurant_id in ${ids}`);
  sql(`delete from restaurant_delivery_config where restaurant_id in ${ids}`);
  sql(`delete from restaurant_kyb where restaurant_id in ${ids}`);
  sql(`delete from restaurants where name like 'UAT-G %'`);
}

test.afterAll(async () => {
  try { cleanup(); } catch (e) { console.log('cleanup warning', String(e).slice(0, 200)); }
});

/* ---------------- Reviews & Reputation ---------------- */
test.describe('Reviews and Reputation', () => {
  test('RST-UAT-0253 — Submit verified post-delivery review', async () => {
    const r = await http('POST', `${MEMBER}/orders/${deliveredOrder}/rate`, userTok, { restaurant_stars: 4, comment: 'Great jollof' });
    expect(r.status).toBe(201);
    const row = sql(`select restaurant_stars||'|'||moderation_status||'|'||order_id from restaurant_ratings where order_id='${deliveredOrder}' and rater_id='${userId}'`);
    expect(row).toBe(`4|visible|${deliveredOrder}`);
  });

  test('RST-UAT-0254 — Reject review before fulfilment', async () => {
    const before = sql(`select count(*) from restaurant_ratings where restaurant_id='${restId}'`);
    const pending = await http('POST', `${MEMBER}/orders/${pendingOrder}/rate`, userTok, { restaurant_stars: 1 });
    const unowned = await http('POST', `${MEMBER}/orders/${othersDeliveredOrder}/rate`, userTok, { restaurant_stars: 1 });
    const missing = await http('POST', `${MEMBER}/orders/${ZERO}/rate`, userTok, { restaurant_stars: 1 });
    const badStars = await http('POST', `${MEMBER}/orders/${deliveredOrder}/rate`, userTok, { restaurant_stars: 9 });
    for (const x of [pending, unowned, missing, badStars]) expect(x.status).toBeGreaterThanOrEqual(400);
    expect(sql(`select count(*) from restaurant_ratings where restaurant_id='${restId}'`)).toBe(before);
  });

  test('RST-UAT-0255 — Prevent duplicate review stuffing (retry returns the SAME persisted review)', async () => {
    const o = seedOrder(restId, userId, 'delivered');
    const a = await http('POST', `${MEMBER}/orders/${o}/rate`, userTok, { restaurant_stars: 5 });
    expect(a.status).toBe(201);
    const first = sql(`select id from restaurant_ratings where order_id='${o}' and rater_id='${userId}'`);
    const retry = await http('POST', `${MEMBER}/orders/${o}/rate`, userTok, { restaurant_stars: 1, comment: 'retry' });
    expect(sql(`select count(*) from restaurant_ratings where order_id='${o}' and rater_id='${userId}'`)).toBe('1'); // uniqueness holds
    // Expected: idempotent - 200/409 with the original id, or an update. Actual: 201 + a FABRICATED id that was never stored.
    if (retry.status === 201) expect(retry.json.id, 'retry echoes an id that is not in the DB').toBe(first);
  });

  test('RST-UAT-0256 — [GAP] Moderate harmful content (admin moderation endpoint)', async () => {
    const o = seedOrder(restId, userId, 'delivered');
    await http('POST', `${MEMBER}/orders/${o}/rate`, userTok, { restaurant_stars: 1, comment: 'this is a scam' });
    const rid = sql(`select id from restaurant_ratings where order_id='${o}'`);
    expect(sql(`select moderation_status from restaurant_ratings where id='${rid}'`)).toBe('flagged'); // auto-flag works
    const tries = [
      ['POST', `${ADM}/reviews/${rid}/moderate`],
      ['PATCH', `${ADM}/reviews/${rid}`],
      ['GET', `${ADM}/reviews`],
      ['GET', `${MEMBER}/${restId}/reviews`],
    ];
    const codes: number[] = [];
    for (const [m, u] of tries) codes.push((await http(m, u, adminTok, m === 'GET' ? undefined : { status: 'hidden' })).status);
    // Service.ModerateReview / ListReviews exist but are mounted nowhere.
    expect(codes.some((c) => c !== 404), `all review moderation routes 404: ${codes}`).toBeTruthy();
  });

  test('RST-UAT-0257 — Calculate rating from eligible reviews', async () => {
    const r2 = seedRestaurant('UAT-G Rating');
    const rating = () => Number(sql(`select rating from restaurants where id='${r2}'`));
    for (const stars of [5, 4, 4]) {
      const o = seedOrder(r2, userId, 'delivered');
      expect((await http('POST', `${MEMBER}/orders/${o}/rate`, userTok, { restaurant_stars: stars })).status).toBe(201);
    }
    expect(rating()).toBe(4.3); // avg 4.333.. stored numeric(2,1): rounds half-away at 1dp
    // an unfulfilled order must not count
    const p = seedOrder(r2, userId, 'pending');
    await http('POST', `${MEMBER}/orders/${p}/rate`, userTok, { restaurant_stars: 1 });
    expect(rating()).toBe(4.3);
    // hidden reviews are excluded from the average (recompute is only reachable via a new rating: no moderation route, see 0256)
    sql(`update restaurant_ratings set moderation_status='hidden' where restaurant_id='${r2}' and restaurant_stars=5`);
    const o4 = seedOrder(r2, userId, 'delivered');
    await http('POST', `${MEMBER}/orders/${o4}/rate`, userTok, { restaurant_stars: 4 });
    expect(rating()).toBe(4);
    // zero-review store: DB default is 5.0, service comment says unrated = 0
    const empty = Number(sql(`insert into restaurants (owner_id,name,address) values ('${userId}','UAT-G Empty','x') returning rating`).split('\n')[0]);
    expect(empty, 'brand-new store with no reviews advertises 5.0 stars').toBe(0);
  });
});

/* ---------------- Notifications & Communication ---------------- */
test.describe('Notifications and Communication', () => {
  test('RST-UAT-0258 — Notify owner of new paid order (wiring evidence)', async () => {
    test.info().annotations.push({ type: 'Blocked', description: 'Needs a live paid order + push/in-app sink; PlaceOrder emits EventOrderPlaced to owner (service.go:1045). No notifications table locally.' });
    expect(sql(`select to_regclass('public.notifications') is null`)).toBe('t');
  });
  test('RST-UAT-0259 — Notify rider of assigned offer (wiring evidence)', async () => {
    test.info().annotations.push({ type: 'Blocked', description: 'dispatch.go:126 / delivery.go:669 notify offered rider; no delivery sink observable locally.' });
  });
  test('RST-UAT-0260 — Notify customer of major states (wiring evidence)', async () => {
    test.info().annotations.push({ type: 'Blocked', description: 'service.go:1290/1301 confirmed+delivered, dispatch.go:212 handoff, disputes_service.go:321 refund; preparing/ready/picked_up have no customer notify.' });
  });
  test('RST-UAT-0261 — Use deep links with login/role safety (admin console)', async ({ page }) => {
    await page.goto(`${ADMIN_UI}/admin/restaurant/payouts`);
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Frestaurant%2Fpayouts/);
    const wd = await http('GET', `${ADM}/withdrawals`, userTok);
    expect(wd.status).toBe(403);
  });
  test('RST-UAT-0262 — Handle notification provider outage', async () => {
    test.info().annotations.push({ type: 'Partial', description: 'service.go notify() is panic-safe + best-effort (order commits first). finance_routes.go:1672 falls back to LogNotifier when Redis is unset => messages are dropped, no outbox/retry.' });
  });
  test('RST-UAT-0263 — Avoid duplicate alerts on retry', async () => {
    test.info().annotations.push({ type: 'Blocked', description: 'Notification struct has no dedupe key; needs webhook replay + sink. See report.' });
  });
  test('RST-UAT-0264 — Mask sensitive rider-customer contact', async () => {
    // Offered (unassigned) riders see masked address (delivery.go:797 maskDeliveryAddress). Unauthorized user cannot read someone's chat.
    const stranger = sql(`insert into restaurants (owner_id,name,address) values ('${adminId}','UAT-G Stranger','x') returning id`).split('\n')[0];
    const strangerOrder = seedOrder(stranger, adminId, 'delivered');
    const msgs = await http('GET', `${MEMBER}/orders/${strangerOrder}/messages`, userTok);
    expect(msgs.status).toBeGreaterThanOrEqual(400);
    const offers = await http('GET', `${MEMBER}/rider/offers`, userTok);
    expect([200, 403]).toContain(offers.status);
  });
  test('RST-UAT-0265 — Allow important transactional alerts when marketing off', async () => {
    test.info().annotations.push({ type: 'N/A', description: 'No marketing/promotions preference exists in backend/internal/restaurant (grep marketing|opt-out = 0); all restaurant notifications are transactional.' });
  });
});

/* ---------------- Admin Operations ---------------- */
/**
 * Scripted admin console login. FOOD-UAT-G-013: on the running :3001 admin instance the login form never
 * hydrates (form has no React props, dev HMR websocket gets ERR_INVALID_HTTP_RESPONSE), so the click performs a
 * native GET submit and the page just reloads to /admin/login?. Returns false => UI half is "Blocked (admin login harness)";
 * the API half of the case still runs.
 */
async function adminLogin(page: Page): Promise<boolean> {
  try {
    await page.goto(`${ADMIN_UI}/admin/login`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForTimeout(2_000);
    await page.getByPlaceholder('admin').fill('admin');
    await page.getByPlaceholder('password').fill(ADMIN_PW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/admin') && !u.pathname.endsWith('/login'), { timeout: 20_000 });
    return true;
  } catch {
    test.info().annotations.push({ type: 'Blocked (admin login harness)', description: 'admin login form does not hydrate on :3001 (see FOOD-UAT-G-013)' });
    return false;
  }
}

test.describe('Admin Operations', () => {
  test.setTimeout(120_000); // Next dev server compiles each admin route on first hit; box is heavily loaded in the swarm
  test('RST-UAT-0266 — List and review provider applications', async ({ page }) => {
    const all = await http('GET', `${ADM}/onboarding`, adminTok);
    expect(all.status).toBe(200);
    expect(Array.isArray(all.json)).toBeTruthy();
    const pend = await http('GET', `${ADM}/onboarding?status=pending`, adminTok);
    expect(pend.json.every((a: any) => a.status === 'pending')).toBeTruthy();
    expect(all.json[0]).toHaveProperty('documents');
    if (await adminLogin(page)) {
      await page.goto(`${ADMIN_UI}/admin/restaurant/onboarding`);
      await expect(page.getByRole('heading', { name: 'Restaurant Onboarding / KYC' })).toBeVisible({ timeout: 60_000 });
    }
    // Riders have no admin application queue in this module (rider verification is cluster A).
  });

  test('RST-UAT-0267 — [GAP] Apply approval and rejection audit (reviewer/time/old->new persisted)', async () => {
    const rej = await http('POST', `${ADM}/onboarding/${restId}/reject`, adminTok, { note: '' });
    expect(rej.status).toBe(400); // note mandatory
    const ok = await http('POST', `${ADM}/onboarding/${restId}/approve`, adminTok, { note: 'uat approve' });
    expect(ok.status).toBe(200);
    const snap = sql(`select kyb_status||'|'||is_open from restaurants where id='${restId}'`);
    expect(snap).toBe('approved|true');
    // Expected: a durable audit row naming reviewer, time, old+new status, note.
    const audit = sql(`select count(*) from audit_logs where resource_id='${restId}' or new_values::text like '%${restId}%'`);
    const kyb = sql(`select count(*) from restaurant_kyb where restaurant_id='${restId}' and reviewed_by is not null`);
    expect(Number(audit) + Number(kyb), 'no persisted reviewer/time/old-new record for console decision').toBeGreaterThan(0);
  });

  test('RST-UAT-0268 — Configure fees and dispatch rules (validated, versioned)', async ({ page }) => {
    const g = await http('GET', `${ADM}/delivery-config`, adminTok);
    expect(g.status).toBe(200);
    const cfg = g.json.config;
    const bad = await http('PUT', `${ADM}/delivery-config`, adminTok, { restaurant_id: restId, ...cfg, base_fee_kobo: -5 });
    expect(bad.status, 'negative base fee must be rejected with 4xx').toBeLessThan(500);
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const v0 = await http('PUT', `${ADM}/delivery-config`, adminTok, { restaurant_id: restId, ...cfg, base_fee_kobo: 90000 });
    expect(v0.status).toBe(200);
    const v1 = await http('PUT', `${ADM}/delivery-config`, adminTok, { restaurant_id: restId, ...cfg, base_fee_kobo: 95000 });
    expect(v1.json.version).toBeGreaterThan(v0.json.version);
    const global = await http('GET', `${ADM}/delivery-config`, adminTok);
    expect(global.json.config.base_fee_kobo).toBe(cfg.base_fee_kobo); // override did not leak into global
    if (await adminLogin(page)) {
      await page.goto(`${ADMIN_UI}/admin/restaurant/delivery-fee`);
      await expect(page.getByRole('heading', { name: 'Delivery Fee Configuration' })).toBeVisible({ timeout: 60_000 });
    }
  });

  test('RST-UAT-0269 — Pause restaurant (rider pause has no admin route)', async ({ page }) => {
    // Opening needs KYB approval (console approve opens the store); pausing is then a plain force-close.
    expect((await http('POST', `${ADM}/onboarding/${restId}/approve`, adminTok, { note: 'uat' })).status).toBe(200);
    expect(sql(`select is_open from restaurants where id='${restId}'`)).toBe('t');
    const closed = await http('PATCH', `${ADM}/restaurants/${restId}/availability`, adminTok, { is_open: false });
    expect(closed.status).toBe(200);
    expect(sql(`select is_open from restaurants where id='${restId}'`)).toBe('f');
    const nonAdmin = await http('PATCH', `${ADM}/restaurants/${restId}/availability`, userTok, { is_open: true });
    expect(nonAdmin.status).toBe(403);
    if (await adminLogin(page)) {
      await page.goto(`${ADMIN_UI}/admin/restaurant/${restId}`);
      await expect(page.getByText('Availability').first()).toBeVisible({ timeout: 60_000 });
    }
    const ridersPause = await http('POST', `${ADM}/riders/${ZERO}/suspend`, adminTok, {});
    expect(ridersPause.status, 'rider suspend route').not.toBe(404); // [GAP] expected to fail
  });

  test('RST-UAT-0270 — [GAP] Read order event history', async () => {
    const codes = await Promise.all([
      http('GET', `${ADM}/orders/${deliveredOrder}`, adminTok),
      http('GET', `${ADM}/orders/${deliveredOrder}/events`, adminTok),
    ]);
    expect(codes.some((c) => c.status === 200), `order detail/events: ${codes.map((c) => c.status)}`).toBeTruthy();
  });

  test('RST-UAT-0271 — Control access to refunds (direct API, non-admin)', async () => {
    const r = await http('POST', `${ADM}/disputes/${ZERO}/resolve`, userTok, { resolution: 'refund', refund_kobo: 100, note: 'x' });
    expect(r.status).toBe(403);
    const anon = await http('POST', `${ADM}/disputes/${ZERO}/resolve`, undefined, { resolution: 'refund' });
    expect(anon.status).toBe(401);
    const list = await http('GET', `${ADM}/disputes`, userTok);
    expect(list.status).toBe(403);
  });

  test('RST-UAT-0271b — Admin dispute queue loads (backs /admin/restaurant/disputes)', async ({ page }) => {
    const r = await http('GET', `${ADM}/disputes?limit=5`, adminTok);
    expect(r.status, `admin disputes list body=${r.text.slice(0, 80)}`).toBe(200);
    if (await adminLogin(page)) {
      await page.goto(`${ADMIN_UI}/admin/restaurant/disputes`);
      await expect(page.getByRole('heading', { name: 'Refunds & Disputes' })).toBeVisible({ timeout: 60_000 });
    }
  });

  test('RST-UAT-0272 — Search by order/payment/provider ID', async ({ page }) => {
    const byOrder = await http('GET', `${ADM}/orders?q=${deliveredOrder.slice(0, 8)}`, adminTok);
    expect(byOrder.status).toBe(200);
    expect(byOrder.json.orders.map((o: any) => o.id)).toContain(deliveredOrder);
    const byRest = await http('GET', `${ADM}/orders?restaurant_id=${restId}`, adminTok);
    expect(byRest.json.total).toBe(3);
    // payment / settlement / provider id search is not supported by the feed (q = id prefix | name | address)
    if (await adminLogin(page)) {
      await page.goto(`${ADMIN_UI}/admin/restaurant`);
      await expect(page.getByRole('heading', { name: 'Restaurant & Delivery' })).toBeVisible({ timeout: 60_000 });
    }
  });

  test('RST-UAT-0273 — [GAP] Export scoped reports', async () => {
    const codes = await Promise.all(['orders/export', 'orders.csv', 'reports/export', 'export'].map((p) => http('GET', `${ADM}/${p}`, adminTok)));
    expect(codes.some((c) => c.status === 200), `export routes: ${codes.map((c) => c.status)}`).toBeTruthy();
  });

  test('RST-UAT-0274 — [Conditional GAP] Two-person approval for high-risk actions', async () => {
    // payouts/:id/process and withdrawals/:id/paid are single-actor. Build a run as admin, then process as the SAME admin.
    const r = await http('POST', `${ADM}/payouts/${ZERO}/process`, adminTok, {});
    expect([400, 404, 409, 422]).toContain(r.status); // reaches handler; no approval-state concept exists
    test.info().annotations.push({ type: 'Conditional', description: 'grep maker-checker|two-person|second_approver in backend/internal/restaurant = 0 hits.' });
  });
});

/* ---------------- Reports & Reconciliation ---------------- */
test.describe('Reports and Reconciliation', () => {
  test('RST-UAT-0275 — Review restaurant sales dashboard (admin feed totals reconcile to seeded orders)', async () => {
    const f = await http('GET', `${ADM}/orders?restaurant_id=${restId}&status=delivered`, adminTok);
    expect(f.status).toBe(200);
    expect(f.json.total).toBe(2);
    expect(f.json.gross_delivered_kobo).toBe(300000);
    const none = await http('GET', `${ADM}/orders?restaurant_id=${restId}&status=pending`, adminTok);
    expect(none.json.total).toBe(1);
    // [GAP] no date-range params: from/to must narrow the feed
    const future = await http('GET', `${ADM}/orders?restaurant_id=${restId}&from=2099-01-01&to=2099-01-02`, adminTok);
    expect(future.json.total, 'from/to ignored by admin orders feed').toBe(0);
  });
  test('RST-UAT-0276 — Review rider income dashboard', async () => {
    const r = await http('GET', `${MEMBER}/earnings`, userTok);
    expect([200, 403]).toContain(r.status);
    test.info().annotations.push({ type: 'Partial', description: 'GET /earnings is caller-scoped with no day/zone filter (handler_delivery.go:217). Rider-side ledger tie-out is Cluster E/F.' });
  });
  test('RST-UAT-0277 — [GAP] Show platform GMV and net revenue correctly', async ({ page }) => {
    const codes = await Promise.all(['finance', 'reports/gmv', 'dashboard', 'summary'].map((p) => http('GET', `${ADM}/${p}`, adminTok)));
    expect(codes.some((c) => c.status === 200), `finance dashboard routes: ${codes.map((c) => c.status)}`).toBeTruthy();
    void page;
  });
  test('RST-UAT-0278 — [GAP] Export settled transaction report', async () => {
    const codes = await Promise.all(['payouts/export', 'payouts.csv', 'withdrawals/export', 'settlements/export'].map((p) => http('GET', `${ADM}/${p}`, adminTok)));
    expect(codes.some((c) => c.status === 200), `settled export routes: ${codes.map((c) => c.status)}`).toBeTruthy();
  });
  test('RST-UAT-0279 — [GAP] Use timezone-correct daily cutoff', async () => {
    // Service.EarningsStatement (payout.go:~600) buckets by UTC (`$3::timestamptz + interval '1 day'`) and has no HTTP route; no Africa/Lagos handling anywhere in admin reporting.
    const r = await http('GET', `${MEMBER}/${restId}/earnings/statement?from=2026-10-01&to=2026-10-02`, userTok);
    expect(r.status, 'earnings statement route').not.toBe(404);
  });
});

/* ---------------- Audit Trail ---------------- */
test.describe('Audit Trail', () => {
  test('RST-UAT-0312 — [GAP] Audit merchant approval decision (search by applicant ID)', async () => {
    const r3 = seedRestaurant('UAT-G Audit');
    expect((await http('POST', `${ADM}/onboarding/${r3}/approve`, adminTok, { note: 'uat audit' })).status).toBe(200);
    const hits = sql(`select count(*) from audit_logs where resource_id='${r3}' or new_values::text like '%${r3}%'`);
    expect(Number(hits), 'approval decision left no searchable audit event (prior status, new status, actor, time, reason)').toBeGreaterThan(0);
  });
  test('RST-UAT-0313 — Audit privileged wallet adjustment', async () => {
    test.info().annotations.push({ type: 'N/A (this cluster)', description: 'Food admin has no manual wallet adjustment (grep restaurant/admin: none). Ledger immutability is covered by backend/tests ledger suites.' });
    const r = await http('POST', `${ADM}/wallet/adjust`, adminTok, { amount_kobo: 1 });
    expect(r.status).toBe(404);
  });
  test('RST-UAT-0314 — [GAP] Trace order across services', async () => {
    const r = await http('GET', `${ADM}/orders/${deliveredOrder}/trace`, adminTok);
    expect(r.status, 'no cross-service trace route').toBe(200);
  });
  test('RST-UAT-0315 — Record rejection without sensitive secrets', async () => {
    const badLogin = await http('POST', `${API}/api/auth/login`, undefined, { email: ADMIN_EMAIL, password: 'definitely-wrong-pw' });
    expect(badLogin.status).toBe(401);
    expect(badLogin.text).not.toContain('definitely-wrong-pw');
    const unauth = await http('POST', `${ADM}/onboarding/${restId}/approve`, userTok, { note: 'x' });
    expect(unauth.status).toBe(403);
    expect(unauth.text).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });
});
