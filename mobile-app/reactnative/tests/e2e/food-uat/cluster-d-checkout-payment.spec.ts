/**
 * Restaurant UAT-332 — Cluster D: Checkout, Payment/Webhook/Recovery,
 * Restaurant Order Lifecycle, Kitchen Execution (RST-UAT-0135 .. RST-UAT-0168).
 *
 * Contract: docs/qa/food-uat-332/README.md. READ-ONLY on product code.
 * Results:  docs/qa/food-uat-332/cluster-d-checkout-payment.md
 *
 * Three layers, because UI alone cannot prove a money path:
 *   1. UI (RN web, EXPO_PUBLIC_FOOD_USE_MOCK=true)  — screen gating only.
 *      Run against a mock-mode Metro: the long-lived :8083 server in this
 *      environment points at the CLOUD staging backend with FOOD_USE_MOCK=false,
 *      so it must not be driven with a fake session. Start a mock server:
 *        EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 \
 *        EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *        EXPO_PUBLIC_FOOD_USE_MOCK=true npx expo start --web --port 8093
 *      then E2E_BASE_URL=http://127.0.0.1:8093 npx playwright test ...
 *   2. backend invariants (HTTP) — fetch straight to the Go API on :8080 with a
 *      real GoTrue token (dev fixture from scripts/dev/ensure-dev-login.sh).
 *   3. backend invariants (go test) — shells out to the existing Go
 *      money-path suites (live DB on :54322) so each RST id points at an
 *      executable proof where the local stack lacks seed data (no KYB-approved
 *      restaurant, zero orders, qa wallet balance 0).
 *
 * Prior sign-off invariants kept as positive coverage:
 *   FOOD-009  payout batch must not double-pay settled orders  -> RST-UAT-0146 / go
 *   ADR-041   card tops up wallet then spends (no double charge) -> RST-UAT-0151
 *   FOOD-003/010 only KYB-approved restaurants take paid orders -> RST-UAT-0154
 */
import { expect, test, type Page } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mockAuth, mockPinStatus, seedSession } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { users } from '../helpers/testData';

const API = process.env.FOOD_UAT_API ?? 'http://127.0.0.1:8080';
const FOOD = `${API}/api/finance/restaurant`;
const WEBHOOK = `${API}/api/webhooks/paystack/go`;
const GOTRUE = process.env.FOOD_UAT_GOTRUE ?? 'http://127.0.0.1:54321';
// scripts/dev/ensure-dev-login.sh documents this single fixture password.
const DEV_PASSWORD = process.env.DEV_LOGIN_PASSWORD ?? 'LocalDevAdmin123!';
const CUSTOMER_EMAIL = 'qa-claude-test@spotlight.internal';
const RN_DIR = resolve(__dirname, '../../..');
const BACKEND_DIR = resolve(RN_DIR, '../../backend');

// ---------------------------------------------------------------- helpers ---

function sh(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
  } catch {
    return null;
  }
}
const containerEnv = (name: string) => sh('docker', ['exec', 'new-api-1', 'printenv', name]);
const psql = (sql: string) => sh('docker', ['exec', 'supabase_db_spotlight', 'psql', '-U', 'postgres', '-At', '-c', sql]);

async function apiUp(): Promise<boolean> {
  try {
    return (await fetch(`${API}/healthz`)).ok;
  } catch {
    return false;
  }
}

async function tokenFor(email: string): Promise<string | null> {
  // Local GoTrue (:54321) answers the password grant without a real anon key; a supplied one is used when present.
  const anon = process.env.SUPABASE_ANON_KEY ?? containerEnv('SUPABASE_ANON_KEY') ?? 'local-dev-anon';
  const res = await fetch(`${GOTRUE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEV_PASSWORD }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { access_token?: string }).access_token ?? null;
}

async function call(method: string, path: string, opts: { token?: string | null; body?: unknown; idem?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await fetch(`${FOOD}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, text, json };
}

function signedWebhook(secret: string, payload: object, tamper?: (raw: string) => string) {
  const raw = JSON.stringify(payload);
  const sig = createHmac('sha512', secret).update(raw).digest('hex');
  return { raw: tamper ? tamper(raw) : raw, sig };
}
async function postWebhook(raw: string, sig: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== null) headers['x-paystack-signature'] = sig;
  const res = await fetch(WEBHOOK, { method: 'POST', headers, body: raw });
  return { status: res.status, text: await res.text() };
}

/** Run named Go tests (live-DB suites run against local PG :54322). */
function goTest(pkg: string, runRegex: string): { ok: boolean; out: string } {
  const r = spawnSync('go', ['test', pkg, '-count=1', '-run', runRegex, '-v'], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    timeout: 240_000,
    env: {
      ...process.env,
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable',
    },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { ok: r.status === 0 && /^ok\s/m.test(out) && !/^--- FAIL/m.test(out), out };
}
function expectGoPass(pkg: string, regex: string, mustContain: string[]) {
  const r = goTest(pkg, regex);
  for (const name of mustContain) expect(r.out, `${name} did not run/pass`).toMatch(new RegExp(`--- PASS: ${name}\\b`));
  expect(r.ok, r.out.slice(-1500)).toBe(true);
}

async function signIn(page: Page) {
  await mockAmbientRequests(page);
  await mockAuth(page, users.funded);
  await mockPinStatus(page, true);
  await seedSession(page, users.funded);
}

// =============================================================== 1. UI =====

test.describe('UI — checkout gating (mock mode)', () => {
  test.setTimeout(150_000); // cold Metro bundle
  const CHECKOUT_SRC = () => sh('cat', [resolve(RN_DIR, 'app/food/checkout.tsx')]) ?? '';

  async function open(page: Page, path: string) {
    await signIn(page);
    await page.goto(path);
    await page.waitForFunction(() => document.body.innerText.length > 30, null, { timeout: 100_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    if (/\/login/.test(page.url())) {
      // The AuthGate rejects the seeded fake session in this environment (same failure as the
      // pre-existing modules/food.spec.ts baseline). Record Blocked and fall back to source assertions.
      test.info().annotations.push({ type: 'blocked', description: 'seeded session bounced to /login (AuthGate); UI assertions replaced by source checks' });
      return false;
    }
    return true;
  }

  test('RST-UAT-0137 — Block empty cart checkout (UI)', async ({ page }) => {
    const orderPosts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/orders(\/|$)/.test(r.url())) orderPosts.push(r.url());
    });
    if (await open(page, '/food/checkout')) {
      await expect(page.getByText('Your cart is empty')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Pay & place order/)).toHaveCount(0);
    }
    expect(orderPosts, 'no order/payment request may be created for an empty cart').toEqual([]);
    expect(CHECKOUT_SRC()).toContain('Your cart is empty');
  });

  test('RST-UAT-0138 — Require selected delivery address (UI)', async ({ page }) => {
    const src = CHECKOUT_SRC();
    // CTA is disabled without an address and onPlace returns early (no payment sheet / request).
    expect(src).toMatch(/disabled=\{!address\.trim\(\)/);
    expect(src).toMatch(/if \(!restaurantId \|\| !address\.trim\(\)/);
    if (await open(page, '/food/restaurant/r1')) {
      const add = page.getByLabel(/^Add /i).first();
      await expect(add, 'menu add control').toBeVisible({ timeout: 30_000 });
      await add.click();
      await page.goto('/food/checkout');
      const cta = page.getByRole('button', { name: /Pay & place order/ }).first();
      await expect(cta).toBeVisible({ timeout: 30_000 });
      expect(await cta.getAttribute('aria-disabled')).toBe('true');
    }
  });
});

// ================================================ 2. backend invariants (HTTP) =

test.describe('backend invariants (HTTP)', () => {
    test.setTimeout(300_000); // Go test compile + live-DB suites
  let token: string | null = null;
  let webhookSecret: string | null = null;
  let customerId: string | null = null;
  const unknownRestaurant = randomUUID();

  test.beforeAll(async () => {
    test.skip(!(await apiUp()), `Go API not reachable on ${API}`);
    token = await tokenFor(CUSTOMER_EMAIL);
    webhookSecret = containerEnv('PAYSTACK_SECRET_KEY');
    customerId = psql(`select id from auth.users where email='${CUSTOMER_EMAIL}'`);
  });

  const countOrders = () => Number(psql(`select count(*) from orders where customer_id='${customerId}'`) ?? NaN);
  /** Rows that a given (fabricated) reference could have produced. Global counts are flaky: other swarm agents and the Go live-DB suites write orders concurrently. */
  const intentsFor = (ref: string) => Number(psql(`select count(*) from restaurant_order_paystack_intents where reference='${ref}'`) ?? NaN);
  const ordersFor = (ref: string) => Number(psql(`select count(*) from orders where idempotency_key like '%${ref}%'`) ?? NaN);

  const validBody = (over: Record<string, unknown> = {}) => ({
    items: [{ item_id: randomUUID(), qty: 1 }],
    delivery_address: '1 Admiralty Way, Lekki, Lagos',
    ...over,
  });

  // ---- Checkout & Creation -------------------------------------------------

  test('RST-UAT-0135 — Order creation requires an authenticated customer (server totals only)', async () => {
    const r = await call('POST', `/${unknownRestaurant}/orders`, { body: validBody(), idem: randomUUID() });
    expect(r.status).toBe(401);
    // The request DTO has no client-settable totals/switches (see go guard below).
    expectGoPass('./internal/restaurant/', '^TestPlaceOrderRequest_HasNoClientSettableExternalSwitch$', [
      'TestPlaceOrderRequest_HasNoClientSettableExternalSwitch',
    ]);
  });

  test('RST-UAT-0136 — Pickup order mode — NOT APPLICABLE: no pickup/collection fulfilment in PlaceOrderRequest', async () => {
    // PlaceOrderRequest (backend/internal/restaurant/model.go) has binding:"required" on
    // delivery_address and no fulfilment-mode field; checkout.tsx disables the CTA without an
    // address and contains no "pickup" branch. Prove the server side live: omitting the address is a 400.
    test.skip(!token, 'no customer token');
    const r = await call('POST', `/${unknownRestaurant}/orders`, {
      token,
      idem: randomUUID(),
      body: { items: [{ item_id: randomUUID(), qty: 1 }], fulfilment: 'pickup' },
    });
    expect(r.status).toBe(400);
  });

  test('RST-UAT-0137 — Block empty cart checkout (API): 400, no order row', async () => {
    test.skip(!token, 'no customer token');
    const before = countOrders();
    const r = await call('POST', `/${unknownRestaurant}/orders`, { token, idem: randomUUID(), body: validBody({ items: [] }) });
    expect(r.status).toBe(400);
    expect(countOrders()).toBe(before);
  });

  test('RST-UAT-0138 — Require delivery address (API): 400, no order row', async () => {
    test.skip(!token, 'no customer token');
    const before = countOrders();
    const r = await call('POST', `/${unknownRestaurant}/orders`, {
      token,
      idem: randomUUID(),
      body: { items: [{ item_id: randomUUID(), qty: 1 }] },
    });
    expect(r.status).toBe(400);
    expect(countOrders()).toBe(before);
  });

  test('RST-UAT-0139 — Notes + modifiers in order snapshot (backend proof; mobile client has no input)', async () => {
    // Backend snapshots modifiers + sanitised special_instructions (go suites). The RN client sends
    // neither: grep of app/food + src/features/food finds no "instructions"/modifier UI (FOOD-UAT-D-004).
    expectGoPass(
      './internal/restaurant/',
      '^(TestLiveDB_OrderModifiersPricedAndSnapshotted|TestLiveDB_OrderModifierSelectionIsValidated|TestLiveDB_OrderWithoutModifiersUnchanged|TestResolveLineModifiers_Valid|TestResolveLineModifiers_Invalid)$',
      ['TestLiveDB_OrderModifiersPricedAndSnapshotted', 'TestLiveDB_OrderModifierSelectionIsValidated'],
    );
  });

  test('RST-UAT-0140 — Idempotency-Key mandatory; replay returns one order; keys are customer-scoped', async () => {
    test.skip(!token, 'no customer token');
    const noKey = await call('POST', `/${unknownRestaurant}/orders`, { token, body: validBody() });
    expect(noKey.status).toBe(400);
    expect(noKey.text.toLowerCase()).toContain('idempotency');
    expectGoPass(
      './internal/restaurant/',
      '^(TestLiveDB_OrderRequiresIdempotencyKey|TestLiveDB_OrderIdempotencyKeyIsCustomerScoped|TestLiveDB_OrderPromoIdempotentReplay)$',
      ['TestLiveDB_OrderRequiresIdempotencyKey', 'TestLiveDB_OrderIdempotencyKeyIsCustomerScoped', 'TestLiveDB_OrderPromoIdempotentReplay'],
    );
    expectGoPass(
      './internal/restaurant/paystackcheckout/',
      '^(TestLiveDB_PutIntent_IdempotentOnKey|TestInitiateCheckout_ReplayReusesFrozenAmount|TestLiveDB_PutIntent_ForeignKeyIsCollisionNotReplay)$',
      ['TestLiveDB_PutIntent_IdempotentOnKey', 'TestInitiateCheckout_ReplayReusesFrozenAmount'],
    );
  });

  test('RST-UAT-0141 — Unavailable/unknown store is refused with no order and no charge', async () => {
    test.skip(!token, 'no customer token');
    const before = countOrders();
    const r = await call('POST', `/${unknownRestaurant}/orders`, { token, idem: randomUUID(), body: validBody() });
    expect([400, 404, 409, 422]).toContain(r.status);
    expect(countOrders()).toBe(before);
    // Card rail: stale quote vs collected amount is refunded, never kept (amount_mismatch / order_failed).
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestOnChargeSuccess_AmountMismatchRefundsAndMarks|TestOnChargeSuccess_PlacementFailureRefundsAndMarksOrderFailed)$', [
      'TestOnChargeSuccess_AmountMismatchRefundsAndMarks',
      'TestOnChargeSuccess_PlacementFailureRefundsAndMarksOrderFailed',
    ]);
  });

  test('RST-UAT-0142 — Abandoned checkout: pending intent self-heals; no order until payment verifies', async () => {
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestCheckStatus_PendingWhenNotYetPaid|TestCheckStatus_SelfHealsPendingIntent|TestOnChargeSuccess_NotSuccessfulMovesNothing)$', [
      'TestCheckStatus_PendingWhenNotYetPaid',
      'TestOnChargeSuccess_NotSuccessfulMovesNothing',
    ]);
    // FOOD-UAT-D-005 (Major): no expiry/reaper for intents left pending/processing.
    const stale = psql(
      "select count(*) from restaurant_order_paystack_intents where status='pending' and created_at < now() - interval '1 day'",
    );
    test.info().annotations.push({ type: 'observation', description: `pending intents older than 1 day: ${stale} (no reaper exists in code)` });
  });

  // ---- Payment, Webhook & Recovery ----------------------------------------

  test('RST-UAT-0143 — Successful online payment => exactly one paid order (card rail flag-gated)', async () => {
    test.skip(!token, 'no customer token');
    // FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED is OFF in the local container: routes are unmounted.
    const init = await call('POST', `/${unknownRestaurant}/orders/paystack/initiate`, { token, idem: randomUUID(), body: validBody() });
    const stat = await call('GET', '/orders/paystack/foodorder-uat/status', { token });
    test.info().annotations.push({ type: 'deferred', description: `card rail initiate=${init.status} status=${stat.status} (404 = flag OFF)` });
    expect([201, 400, 404, 409, 422]).toContain(init.status);
    expectGoPass('./internal/restaurant/paystackcheckout/', '^TestOnChargeSuccess_PlacesOrderAndConfirms$', ['TestOnChargeSuccess_PlacesOrderAndConfirms']);
  });

  test('RST-UAT-0144 — Declined/unsuccessful charge never places an order', async () => {
    expectGoPass('./internal/restaurant/paystackcheckout/', '^TestOnChargeSuccess_NotSuccessfulMovesNothing$', ['TestOnChargeSuccess_NotSuccessfulMovesNothing']);
  });

  test('RST-UAT-0145 — Gateway timeout then later success reconciles via status self-heal', async () => {
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestCheckStatus_SelfHealsPendingIntent|TestCheckStatus_VerifyTransientErrorStaysPending)$', [
      'TestCheckStatus_SelfHealsPendingIntent',
      'TestCheckStatus_VerifyTransientErrorStaysPending',
    ]);
  });

  test('RST-UAT-0146 — Duplicate success webhook: acted on once (HTTP replay x3 + atomic claim)', async () => {
    test.skip(!webhookSecret, 'PAYSTACK_SECRET_KEY not readable from container');
    const ref = `foodorder-uat-d-${randomUUID()}`;
    const { raw, sig } = signedWebhook(webhookSecret!, { event: 'charge.success', data: { reference: ref, amount: 150000, currency: 'NGN', status: 'success' } });
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await postWebhook(raw, sig));
    for (const r of results) expect(r.status).toBe(200);
    expect(new Set(results.map((r) => r.text)).size, 'replays must answer identically').toBe(1);
    expect(ordersFor(ref), 'no order may carry this reference').toBe(0);
    expect(intentsFor(ref), 'no intent may be created or mutated by a webhook').toBe(0);
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestOnChargeSuccess_ConcurrentDeliveriesActOnce|TestLiveDB_ClaimForProcessing_AtomicUnderConcurrency)$', [
      'TestOnChargeSuccess_ConcurrentDeliveriesActOnce',
      'TestLiveDB_ClaimForProcessing_AtomicUnderConcurrency',
    ]);
    // FOOD-009 positive coverage: settled-at-delivery orders are excluded from the payout batch.
    expectGoPass('./internal/restaurant/', '^TestLiveDB_PayoutRunExcludesSettlementAlreadyPaidDirectlyAtDelivery$', [
      'TestLiveDB_PayoutRunExcludesSettlementAlreadyPaidDirectlyAtDelivery',
    ]);
  });

  test('RST-UAT-0147 — Forged / mis-signed webhook is rejected (401), nothing marked paid', async () => {
    test.skip(!webhookSecret, 'PAYSTACK_SECRET_KEY not readable from container');
    const ref = `foodorder-uat-d-${randomUUID()}`;
    const payload = { event: 'charge.success', data: { reference: ref, amount: 150000, currency: 'NGN' } };
    const good = signedWebhook(webhookSecret!, payload);

    expect((await postWebhook(good.raw, 'deadbeef')).status, 'wrong signature').toBe(401);
    expect((await postWebhook(good.raw, null)).status, 'missing signature').toBe(401);
    // Altered amount after signing => body no longer matches the HMAC.
    const tampered = signedWebhook(webhookSecret!, payload, (raw) => raw.replace('150000', '1'));
    expect((await postWebhook(tampered.raw, tampered.sig)).status, 'amount altered after signing').toBe(401);
    // Altered reference after signing.
    const swapped = signedWebhook(webhookSecret!, payload, (raw) => raw.replace(ref, `foodorder-uat-d-${randomUUID()}`));
    expect((await postWebhook(swapped.raw, swapped.sig)).status, 'reference altered after signing').toBe(401);
    // Signed with a different secret.
    const other = signedWebhook('sk_test_not_the_secret', payload);
    expect((await postWebhook(other.raw, other.sig)).status, 'wrong secret').toBe(401);
    expect(ordersFor(ref), 'no order may carry this reference').toBe(0);
    expect(intentsFor(ref), 'no intent may be created or mutated by a webhook').toBe(0);
  });

  test('RST-UAT-0148 — Wrong amount/currency is refunded, never settled as valid', async () => {
    test.skip(!webhookSecret, 'PAYSTACK_SECRET_KEY not readable from container');
    // HTTP layer: a correctly-signed event for an unknown reference is a benign no-op (200, no rows).
    const ref = `foodorder-uat-d-${randomUUID()}`;
    const { raw, sig } = signedWebhook(webhookSecret!, { event: 'charge.success', data: { reference: ref, amount: 1, currency: 'USD' } });
    expect((await postWebhook(raw, sig)).status).toBe(200);
    expect(ordersFor(ref), 'no order may carry this reference').toBe(0);
    // Domain layer: verified amount != frozen quote => full refund + intent amount_mismatch/refunded.
    expectGoPass(
      './internal/restaurant/',
      '^(TestLiveDB_PlaceOrderPaystackFunded_AmountMismatchRejects|TestLiveDB_QuoteOrder_MatchesPlaceOrderPaystackFundedTotal)$',
      ['TestLiveDB_PlaceOrderPaystackFunded_AmountMismatchRejects', 'TestLiveDB_QuoteOrder_MatchesPlaceOrderPaystackFundedTotal'],
    );
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestOnChargeSuccess_AmountMismatchRefundsAndMarks|TestOnChargeSuccess_FailedRefundLeavesHonestStatus)$', [
      'TestOnChargeSuccess_AmountMismatchRefundsAndMarks',
      'TestOnChargeSuccess_FailedRefundLeavesHonestStatus',
    ]);
  });

  test('RST-UAT-0149 — Out-of-order callbacks: a later charge.failed never reverses a paid order', async () => {
    test.skip(!webhookSecret, 'PAYSTACK_SECRET_KEY not readable from container');
    const ref = `foodorder-uat-d-${randomUUID()}`;
    for (const event of ['charge.success', 'charge.failed', 'charge.success']) {
      const { raw, sig } = signedWebhook(webhookSecret!, { event, data: { reference: ref, amount: 150000, currency: 'NGN' } });
      expect((await postWebhook(raw, sig)).status).toBe(200);
    }
    expect(intentsFor(ref), 'no intent may be created or mutated by a webhook').toBe(0);
    expect(ordersFor(ref), 'no order may carry this reference').toBe(0);
    // Terminal intents are never re-processed (OnChargeSuccess returns the stored status).
    expectGoPass('./internal/restaurant/paystackcheckout/', '^TestOnChargeSuccess_ConcurrentDeliveriesActOnce$', ['TestOnChargeSuccess_ConcurrentDeliveriesActOnce']);
  });

  test('RST-UAT-0150 — Late bank-transfer receipt (flag-gated card/transfer rail)', async () => {
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestCheckStatus_SelfHealsPendingIntent|TestOnChargeSuccess_PlacementFailureRefundsAndMarksOrderFailed)$', [
      'TestCheckStatus_SelfHealsPendingIntent',
      'TestOnChargeSuccess_PlacementFailureRefundsAndMarksOrderFailed',
    ]);
  });

  test('RST-UAT-0151 — Retry after decline: one order, one capture (ADR-041 coverage)', async () => {
    // Reference is derived from the Idempotency-Key, intent PutIntent is ON CONFLICT DO NOTHING; a second
    // key is a second intent but the claim/refund path acts once per reference.
    expectGoPass('./internal/restaurant/paystackcheckout/', '^(TestInitiateCheckout_FreezesQuotedAmount|TestInitiateCheckout_ReplayReusesFrozenAmount|TestReferenceFor_IsAcceptedByPaystack)$', [
      'TestInitiateCheckout_FreezesQuotedAmount',
      'TestInitiateCheckout_ReplayReusesFrozenAmount',
    ]);
    expectGoPass('./internal/restaurant/', '^(TestLiveDB_CancelOrder_PaystackFundedUsesExternalRefunder|TestLiveDB_CancelOrder_PaystackFundedNoRefunderWiredFailsClosed)$', [
      'TestLiveDB_CancelOrder_PaystackFundedUsesExternalRefunder',
      'TestLiveDB_CancelOrder_PaystackFundedNoRefunderWiredFailsClosed',
    ]);
  });

  test('RST-UAT-0152 — Receipt / traceable reference: order + intent expose the reference', async () => {
    test.skip(!token, 'no customer token');
    const list = await call('GET', '/orders?role=customer', { token });
    expect(list.status).toBe(200);
    // Local stack has zero orders: the consistency assertion (customer = merchant = admin) is Blocked here.
    test.info().annotations.push({ type: 'blocked', description: `customer orders visible: ${JSON.stringify(list.json)} (no seed)` });
  });

  test('RST-UAT-0153 — Cash on delivery — NOT APPLICABLE: no COD mode in checkout or PlaceOrderRequest', async () => {
    const hits = sh('grep', ['-rniE', 'cash.on.delivery|\\bcod\\b|cash_on', `${BACKEND_DIR}/internal/restaurant/model.go`]);
    expect(hits ?? '').toBe('');
  });

  // ---- Restaurant order lifecycle -----------------------------------------

  test('RST-UAT-0154 — Paid order reaches the merchant queue once; only KYB-approved stores take orders (FOOD-003/010)', async () => {
    expectGoPass('./internal/restaurant/', '^TestLiveDB_SetAvailability_RequiresApprovedKYBToOpen$', ['TestLiveDB_SetAvailability_RequiresApprovedKYBToOpen']);
    const approved = psql("select count(*) from restaurants where kyb_status='approved'");
    test.info().annotations.push({ type: 'blocked', description: `approved restaurants in local DB: ${approved} (live push/sound cannot be exercised)` });
  });

  test('RST-UAT-0155 — Accept advances pending->confirmed once (owner-only)', async () => {
    expectGoPass('./internal/restaurant/', '^(TestCanTransition|TestAuthorizeStatusChange|TestClassifyOrderActor)$', ['TestCanTransition', 'TestAuthorizeStatusChange']);
  });

  test('RST-UAT-0156 — Reject with reason: service exists, NO HTTP route (FOOD-UAT-D-003)', async () => {
    test.skip(!token, 'no customer token');
    const routes = sh('grep', ['-rn', 'RejectOrder', `${BACKEND_DIR}/internal/app`, `${BACKEND_DIR}/internal/restaurant/handler.go`, `${BACKEND_DIR}/internal/restaurant/handler_delivery.go`]);
    expect(routes ?? '', 'RejectOrder is not reachable from any handler/route today').toBe('');
    // PATCH status=rejected is refused by authorizeStatusChange (403 for the owner too).
    const r = await call('PATCH', `/${unknownRestaurant}/orders/${randomUUID()}/status`, { token, body: { status: 'rejected' } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expectGoPass('./internal/restaurant/', '^TestLiveDB_OrderFSMExpansion$', ['TestLiveDB_OrderFSMExpansion']);
  });

  test('RST-UAT-0157 — Expire unaccepted order: sweep exists but is never scheduled (FOOD-UAT-D-002)', async () => {
    const callers = sh('grep', ['-rn', '--include=*.go', 'SweepUnacceptedOrders(', BACKEND_DIR]) ?? '';
    const nonTest = callers.split('\n').filter((l) => l && !l.includes('_test.go') && !l.includes('func (s *Service)'));
    expect(nonTest, 'accept-SLA sweep has no production caller/ticker/route').toEqual([]);
    expectGoPass('./internal/restaurant/', '^TestLiveDB_AvailabilityHolidayAndSweep$', ['TestLiveDB_AvailabilityHolidayAndSweep']);
  });

  test('RST-UAT-0158 — Status skip / illegal transition is rejected server-side', async () => {
    test.skip(!token, 'no customer token');
    for (const status of ['ready', 'delivered', 'picked_up', 'preparing']) {
      const r = await call('PATCH', `/${unknownRestaurant}/orders/${randomUUID()}/status`, { token, body: { status } });
      expect(r.status, `status=${status}`).toBeGreaterThanOrEqual(400);
    }
    const unauth = await call('PATCH', `/${unknownRestaurant}/orders/${randomUUID()}/status`, { body: { status: 'ready' } });
    expect(unauth.status).toBe(401);
    expectGoPass('./internal/restaurant/', '^(TestCanTransition|TestCanTransition_ExpandedStates)$', ['TestCanTransition', 'TestCanTransition_ExpandedStates']);
  });

  test('RST-UAT-0159 — Ordered preparation states are the only legal path', async () => {
    expectGoPass('./internal/restaurant/', '^TestCanTransition$', ['TestCanTransition']);
  });

  test('RST-UAT-0160 — Parallel accepts: transition is NOT compare-and-set (FOOD-UAT-D-001)', async () => {
    // transitionInternal does SELECT status ... then UPDATE orders SET status=$1 WHERE id=$2 with no
    // "AND status=$from" and no FOR UPDATE, so N parallel callers all pass canTransition and all
    // run side effects (events, notifications, dispatch on 'ready').
    const src = sh('sed', ['-n', '1228,1246p', `${BACKEND_DIR}/internal/restaurant/service.go`]) ?? '';
    expect(src).toContain('UPDATE orders SET status=$1 WHERE id=$2');
    expect(src, 'a guarded transition would include the FROM status in the WHERE clause').not.toMatch(/WHERE id=\$2 AND status/);
    expect(src).not.toMatch(/FOR UPDATE/);
  });

  test('RST-UAT-0161 — No endpoint lets a merchant mutate paid line items/prices', async () => {
    test.skip(!token, 'no customer token');
    for (const [m, p] of [
      ['PATCH', `/${unknownRestaurant}/orders/${randomUUID()}`],
      ['PUT', `/${unknownRestaurant}/orders/${randomUUID()}/items`],
      ['PATCH', `/${unknownRestaurant}/orders/${randomUUID()}/items`],
    ] as const) {
      const r = await call(m, p, { token, body: { items: [{ item_id: randomUUID(), qty: 0 }], total_kobo: 1 } });
      expect([404, 405], `${m} ${p}`).toContain(r.status);
    }
  });

  test('RST-UAT-0162 — Order PII is participant-scoped', async () => {
    test.skip(!token, 'no customer token');
    const one = await call('GET', `/orders/${randomUUID()}`, { token });
    expect([403, 404]).toContain(one.status);
    const asRestaurant = await call('GET', '/orders?role=restaurant', { token });
    expect([200, 403]).toContain(asRestaurant.status);
    if (asRestaurant.status === 200) expect(asRestaurant.json?.orders ?? []).toEqual([]);
    const unauth = await call('GET', '/orders?role=restaurant');
    expect(unauth.status).toBe(401);
    expectGoPass('./internal/restaurant/', '^(TestAuthorizeCancel|TestClassifyOrderActor)$', ['TestAuthorizeCancel', 'TestClassifyOrderActor']);
  });

  // ---- Kitchen execution ---------------------------------------------------

  test('RST-UAT-0163 — Kitchen ticket shows notes/modifiers — merchant screen omits them (FOOD-UAT-D-004)', async () => {
    const src = sh('cat', [resolve(RN_DIR, 'app/food/restaurant/order/[orderId].tsx')]) ?? '';
    expect(src).toContain('order.items.map');
    expect(src, 'merchant order screen renders no special instructions').not.toMatch(/instruction|specialInstructions|special_instructions/i);
    expect(src, 'merchant order screen renders no modifiers').not.toMatch(/modifier/i);
    expect(src, 'item names are clipped to one line').toMatch(/numberOfLines=\{1\}/);
  });

  test('RST-UAT-0164 — Prep/ready transitions are timestamped events', async () => {
    expectGoPass('./internal/restaurant/', '^(TestLiveDB_OrderFSMExpansion|TestLiveDB_ConfirmPickupRequiresPickupCode)$', ['TestLiveDB_OrderFSMExpansion', 'TestLiveDB_ConfirmPickupRequiresPickupCode']);
  });

  test('RST-UAT-0165 — Printer outage — NOT APPLICABLE: no printer integration exists', async () => {
    const hits = sh('grep', ['-rniE', 'printer|escpos|reprint', `${BACKEND_DIR}/internal/restaurant`, resolve(RN_DIR, 'app/food')]);
    expect(hits ?? '').toBe('');
  });

  test('RST-UAT-0166 — Allergen note survives to the kitchen — truncated/omitted (FOOD-UAT-D-004)', async () => {
    // Server keeps the note (sanitizeInstructions: control chars stripped, length capped) ...
    const sanitize = sh('grep', ['-n', 'maxInstructionsLen', `${BACKEND_DIR}/internal/restaurant/menucart.go`]) ?? '';
    expect(sanitize).not.toBe('');
    // ... but neither the customer app can enter one nor the merchant screen show one.
    const cust = sh('grep', ['-rliE', 'special_?instructions|instructions', resolve(RN_DIR, 'app/food'), resolve(RN_DIR, 'src/features/food')]) ?? '';
    expect(cust.split('\n').filter((f) => f && !f.includes('__tests__'))).toEqual([]);
  });

  test('RST-UAT-0167 — Non-owner cannot change payout bank account (401/403); staff matrix not wired', async () => {
    test.skip(!token, 'no customer token');
    const unauth = await call('POST', '/bank-accounts', { body: { account_number: '0000000000', bank_code: '058' } });
    expect(unauth.status).toBe(401);
    const stranger = await call('POST', '/bank-accounts', { token, idem: randomUUID(), body: { account_number: '0000000000', bank_code: '058' } });
    expect(stranger.status).toBeGreaterThanOrEqual(400);
    const other = await call('PATCH', `/bank-accounts/${randomUUID()}/default`, { token });
    expect(other.status).toBeGreaterThanOrEqual(400);
    const wired = sh('grep', ['-rn', '--include=*.go', '-E', 'RoleCan\\(|staffPermissions\\[|PermProgressOrder', `${BACKEND_DIR}/internal`]) ?? '';
    const used = wired.split('\n').filter((l) => l && !l.includes('_test.go') && !l.includes('staff_roles.go'));
    expect(used, 'KITCHEN/MANAGER permission matrix has no enforcement call site (FOOD-UAT-D-003b)').toEqual([]);
  });

  test('RST-UAT-0168 — Prep-time bounds validated; per-order ETA is fixed at placement', async () => {
    expectGoPass('./internal/restaurant/', '^(TestItemPrepBounds_FiveToOneEighty|TestRestaurantPrepDefault_StepsOfFive|TestEtaFoldsInTheSlowestItem)$', [
      'TestItemPrepBounds_FiveToOneEighty',
      'TestRestaurantPrepDefault_StepsOfFive',
      'TestEtaFoldsInTheSlowestItem',
    ]);
    const writers = sh('grep', ['-rn', '--include=*.go', 'UPDATE orders SET eta_minutes', `${BACKEND_DIR}/internal`]) ?? '';
    expect(writers, 'no code path revises eta_minutes on an open order').toBe('');
  });
});
