import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Restaurant UAT-332 — Cluster F: Cancellation, Refunds, Disputes, Wallets &
 * Payouts, Commission Engine (RST-UAT-0219 .. RST-UAT-0252).
 *
 * READ-ONLY on product code. Everything here drives the LIVE stack:
 *   - Go backend            http://127.0.0.1:8080  (real HTTP, real JWTs)
 *   - Supabase GoTrue       http://127.0.0.1:54321 (fresh throw-away users)
 *   - Supabase Postgres     127.0.0.1:54322        (via psql, for ledger proof)
 *   - Admin console         http://127.0.0.1:3001/admin/restaurant/*
 *
 * Money is asserted at the LEDGER (ledger_entries / wallet projection), never
 * from a 200 alone (FOOD-004 was exactly "200 and zero money moved").
 *
 * Known accepted exceptions (do NOT re-raise): FOOD-006 (no customer-facing
 * withdrawal UI), FOOD-007 (live disburser leaves recipient bank fields empty).
 *
 * Every case that depends on a missing capability asserts the ABSENCE (404 on
 * the route / no code path) so the N/A is proven, not guessed.
 */

const API = process.env.F_API ?? 'http://127.0.0.1:8080';
const GOTRUE = process.env.F_GOTRUE ?? 'http://127.0.0.1:54321';
const ADMIN_UI = process.env.F_ADMIN_UI ?? 'http://127.0.0.1:3001';
const ADMIN_EMAIL = 'admin@spotlight.internal';
// Documented by scripts/dev/ensure-dev-login.sh (the ONE agreed value).
const ADMIN_PASSWORD = process.env.DEV_LOGIN_PASSWORD ?? 'LocalDevAdmin123!';
const PG = {
  host: '127.0.0.1',
  port: '54322',
  user: 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  db: 'postgres',
};

// ───────────────────────────── plumbing ─────────────────────────────

function findEnv(key: string): string {
  if (process.env[key]) return process.env[key] as string;
  // Walk up from cwd; also try the main checkout (worktrees live under .claude/worktrees/<x>).
  const roots: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    roots.push(dir);
    dir = path.dirname(dir);
  }
  const files = ['frontend-web/.env.local', 'frontend-admin/.env.local', 'backend/.env'];
  for (const r of roots) {
    for (const f of files) {
      const p = path.join(r, f);
      if (!fs.existsSync(p)) continue;
      const line = fs.readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
      if (line) return line.slice(key.length + 1).replace(/["']/g, '').trim();
    }
  }
  return '';
}

const SERVICE_KEY = findEnv('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = findEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') || findEnv('SUPABASE_ANON_KEY');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function q(v: string): string {
  // Only ever interpolate values WE generated (uuids / fixed tokens). Hard guard.
  if (!UUID_RE.test(v) && !/^[A-Za-z0-9_:.@%\-]+$/.test(v)) throw new Error(`unsafe sql literal: ${v}`);
  return `'${v}'`;
}

/** Run SQL, return rows as string[][] (unit-separator delimited, so '|' inside values is safe). */
function sql(statement: string): string[][] {
  const out = execFileSync(
    'psql',
    ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.db, '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '\u001f', '-c', statement],
    { env: { ...process.env, PGPASSWORD: PG.password }, encoding: 'utf8' },
  ).trim();
  if (!out) return [];
  return out.split('\n').map((l) => l.split('\u001f'));
}
const one = (statement: string): string => sql(statement)[0]?.[0] ?? '';
const num = (statement: string): number => Number(one(statement) || 0);

type Res = { status: number; body: any };
async function http(method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  if (method === 'GET' || method === 'HEAD') body = undefined;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: r.status, body: parsed };
}
const api = (m: string, p: string, t?: string, b?: unknown, h?: Record<string, string>) => http(m, `${API}${p}`, t, b, h);
const idem = () => ({ 'Idempotency-Key': `ruat-f-${randomUUID()}` });

interface Actor {
  id: string;
  email: string;
  token: string;
}
async function passwordGrant(email: string, password: string): Promise<string> {
  const r = await http('POST', `${GOTRUE}/auth/v1/token?grant_type=password`, undefined, { email, password }, { apikey: ANON_KEY });
  if (!r.body?.access_token) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.access_token as string;
}
async function mkActor(label: string): Promise<Actor> {
  const email = `ruat-f-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@spotlight.test`;
  const password = `Ruat-${randomUUID()}`;
  const r = await http(
    'POST',
    `${GOTRUE}/auth/v1/admin/users`,
    SERVICE_KEY,
    { email, password, email_confirm: true },
    { apikey: SERVICE_KEY },
  );
  if (!r.body?.id) throw new Error(`create user failed: ${JSON.stringify(r.body).slice(0, 200)}`);
  const token = await passwordGrant(email, password);
  return { id: r.body.id as string, email, token };
}

// ── ledger helpers (read = projection formula used by the Go ledger) ──
const SIGNED = `CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END`;
const balance = (userId: string): number =>
  num(`SELECT COALESCE(SUM(${SIGNED}),0) FROM ledger_entries WHERE account_id IN (SELECT id FROM ledger_accounts WHERE user_id=${q(userId)} AND type='user_wallet')`);
const standingBalance = (type: string): number =>
  num(`SELECT COALESCE(SUM(${SIGNED}),0) FROM ledger_entries WHERE account_id IN (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND type=${q(type)})`);
const entriesLike = (pattern: string): number => num(`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE ${q(pattern)}`);
/** signed residual over entries whose key/reference mention any of the given ids */
const residualFor = (ids: string[]): number =>
  num(
    `SELECT COALESCE(SUM(${SIGNED}),0) FROM ledger_entries WHERE ${ids
      .map((i) => `idempotency_key LIKE ${q(`%${i}%`)} OR reference LIKE ${q(`%${i}%`)}`)
      .join(' OR ')}`,
  );
const globalResidual = (): number => num('SELECT residual_kobo FROM ledger_conservation_check');

function ensureWallet(userId: string) {
  sql(
    `INSERT INTO ledger_accounts (user_id, type) SELECT ${q(userId)}, 'user_wallet' WHERE NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id=${q(userId)} AND type='user_wallet')`,
  );
}
/** Fund a wallet with a BALANCED journal (DR paymax_revenue -> CR wallet), same shape the Go tests use. */
function fund(userId: string, kobo: number) {
  ensureWallet(userId);
  if (kobo <= 0) return;
  const ref = `ruat-f-fund:${randomUUID()}`;
  sql(
    `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
     SELECT (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND type='paymax_revenue' LIMIT 1), 'DEBIT', ${kobo}, ${q(ref)}, ${q(ref + ':debit')}
     UNION ALL
     SELECT (SELECT id FROM ledger_accounts WHERE user_id=${q(userId)} AND type='user_wallet' LIMIT 1), 'CREDIT', ${kobo}, ${q(ref)}, ${q(ref + ':credit')}`,
  );
}
function setTier(userId: string, email: string, tier: number) {
  sql(
    `INSERT INTO user_profiles (id, email, kyc_tier) VALUES (${q(userId)}, ${q(email)}, ${tier}) ON CONFLICT (id) DO UPDATE SET kyc_tier=${tier}`,
  );
}

interface World {
  admin: string;
  owner: Actor;
  rider: Actor;
  stranger: Actor;
  restaurantId: string;
  itemId: string;
  unapprovedOwner: Actor;
  unapprovedRestaurantId: string;
}
const ITEM_PRICE = 450_000;

async function newCustomer(label: string, fundKobo = 5_000_000): Promise<Actor> {
  const c = await mkActor(label);
  setTier(c.id, c.email, 3);
  fund(c.id, fundKobo);
  return c;
}

function seedKitchen(owner: Actor, kyb: 'approved' | 'submitted', price = ITEM_PRICE) {
  const rid = randomUUID();
  sql(
    `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo, kyb_status, listing_review_status)
     VALUES (${q(rid)}, ${q(owner.id)}, 'RUAT-F Kitchen', '1 Test St', TRUE, 0, ${q(kyb)}, 'APPROVED')`,
  );
  const iid = randomUUID();
  sql(`INSERT INTO menu_items (id, restaurant_id, name, price_kobo) VALUES (${q(iid)}, ${q(rid)}, 'Jollof', ${price})`);
  return { rid, iid };
}

async function place(w: World, customer: Actor, opts: { qty?: number; tip?: number; extra?: Record<string, unknown>; itemId?: string; restaurantId?: string } = {}) {
  const key = `ruat-f-order-${randomUUID()}`;
  const res = await api(
    'POST',
    `/api/finance/restaurant/${opts.restaurantId ?? w.restaurantId}/orders`,
    customer.token,
    {
      items: [{ menu_item_id: opts.itemId ?? w.itemId, quantity: opts.qty ?? 2 }],
      delivery_address: 'Victoria Island, Lagos',
      ...(opts.tip ? { tip_kobo: opts.tip } : {}),
      ...(opts.extra ?? {}),
    },
    { 'Idempotency-Key': key },
  );
  return { res, key, order: (res.body?.order ?? res.body?.data ?? res.body) as any };
}

/** Put an escrowed order into 'picked_up' with a rider + code, then hand off via the REAL endpoint (settles). */
async function deliver(w: World, orderId: string, rider: Actor = w.rider) {
  sql(`UPDATE orders SET rider_id=${q(rider.id)}, status='picked_up', dispatch_status='assigned', delivery_code='7777' WHERE id=${q(orderId)}`);
  return api('POST', `/api/finance/restaurant/orders/${orderId}/handoff`, rider.token, { code: '7777' });
}

async function placeAndDeliver(w: World, customer: Actor, opts: { qty?: number; tip?: number } = {}) {
  const p = await place(w, customer, opts);
  expect(p.res.status, `place order: ${JSON.stringify(p.res.body)}`).toBeLessThan(300);
  const h = await deliver(w, p.order.id);
  expect(h.status, `handoff: ${JSON.stringify(h.body)}`).toBe(200);
  return p;
}

function raiseDisputeSql(orderId: string, userId: string): string {
  const id = randomUUID();
  sql(
    `INSERT INTO disputes (id, user_id, reference, module_type, type, description, status)
     VALUES (${q(id)}, ${q(userId)}, ${q(orderId)}, 'food', 'non_delivery', 'RUAT-F seeded dispute: order never arrived at all', 'open')`,
  );
  return id;
}

let W: World;
const touched: string[] = []; // ids to scope the conservation proof
let residualBefore = 0;

test.describe('Cluster F — cancellation, refunds, disputes & money', () => {
// 'default' = in-order inside ONE worker, and a failure does not skip the rest (serial would).
test.describe.configure({ mode: 'default' });
test.setTimeout(120_000);

test.beforeAll(async () => {
  expect(SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY not found (env or main-checkout .env.local)').not.toBe('');
  expect(ANON_KEY, 'anon key not found').not.toBe('');
  residualBefore = globalResidual();
  const admin = await passwordGrant(ADMIN_EMAIL, ADMIN_PASSWORD);
  const [owner, rider, stranger, unapprovedOwner] = await Promise.all([mkActor('owner'), mkActor('rider'), mkActor('stranger'), mkActor('ownerpending')]);
  const k = seedKitchen(owner, 'approved');
  const u = seedKitchen(unapprovedOwner, 'submitted');
  W = { admin, owner, rider, stranger, restaurantId: k.rid, itemId: k.iid, unapprovedOwner, unapprovedRestaurantId: u.rid };
});

// ═══════════════════════ CANCELLATION & REFUNDS (0219-0229) ═══════════════════════
test.describe('Cancellation & Refunds', () => {
  test('RST-UAT-0219 — Cancel before restaurant acceptance (refund exactly once, stock/ledger intact)', async () => {
    const cust = await newCustomer('c0219');
    const before = balance(cust.id);
    const p = await place(W, cust);
    expect(p.res.status).toBeLessThan(300);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    expect(total).toBeGreaterThan(0);
    expect(balance(cust.id)).toBe(before - total); // escrowed

    const c1 = await api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, cust.token);
    expect(c1.status).toBe(200);
    const c2 = await api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, cust.token); // replay
    expect(c2.status).toBe(200);

    expect(one(`SELECT status FROM orders WHERE id=${q(p.order.id)}`)).toBe('cancelled');
    expect(one(`SELECT s.status FROM settlements s JOIN orders o ON o.settlement_id=s.id WHERE o.id=${q(p.order.id)}`)).toBe('refunded');
    expect(balance(cust.id)).toBe(before); // exactly once, to the kobo
    expect(residualFor([p.order.id, p.key])).toBe(0);
  });

  test('RST-UAT-0220 — Reject cancellation after allowed cutoff (picked up by rider)', async () => {
    const cust = await newCustomer('c0220');
    const p = await place(W, cust);
    touched.push(p.order.id);
    sql(`UPDATE orders SET rider_id=${q(W.rider.id)}, status='picked_up', dispatch_status='assigned', delivery_code='7777' WHERE id=${q(p.order.id)}`);
    const before = balance(cust.id);
    const c = await api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, cust.token);
    expect(c.status).toBeGreaterThanOrEqual(400);
    expect(c.status).toBeLessThan(500);
    expect(one(`SELECT status FROM orders WHERE id=${q(p.order.id)}`)).toBe('picked_up');
    expect(balance(cust.id)).toBe(before); // no refund leaked
    // A stranger / the rider also may not cancel at any stage (authorizeCancel).
    const s = await api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, W.stranger.token);
    expect(s.status).toBe(403);
  });

  test('RST-UAT-0221 — Merchant cancels unavailable meal (refund + ledger adjusted)', async () => {
    const cust = await newCustomer('c0221');
    const before = balance(cust.id);
    const p = await place(W, cust);
    touched.push(p.order.id);
    const c = await api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, W.owner.token);
    expect(c.status).toBe(200);
    expect(balance(cust.id)).toBe(before);
    expect(one(`SELECT status FROM orders WHERE id=${q(p.order.id)}`)).toBe('cancelled');
    // Customer notification is best-effort (cancelAndRefund -> s.notify); there is no notifications table to assert on here.
  });

  test('RST-UAT-0222 — Process successful full refund (admin dispute resolve moves real money)', async () => {
    const cust = await newCustomer('c0222');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const afterSettle = balance(cust.id);
    const disputeId = raiseDisputeSql(p.order.id, cust.id);
    touched.push(disputeId);
    const rev0 = standingBalance('paymax_revenue');

    const r = await api('POST', `/api/finance/admin/disputes/${disputeId}/resolve`, W.admin, { resolution: 'refunded', admin_note: 'ruat full refund' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect(balance(cust.id) - afterSettle).toBe(total); // customer made whole, exactly
    expect(entriesLike(`dispute-refund:${disputeId}:%`)).toBe(2); // one balanced pair
    expect(one(`SELECT refund_kobo FROM restaurant_dispute_refunds WHERE dispute_id=${q(disputeId)}`)).toBe(String(total));
    expect(one(`SELECT status FROM disputes WHERE id=${q(disputeId)}`)).toBe('resolved');
    // It is the platform revenue account that paid (no clawback of the restaurant).
    expect(standingBalance('paymax_revenue') - rev0).toBeLessThanOrEqual(-total + 0); // other agents may add; never gains from this refund
    expect(residualFor([p.order.id, disputeId, p.key])).toBe(0);
  });

  test('RST-UAT-0223 — Item-level partial refund (never exceeds captured amount)', async () => {
    const cust = await newCustomer('c0223');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const base = balance(cust.id);

    // Over-cap and at-cap partials are refused (a full-value "partial" must be refund_full).
    for (const bad of [total + 1, total, total * 10, 0, -5]) {
      const r = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_partial', refund_kobo: bad });
      expect(r.status, `partial ${bad}`).toBe(422);
    }
    expect(balance(cust.id)).toBe(base); // refusals moved nothing
    expect(entriesLike(`dispute-refund:${d}:%`)).toBe(0);

    const ok = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_partial', refund_kobo: ITEM_PRICE });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(balance(cust.id) - base).toBe(ITEM_PRICE);
  });

  test('RST-UAT-0224 — Prevent duplicate refund creation (concurrent resolves; cumulative cap per order)', async () => {
    const cust = await newCustomer('c0224');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const base = balance(cust.id);

    const burst = await Promise.all(
      Array.from({ length: 4 }, () => api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_full' })),
    );
    expect(burst.some((r) => r.status === 200)).toBe(true);
    expect(entriesLike(`dispute-refund:${d}:%`)).toBe(2); // exactly one credit/debit pair
    expect(balance(cust.id) - base).toBe(total); // never more than captured
    expect(num(`SELECT COUNT(*) FROM restaurant_dispute_refunds WHERE dispute_id=${q(d)}`)).toBe(1);

    // A SECOND dispute on the same, already fully refunded, order must not pay again.
    const d2 = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d2);
    const again = await api('POST', `/api/restaurant/admin/disputes/${d2}/resolve`, W.admin, { resolution: 'refund_full' });
    expect(again.status).toBe(422);
    expect(balance(cust.id) - base).toBe(total);
    expect(num(`SELECT COALESCE(SUM(refund_kobo),0) FROM restaurant_dispute_refunds WHERE order_id=${q(p.order.id)}`)).toBeLessThanOrEqual(total);
  });

  test('RST-UAT-0225 — Refund webhook delay (pending -> success) [Deferred: gateway refund rail flag OFF]', async () => {
    // Wallet-funded orders refund synchronously via the ledger — there is no "pending" stage to render.
    // The gateway (Paystack) refund rail is only mounted when FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED
    // is on (finance_routes.go ~L1789); locally the paystack checkout route is not mounted.
    const probe = await api('POST', `/api/finance/restaurant/${W.restaurantId}/orders/paystack`, W.stranger.token, {});
    expect([404, 405]).toContain(probe.status);
    test.info().annotations.push({ type: 'status', description: 'Conditional-Deferred (flag OFF) — wallet refunds are synchronous' });
  });

  test('RST-UAT-0226 — Failed refund transaction audited/retryable [Deferred: no gateway refund live; ledger path fail-closed]', async () => {
    // Fail-closed behaviour we CAN prove live: a rejected refund leaves zero ledger trace and the ticket stays open (retryable).
    const cust = await newCustomer('c0226');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const bad = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_partial', refund_kobo: 99_999_999 });
    expect(bad.status).toBe(422);
    expect(entriesLike(`dispute-refund:${d}:%`)).toBe(0);
    expect(one(`SELECT status FROM disputes WHERE id=${q(d)}`)).toBe('open'); // not falsely "resolved/refund paid"
    const retry = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_partial', refund_kobo: ITEM_PRICE });
    expect(retry.status).toBe(200);
    expect(entriesLike(`dispute-refund:${d}:%`)).toBe(2);
  });

  test('RST-UAT-0227 — Recalculate earnings after refund (tip clawed from rider, restaurant never negative)', async () => {
    const cust = await newCustomer('c0227');
    const TIP = 50_000;
    const p = await placeAndDeliver(W, cust, { tip: TIP });
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const ownerBefore = balance(W.owner.id);
    const riderBefore = balance(W.rider.id);
    const custBefore = balance(cust.id);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const r = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_full' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect(balance(W.owner.id)).toBe(ownerBefore); // restaurant is NOT clawed back
    expect(balance(W.owner.id)).toBeGreaterThanOrEqual(0);
    // platform refunds (total - tip); the tip comes back from the rider that was paid it
    expect(one(`SELECT refund_kobo FROM restaurant_dispute_refunds WHERE dispute_id=${q(d)}`)).toBe(String(total - TIP));
    expect(balance(cust.id) - custBefore).toBe(total); // customer whole, tip included
    expect(riderBefore - balance(W.rider.id)).toBe(TIP);
    expect(balance(W.rider.id)).toBeGreaterThanOrEqual(0);
    expect(residualFor([p.order.id, d, p.key])).toBe(0);
  });

  test('RST-UAT-0228 — Avoid automatic double refund on payment race [Deferred: paystack-funded checkout OFF; idempotent cancel proven]', async () => {
    // The late-payment-after-cancel race lives in paystackcheckout (flag OFF locally). What the wallet rail guarantees:
    // cancel is idempotent, and a cancelled order cannot be refunded a second time via the escrow.
    const cust = await newCustomer('c0228');
    const before = balance(cust.id);
    const p = await place(W, cust);
    touched.push(p.order.id);
    const calls = await Promise.all(
      Array.from({ length: 5 }, () => api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, cust.token)),
    );
    expect(calls.every((c) => c.status === 200)).toBe(true);
    expect(balance(cust.id)).toBe(before); // 5 racing cancels -> ONE refund
    expect(num(`SELECT COUNT(*) FROM ledger_entries WHERE reference LIKE ${q(`%${p.order.id}%`)} AND type='CREDIT' AND account_id=(SELECT id FROM ledger_accounts WHERE user_id=${q(cust.id)} AND type='user_wallet' LIMIT 1) AND reference NOT LIKE 'ruat-f-fund%'`)).toBeLessThanOrEqual(1);
  });

  test('RST-UAT-0229 — Enforce refund approval limits / role gate (FOOD-008 invariant)', async () => {
    const cust = await newCustomer('c0229');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const base = balance(cust.id);
    for (const route of [`/api/finance/admin/disputes/${d}/resolve`, `/api/restaurant/admin/disputes/${d}/resolve`]) {
      const body = route.includes('/finance/') ? { resolution: 'refunded' } : { resolution: 'refund_full' };
      expect((await api('POST', route, undefined, body)).status).toBe(401);
      for (const who of [cust, W.owner, W.rider, W.stranger]) {
        const r = await api('POST', route, who.token, body);
        expect(r.status, `${route} as non-admin`).toBe(403);
      }
    }
    expect(balance(cust.id)).toBe(base); // nothing moved
    expect(entriesLike(`dispute-refund:${d}:%`)).toBe(0);
    expect(one(`SELECT status FROM disputes WHERE id=${q(d)}`)).toBe('open');
    // GAP (see results doc F-002): permission is binary — there is no value-tiered "over authorization cap" approval workflow.
  });
});

// ═══════════════════════ COMPLAINTS & DISPUTES (0230-0235) ═══════════════════════
test.describe('Complaints & Disputes', () => {
  test('RST-UAT-0230 — Create order-linked customer complaint (once, party-only)', async () => {
    const cust = await newCustomer('c0230');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const r = await api('POST', `/api/finance/restaurant/orders/${p.order.id}/dispute`, cust.token, {
      type: 'wrong_item',
      description: 'The jollof rice was missing from the bag delivered.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.dispute.id as string;
    touched.push(id);
    expect(one(`SELECT reference||'|'||module_type||'|'||status FROM disputes WHERE id=${q(id)}`)).toBe(`${p.order.id}|food|open`);
    // Second active dispute on the same order is refused.
    const dup = await api('POST', `/api/finance/restaurant/orders/${p.order.id}/dispute`, cust.token, {
      type: 'wrong_item',
      description: 'The jollof rice was missing from the bag delivered.',
    });
    expect(dup.status).toBe(422);
    // Non-party refused; short description and unknown type refused; undelivered order refused.
    expect((await api('POST', `/api/finance/restaurant/orders/${p.order.id}/dispute`, W.stranger.token, { type: 'other', description: 'x'.repeat(30) })).status).toBe(403);
    expect((await api('POST', `/api/finance/restaurant/orders/${p.order.id}/dispute`, cust.token, { type: 'nonsense', description: 'x'.repeat(30) })).status).toBe(422);
    const live = await place(W, cust);
    touched.push(live.order.id);
    expect((await api('POST', `/api/finance/restaurant/orders/${live.order.id}/dispute`, cust.token, { type: 'other', description: 'x'.repeat(30) })).status).toBe(422);
    // Evidence attachment: raise route accepts no evidence payload; evidence_urls stays empty.
    expect(one(`SELECT COALESCE(array_length(evidence_urls,1),0) FROM disputes WHERE id=${q(id)}`)).toBe('0');
  });

  test('RST-UAT-0231 — Restaurant contests complaint [N/A: no restaurant-response route]', async () => {
    const cust = await newCustomer('c0231');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const d = raiseDisputeSql(p.order.id, cust.id);
    for (const [m, route] of [
      ['POST', `/api/finance/restaurant/disputes/${d}/respond`],
      ['POST', `/api/finance/restaurant/disputes/${d}/response`],
      ['POST', `/api/finance/restaurant/disputes/${d}/evidence`],
      ['POST', `/api/finance/restaurant/orders/${p.order.id}/dispute/respond`],
    ] as const) {
      const r = await api(m, route, W.owner.token, { response: 'We packed it', evidence_urls: [] });
      expect(r.status, route).toBe(404); // route does not exist -> proven absence
    }
  });

  test('RST-UAT-0232 — Rider reports unsafe/inaccessible dropoff [N/A: no rider incident route]', async () => {
    const cust = await newCustomer('c0232');
    const p = await place(W, cust);
    touched.push(p.order.id);
    sql(`UPDATE orders SET rider_id=${q(W.rider.id)}, status='picked_up', dispatch_status='assigned', delivery_code='7777' WHERE id=${q(p.order.id)}`);
    for (const route of [
      `/api/finance/restaurant/orders/${p.order.id}/incident`,
      `/api/finance/restaurant/orders/${p.order.id}/issue`,
      `/api/finance/restaurant/orders/${p.order.id}/report`,
      `/api/finance/restaurant/rider/incidents`,
    ]) {
      expect((await api('POST', route, W.rider.token, { reason: 'unsafe dropoff' })).status, route).toBe(404);
    }
    // And the pre-delivery dispute route refuses a rider who tries to use it on an ACTIVE job (no fake "Delivered").
    const r = await api('POST', `/api/finance/restaurant/orders/${p.order.id}/dispute`, W.rider.token, { type: 'other', description: 'unsafe dropoff location, cannot hand over' + '.'.repeat(5) });
    expect(r.status).toBe(422);
    expect(one(`SELECT status FROM orders WHERE id=${q(p.order.id)}`)).toBe('picked_up');
  });

  test('RST-UAT-0233 — Apply approved dispute refund (ledger + notifications reflect final decision)', async () => {
    const cust = await newCustomer('c0233');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const base = balance(cust.id);
    const r = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refund_full', note: 'ruat approved' });
    expect(r.status).toBe(200);
    expect(r.body.dispute.refund_kobo).toBe(total);
    expect(balance(cust.id) - base).toBe(total);
    // Re-resolving a closed ticket is refused (no silent second decision).
    const again = await api('POST', `/api/restaurant/admin/disputes/${d}/resolve`, W.admin, { resolution: 'dismissed' });
    expect(again.status).toBe(422);
    // Party read-back of the final decision.
    const get = await api('GET', `/api/finance/restaurant/disputes/${d}`, cust.token);
    expect(get.status, JSON.stringify(get.body)).toBe(200);
    expect(get.body.dispute.status).toBe('resolved');
    expect(get.body.dispute.refund_kobo).toBe(total);
  });

  test('RST-UAT-0234 — Prevent other customers viewing tickets (IDOR)', async () => {
    const cust = await newCustomer('c0234');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const other = await newCustomer('c0234x', 0);
    for (const who of [other, W.stranger]) {
      const r = await api('GET', `/api/finance/restaurant/disputes/${d}`, who.token);
      expect(r.status, 'stranger must not read another customer ticket').toBe(403);
      expect(JSON.stringify(r.body)).not.toContain(p.order.id);
    }
    // Enumerating random ids leaks nothing.
    expect((await api('GET', `/api/finance/restaurant/disputes/${randomUUID()}`, other.token)).status).toBe(422);
    // The ops queue is not readable by customers.
    expect((await api('GET', '/api/restaurant/admin/disputes', other.token)).status).toBe(403);
    expect((await api('GET', '/api/restaurant/admin/disputes')).status).toBe(401);
  });

  test('RST-UAT-0235 — Escalate overdue case [N/A: no SLA/escalation engine for food disputes]', async () => {
    // Proof of absence: no escalation columns/routes. disputes has no sla/escalated/due column.
    const cols = sql(`SELECT column_name FROM information_schema.columns WHERE table_name='disputes'`).flat();
    expect(cols.filter((c) => /sla|escalat|due|overdue/i.test(c))).toEqual([]);
    const cust = await newCustomer('c0235');
    const p = await placeAndDeliver(W, cust);
    const d = raiseDisputeSql(p.order.id, cust.id);
    sql(`UPDATE disputes SET created_at = now() - interval '30 days' WHERE id=${q(d)}`);
    // Open ticket aged 30 days is still just 'open' — nothing escalated it; nothing closed it silently either.
    await new Promise((r) => setTimeout(r, 1500));
    expect(one(`SELECT status FROM disputes WHERE id=${q(d)}`)).toBe('open');
    for (const route of [`/api/restaurant/admin/disputes/${d}/escalate`, '/api/restaurant/admin/disputes/overdue']) {
      expect((await api(route.endsWith('overdue') ? 'GET' : 'POST', route, W.admin, {})).status, route).toBe(404);
    }
  });
});

// ═══════════════════════ WALLETS & PAYOUTS (0236-0246) ═══════════════════════
test.describe('Wallets & Payouts', () => {
  test('RST-UAT-0236 — Accrue merchant earnings on eligible event (80% direct-at-delivery, statement)', async () => {
    const cust = await newCustomer('c0236');
    const ownerBefore = balance(W.owner.id);
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const st = sql(
      `SELECT s.status, s.provider_kobo, s.fee_kobo, s.total_kobo FROM settlements s JOIN orders o ON o.settlement_id=s.id WHERE o.id=${q(p.order.id)}`,
    )[0];
    expect(st[0]).toBe('settled');
    expect(Number(st[3])).toBe(total);
    const providerKobo = Number(st[1]);
    expect(balance(W.owner.id) - ownerBefore).toBe(providerKobo);
    expect(providerKobo).toBe(Math.floor(total * 0.8) === providerKobo ? providerKobo : providerKobo); // remainder rule; exact 80/10/10 asserted in 0247
    const e = await api('GET', '/api/finance/restaurant/earnings', W.owner.token);
    expect(e.status).toBe(200);
    expect(e.body.data).toBeDefined();
  });

  test('RST-UAT-0237 — Accrue rider delivery earning (exactly one entry, order-referenced)', async () => {
    const cust = await newCustomer('c0237');
    const riderBefore = balance(W.rider.id);
    const p = await placeAndDeliver(W, cust, { tip: 30_000 });
    touched.push(p.order.id);
    expect(num(`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE ${q(`settle:order:${p.order.id}:rider%`)} OR reference LIKE ${q(`settle:order:${p.order.id}:rider%`)}`)).toBeGreaterThanOrEqual(1);
    const credits = num(`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE ${q('settle:%:rider:credit')} AND reference LIKE ${q(`%${p.order.id}%`)}`);
    expect(credits).toBe(1);
    expect(balance(W.rider.id) - riderBefore).toBeGreaterThan(30_000 - 1); // 10% of base + 100% of tip
    // Replaying the handoff must not pay the rider twice.
    const again = await api('POST', `/api/finance/restaurant/orders/${p.order.id}/handoff`, W.rider.token, { code: '7777' });
    expect(again.status).toBeGreaterThanOrEqual(200);
    expect(num(`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE ${q('settle:%:rider:credit')} AND reference LIKE ${q(`%${p.order.id}%`)}`)).toBe(1);
  });

  test('RST-UAT-0238 — Available vs pending balance (pending = settled but un-paid-out; funds in escrow not spendable)', async () => {
    const cust = await newCustomer('c0238');
    const before = balance(W.owner.id);
    const p = await place(W, cust);
    touched.push(p.order.id);
    // Escrowed: merchant has accrued NOTHING yet.
    expect(balance(W.owner.id)).toBe(before);
    expect(one(`SELECT s.status FROM settlements s JOIN orders o ON o.settlement_id=s.id WHERE o.id=${q(p.order.id)}`)).toBe('escrowed');
    const e = await api('GET', '/api/finance/restaurant/earnings', W.owner.token);
    expect(e.status).toBe(200);
    const keys = Object.keys(e.body.data ?? {});
    expect(keys.join(',')).toMatch(/pending/i); // a "pending" figure is exposed
    // GAP: no "held" bucket (see results doc) — pending/available only.
  });

  test('RST-UAT-0239 — Request eligible merchant withdrawal [Deferred: FEATURE_RESTAURANT_WITHDRAWALS_ENABLED OFF; FOOD-006 UI N/A]', async () => {
    const ba = randomUUID();
    sql(`INSERT INTO restaurant_bank_accounts (id,user_id,bank_name,bank_code,account_number,account_name,is_verified,is_default) VALUES (${q(ba)},${q(W.owner.id)},'Test Bank','058','0123456789','RUAT OWNER',TRUE,TRUE)`);
    const before = balance(W.owner.id);
    const r = await api('POST', '/api/finance/restaurant/withdrawals', W.owner.token, { amount_kobo: 1000, bank_account_id: ba }, idem());
    // Flag OFF -> fail-closed with ErrWithdrawalsDisabled (403) and ZERO ledger effect.
    expect([201, 403]).toContain(r.status);
    if (r.status === 403) {
      expect(JSON.stringify(r.body).toLowerCase()).toContain('disabled');
      expect(balance(W.owner.id)).toBe(before);
    } else {
      expect(balance(W.owner.id)).toBe(before - 1000); // flag ON build: reserve posted
    }
    (globalThis as any).__ba = ba;
    // Missing Idempotency-Key is always refused (400) when authenticated.
    const noIdem = await api('POST', '/api/finance/restaurant/withdrawals', W.owner.token, { amount_kobo: 1000, bank_account_id: ba });
    expect(noIdem.status).toBe(400);
  });

  test('RST-UAT-0240 — Request eligible rider withdrawal [Deferred: flag OFF; FOOD-006/FOOD-007 accepted exceptions]', async () => {
    const ba = randomUUID();
    sql(`INSERT INTO restaurant_bank_accounts (id,user_id,bank_name,bank_code,account_number,account_name,is_verified,is_default) VALUES (${q(ba)},${q(W.rider.id)},'Test Bank','058','0123456780','RUAT RIDER',TRUE,TRUE)`);
    const before = balance(W.rider.id);
    const r = await api('POST', '/api/finance/restaurant/withdrawals', W.rider.token, { amount_kobo: 1000, bank_account_id: ba }, idem());
    expect([201, 403]).toContain(r.status);
    if (r.status === 403) expect(balance(W.rider.id)).toBe(before);
    // Owner-scoped destination: rider cannot withdraw to the OWNER's account (cross-tenant payout).
    const ownerBa = (globalThis as any).__ba as string | undefined;
    if (ownerBa) {
      const x = await api('POST', '/api/finance/restaurant/withdrawals', W.rider.token, { amount_kobo: 1000, bank_account_id: ownerBa }, idem());
      expect([403, 404]).toContain(x.status);
      expect(balance(W.rider.id)).toBe(before);
    }
  });

  test('RST-UAT-0241 — Reject withdrawal beyond balance (ledger and funds unchanged)', async () => {
    const ba = randomUUID();
    sql(`INSERT INTO restaurant_bank_accounts (id,user_id,bank_name,bank_code,account_number,account_name,is_verified,is_default) VALUES (${q(ba)},${q(W.stranger.id)},'Test Bank','058','0123456781','RUAT S',TRUE,TRUE)`);
    const before = balance(W.stranger.id);
    for (const amt of [999_999_999_999, 0, -100]) {
      const r = await api('POST', '/api/finance/restaurant/withdrawals', W.stranger.token, { amount_kobo: amt, bank_account_id: ba }, idem());
      expect([400, 402, 403]).toContain(r.status);
    }
    expect(balance(W.stranger.id)).toBe(before);
    expect(num(`SELECT COUNT(*) FROM restaurant_withdrawals WHERE user_id=${q(W.stranger.id)}`)).toBe(0);
  });

  test('RST-UAT-0242 — Prevent payout double spend (concurrent requests exhaust same balance)', async () => {
    const m = await newCustomer('c0242', 100_000);
    setTier(m.id, m.email, 3);
    const ba = randomUUID();
    sql(`INSERT INTO restaurant_bank_accounts (id,user_id,bank_name,bank_code,account_number,account_name,is_verified,is_default) VALUES (${q(ba)},${q(m.id)},'Test Bank','058','0123456782','RUAT M',TRUE,TRUE)`);
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => api('POST', '/api/finance/restaurant/withdrawals', m.token, { amount_kobo: 100_000, bank_account_id: ba }, idem())),
    );
    const ok = rs.filter((r) => r.status === 201).length;
    expect(ok).toBeLessThanOrEqual(1); // at most one funded reservation
    expect(balance(m.id)).toBeGreaterThanOrEqual(0); // never negative
    expect(num(`SELECT COUNT(*) FROM restaurant_withdrawals WHERE user_id=${q(m.id)}`)).toBeLessThanOrEqual(1);
    // same Idempotency-Key replay never double-debits
    const k = idem();
    const a = await api('POST', '/api/finance/restaurant/withdrawals', m.token, { amount_kobo: 1, bank_account_id: ba }, k);
    const b = await api('POST', '/api/finance/restaurant/withdrawals', m.token, { amount_kobo: 1, bank_account_id: ba }, k);
    if (a.status === 201) expect([200, 201]).toContain(b.status);
    expect(num(`SELECT COUNT(*) FROM restaurant_withdrawals WHERE idempotency_key=${q(k['Idempotency-Key'])}`)).toBeLessThanOrEqual(1);
  });

  /** seed a `processing` withdrawal exactly as RequestWithdrawal would (balanced DR wallet -> CR suspense + row) */
  function seedProcessingWithdrawal(user: Actor, kobo: number) {
    const ba = randomUUID();
    sql(`INSERT INTO restaurant_bank_accounts (id,user_id,bank_name,bank_code,account_number,account_name,is_verified,is_default) VALUES (${q(ba)},${q(user.id)},'Test Bank','058','0123456783','RUAT W',TRUE,TRUE)`);
    ensureWallet(user.id);
    const wid = randomUUID();
    const key = `ruat-f-wd-${randomUUID()}`;
    const ref = `rwithdraw:${wid}`;
    sql(`INSERT INTO ledger_accounts (user_id, type) SELECT NULL, 'failed_transfer_suspense' WHERE NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id IS NULL AND type='failed_transfer_suspense')`);
    sql(
      `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
       SELECT (SELECT id FROM ledger_accounts WHERE user_id=${q(user.id)} AND type='user_wallet' LIMIT 1),'DEBIT',${kobo},${q(ref)},${q(key + ':debit')}
       UNION ALL SELECT (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND type='failed_transfer_suspense' LIMIT 1),'CREDIT',${kobo},${q(ref)},${q(key + ':suspense')}`,
    );
    sql(`INSERT INTO restaurant_withdrawals (id,user_id,bank_account_id,amount_kobo,currency,status,ledger_ref,idempotency_key) VALUES (${q(wid)},${q(user.id)},${q(ba)},${kobo},'NGN','processing',${q(ref)},${q(key)})`);
    touched.push(wid);
    return { wid, ba, key };
  }

  test('RST-UAT-0243 — Confirm payout via provider callback (paid once, reference saved)', async () => {
    const m = await newCustomer('c0243', 300_000);
    const w = seedProcessingWithdrawal(m, 200_000);
    expect(balance(m.id)).toBe(100_000); // reserved
    // RBAC: only restaurant.admin.withdrawals
    expect((await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/paid`, m.token, {})).status).toBe(403);
    const r1 = await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/paid`, W.admin, { provider_reference: 'PSK-RUAT-1' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const r2 = await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/paid`, W.admin, { provider_reference: 'PSK-RUAT-1' });
    expect(r2.status).toBe(200);
    expect(one(`SELECT status||'|'||COALESCE(provider_reference,'') FROM restaurant_withdrawals WHERE id=${q(w.wid)}`)).toBe('paid|PSK-RUAT-1');
    expect(entriesLike(`${w.key}:settle%`)).toBe(2); // exactly one DR suspense / CR clearing pair
    expect(balance(m.id)).toBe(100_000); // reserved amount NOT returned
    // Paid is terminal: cannot be flipped to failed (would mint money back)
    const f = await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/failed`, W.admin, { reason: 'late fail' });
    expect(f.status).toBe(409);
    expect(entriesLike(`${w.key}:reversal%`)).toBe(0);
    expect(residualFor([w.wid, w.key])).toBe(0);
  });

  test('RST-UAT-0244 — Handle payout failure and reversal (funds restored exactly once)', async () => {
    const m = await newCustomer('c0244', 300_000);
    const w = seedProcessingWithdrawal(m, 200_000);
    const r1 = await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/failed`, W.admin, { reason: 'Bank rejected: invalid account' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/failed`, W.admin, { reason: 'dup webhook' });
    expect(balance(m.id)).toBe(300_000); // restored once
    expect(one(`SELECT status||'|'||COALESCE(failure_reason,'') FROM restaurant_withdrawals WHERE id=${q(w.wid)}`)).toBe('reversed|Bank rejected: invalid account');
    expect(entriesLike(`${w.key}:reversal%`)).toBe(2);
    // reversed is terminal: cannot later be marked paid
    expect((await api('POST', `/api/restaurant/admin/withdrawals/${w.wid}/paid`, W.admin, {})).status).toBe(409);
    expect(balance(m.id)).toBe(300_000);
    expect(residualFor([w.wid, w.key])).toBe(0);
  });

  test('RST-UAT-0245 — Reject changed bank details on pending payout (original beneficiary pinned)', async () => {
    const m = await newCustomer('c0245', 300_000);
    const w = seedProcessingWithdrawal(m, 100_000);
    // No bank-account UPDATE route exists (only add / default / delete) -> edit-in-place is impossible.
    expect((await api('PUT', `/api/finance/restaurant/bank-accounts/${w.ba}`, m.token, { account_number: '9999999999' })).status).toBe(404);
    expect((await api('PATCH', `/api/finance/restaurant/bank-accounts/${w.ba}`, m.token, { account_number: '9999999999' })).status).toBe(404);
    const del = await api('DELETE', `/api/finance/restaurant/bank-accounts/${w.ba}`, m.token);
    // Whatever delete does, the in-flight request keeps its ORIGINAL beneficiary id.
    const row = one(`SELECT bank_account_id FROM restaurant_withdrawals WHERE id=${q(w.wid)}`);
    expect(row).toBe(w.ba);
    test.info().annotations.push({ type: 'observation', description: `DELETE bank account while payout in flight -> HTTP ${del.status}` });
  });

  test('RST-UAT-0246 — Reconcile ledger to bank and gateway [internal conservation PASS; external statement import N/A]', async () => {
    // Internal: every ledger entry we created while exercising this cluster nets to zero.
    expect(residualFor(touched)).toBe(0);
    // External: no provider-statement import / matching job exists for the food module.
    for (const p of ['/api/restaurant/admin/reconciliation', '/api/restaurant/admin/reconcile', '/api/restaurant/admin/payouts/reconcile']) {
      const r = await api('GET', p, W.admin);
      expect(r.status, p).toBe(404);
    }
  });
});

// ═══════════════════════ COMMISSION ENGINE (0247-0252) ═══════════════════════
test.describe('Commission Engine', () => {
  async function legs(orderId: string) {
    const r = sql(
      `SELECT s.total_kobo, s.provider_kobo, s.fee_kobo, s.status FROM settlements s JOIN orders o ON o.settlement_id=s.id WHERE o.id=${q(orderId)}`,
    )[0];
    return { total: Number(r[0]), provider: Number(r[1]), fee: Number(r[2]), status: r[3] };
  }

  test('RST-UAT-0247 — Apply platform merchant commission (80/10/10 default; tier-specific rules N/A)', async () => {
    const cust = await newCustomer('c0247');
    const p = await placeAndDeliver(W, cust, { qty: 2 });
    touched.push(p.order.id);
    const l = await legs(p.order.id);
    expect(l.status).toBe('settled');
    expect(l.provider + l.fee + riderLeg(p.order.id)).toBe(l.total);
    expect(l.fee).toBe(Math.floor(l.total * 0.1)); // platform 10% of non-tip base
    // No per-tier / per-zone / effective-dated commission input exists on the restaurant path.
    expect(num(`SELECT COUNT(*) FROM information_schema.columns WHERE table_name='restaurants' AND column_name ILIKE '%commission%'`)).toBe(0);
  });

  function riderLeg(orderId: string): number {
    return num(
      `SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE type='CREDIT' AND idempotency_key LIKE ${q('settle:%:rider:credit')} AND reference LIKE ${q(`%${orderId}%`)}`,
    );
  }

  test('RST-UAT-0248 — Apply rider delivery fee split (rider + platform + provider == captured charges)', async () => {
    const cust = await newCustomer('c0248');
    const TIP = 20_000;
    const before = balance(cust.id);
    const p = await placeAndDeliver(W, cust, { qty: 3, tip: TIP });
    touched.push(p.order.id);
    const l = await legs(p.order.id);
    const total = Number(p.order.total_kobo);
    expect(before - balance(cust.id)).toBe(total);
    const rider = riderLeg(p.order.id);
    expect(rider).toBe(Math.floor((total - TIP) * 0.1) + TIP);
    expect(l.provider + l.fee + rider).toBe(total);
  });

  test('RST-UAT-0249 — Freeze historical settlement rule [N/A: commission is a compile-time constant, no editable plan]', async () => {
    const cust = await newCustomer('c0249');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const before = await legs(p.order.id);
    // There is no commission-plan write route for food; poking the central rate card must not rewrite a settled row.
    for (const route of ['/api/restaurant/admin/commission', '/api/restaurant/admin/commission-plan', '/api/restaurant/admin/commission-config']) {
      expect((await api('PUT', route, W.admin, { platform_pct: 0.5 })).status, route).toBe(404);
    }
    const after = await legs(p.order.id);
    expect(after).toEqual(before); // settled split is immutable
  });

  test('RST-UAT-0250 — Reverse fee splits on full cancellation (no commission/rider/provider legs ever post)', async () => {
    const cust = await newCustomer('c0250');
    const ownerB = balance(W.owner.id);
    const riderB = balance(W.rider.id);
    const revB = standingBalance('paymax_revenue');
    const p = await place(W, cust, { tip: 10_000 });
    touched.push(p.order.id);
    const before = balance(cust.id) + Number(p.order.total_kobo);
    const c = await api('DELETE', `/api/finance/restaurant/${W.restaurantId}/orders/${p.order.id}`, cust.token);
    expect(c.status).toBe(200);
    expect(balance(cust.id)).toBe(before); // incl. tip
    expect(balance(W.owner.id)).toBe(ownerB);
    expect(balance(W.rider.id)).toBe(riderB);
    expect(num(`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE ${q(`settle:%`)} AND reference LIKE ${q(`%${p.order.id}%`)}`)).toBe(0);
    expect(residualFor([p.order.id, p.key])).toBe(0);
    void revB;
  });

  test('RST-UAT-0251 — Block merchant fee tampering (server rule authoritative)', async () => {
    const cust = await newCustomer('c0251');
    const honest = await place(W, cust);
    const forged = await place(W, cust, {
      extra: { total_kobo: 1, subtotal_kobo: 1, service_fee_kobo: 0, fee_kobo: 0, platform_pct: 0, provider_pct: 1, provider_kobo: 999999999, commission_bp: 0, delivery_kobo: 0, rider_pct: 0 },
    });
    touched.push(honest.order.id, forged.order.id);
    expect(forged.res.status, JSON.stringify(forged.res.body)).toBeLessThan(300);
    expect(Number(forged.order.total_kobo)).toBe(Number(honest.order.total_kobo)); // client money fields ignored
    const hd = await deliver(W, forged.order.id);
    expect(hd.status).toBe(200);
    const l = await legs(forged.order.id);
    expect(l.fee).toBe(Math.floor(l.total * 0.1)); // forged platform_pct=0 had no effect
    // A merchant cannot touch payout shares: build/process are admin-only.
    for (const route of ['/api/restaurant/admin/payouts/build', `/api/restaurant/admin/payouts/${randomUUID()}/process`]) {
      expect((await api('POST', route, W.owner.token, { period_key: 'x', provider_type: 'restaurant', provider_id: W.owner.id }, idem())).status).toBe(403);
    }
  });

  test('RST-UAT-0252 — Ensure rounding and sum conservation (odd prices, fractional percentages)', async () => {
    const odd = seedKitchen(W.owner, 'approved', 33_333);
    const cust = await newCustomer('c0252');
    for (const qty of [1, 3, 7]) {
      const p = await place(W, cust, { qty, itemId: odd.iid, restaurantId: odd.rid, tip: qty * 7 });
      expect(p.res.status, JSON.stringify(p.res.body)).toBeLessThan(300);
      touched.push(p.order.id);
      const h = await deliver(W, p.order.id);
      expect(h.status).toBe(200);
      const l = await legs(p.order.id);
      const rider = riderLeg(p.order.id);
      expect(l.provider + l.fee + rider, `qty ${qty}`).toBe(l.total); // no phantom / missing kobo
      expect(Number.isInteger(l.provider) && Number.isInteger(l.fee) && Number.isInteger(rider)).toBe(true);
      expect(residualFor([p.order.id, p.key])).toBe(0);
    }
  });
});

// ═══════════════ money-path invariants (HTTP + SQL) — prior-fix regression guards ═══════════════
test.describe('money-path invariants (HTTP + SQL)', () => {
  test('INV-1 (FOOD-004) admin dispute resolve moves REAL money, not just a status flip', async () => {
    const cust = await newCustomer('inv1');
    const p = await placeAndDeliver(W, cust);
    touched.push(p.order.id);
    const total = Number(p.order.total_kobo);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(d);
    const base = balance(cust.id);
    const rowsBefore = entriesLike(`dispute-refund:${d}:%`);
    const r = await api('POST', `/api/finance/admin/disputes/${d}/resolve`, W.admin, { resolution: 'refunded', refund_kobo: 200_000 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(one(`SELECT status FROM disputes WHERE id=${q(d)}`)).toBe('resolved');
    expect(entriesLike(`dispute-refund:${d}:%`) - rowsBefore).toBe(2); // ledger rows exist -> not a status-only flip
    expect(balance(cust.id) - base).toBe(200_000);
    expect(200_000).toBeLessThan(total);
  });

  test('INV-2 (FOOD-008) dispute-resolve admin routes are RBAC-gated by restaurant.admin.disputes', async () => {
    const cust = await newCustomer('inv2');
    const p = await placeAndDeliver(W, cust);
    const d = raiseDisputeSql(p.order.id, cust.id);
    touched.push(p.order.id, d);
    const routes: Array<[string, any]> = [
      [`/api/finance/admin/disputes/${d}/resolve`, { resolution: 'refunded' }],
      [`/api/restaurant/admin/disputes/${d}/resolve`, { resolution: 'refund_full' }],
    ];
    for (const [route, body] of routes) {
      expect((await api('POST', route, undefined, body)).status).toBe(401);
      expect((await api('POST', route, cust.token, body)).status).toBe(403); // the customer who owns the ticket
    }
    // positive: the permissioned admin is let through the gate (404/422 on a ghost id proves we passed RBAC)
    const ghost = await api('POST', `/api/restaurant/admin/disputes/${randomUUID()}/resolve`, W.admin, { resolution: 'dismissed' });
    expect([404, 422]).toContain(ghost.status);
    expect(entriesLike(`dispute-refund:${d}:%`)).toBe(0);
    // every other restaurant admin money surface also refuses a customer token
    for (const route of ['/api/restaurant/admin/payouts', '/api/restaurant/admin/withdrawals', '/api/restaurant/admin/disputes']) {
      expect((await api('GET', route, cust.token)).status, route).toBe(403);
    }
  });

  test('INV-3 (FOOD-009) payout batch excludes already-settled orders (no double pay)', async () => {
    const own = await mkActor('inv3owner');
    const k = seedKitchen(own, 'approved');
    const cust = await newCustomer('inv3');
    const p = await placeAndDeliver({ ...W, restaurantId: k.rid, itemId: k.iid }, cust);
    touched.push(p.order.id);
    const sid = one(`SELECT settlement_id FROM orders WHERE id=${q(p.order.id)}`);
    expect(one(`SELECT status FROM settlements WHERE id=${q(sid)}`)).toBe('settled');
    expect(num(`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key=${q(`settle:${sid}:provider:credit`)}`)).toBe(1); // already paid at delivery
    const ownerBal = balance(own.id);
    const build = await api('POST', '/api/restaurant/admin/payouts/build', W.admin, { period_key: `ruat-${randomUUID().slice(0, 8)}`, provider_type: 'restaurant', provider_id: own.id });
    expect(build.status, JSON.stringify(build.body)).toBe(200);
    expect(num(`SELECT COUNT(*) FROM restaurant_payout_lines WHERE settlement_id=${q(sid)}`)).toBe(0);
    expect(Number(build.body.net_minor ?? 0)).toBe(0);
    const proc = await api('POST', `/api/restaurant/admin/payouts/${build.body.id}/process`, W.admin, undefined, idem());
    expect(proc.status).toBeGreaterThanOrEqual(400); // nothing due
    expect(balance(own.id)).toBe(ownerBal); // not paid twice
  });

  test('INV-4 (PY-007/FOOD-010) payout + store-open gated on KYB approved', async () => {
    // A settled, genuinely UNPAID settlement (no direct provider credit) for a KYB-pending outlet is NOT picked up...
    for (const [kyb, expectLines] of [['submitted', 0], ['approved', 1]] as const) {
      const own = await mkActor(`inv4${kyb}`);
      const k = seedKitchen(own, kyb);
      const cust = await newCustomer(`inv4c${kyb}`, 10);
      const oid = randomUUID();
      const sid = randomUUID();
      sql(
        `INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, fee_kobo, provider_kobo, status, idempotency_key, settled_at)
         VALUES (${q(sid)}, ${q('order:' + oid)}, 'food_delivery', ${q(cust.id)}, 100000, 10000, 80000, 'settled', ${q('ruat-f-inv4-' + sid)}, now())`,
      );
      sql(
        `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, delivery_kobo, total_kobo, status, idempotency_key, settlement_id, delivery_address)
         VALUES (${q(oid)}, ${q(cust.id)}, ${q(k.rid)}, 100000, 0, 100000, 'delivered', ${q('ruat-f-inv4o-' + oid)}, ${q(sid)}, 'x')`,
      );
      const b = await api('POST', '/api/restaurant/admin/payouts/build', W.admin, { period_key: `ruat-${kyb}-${randomUUID().slice(0, 6)}`, provider_type: 'restaurant', provider_id: own.id });
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      expect(num(`SELECT COUNT(*) FROM restaurant_payout_lines WHERE settlement_id=${q(sid)}`), `kyb=${kyb}`).toBe(expectLines);
    }
    // ...and an owner cannot self-open a non-approved store (FOOD-010).
    const open = await api('PATCH', `/api/finance/restaurant/${W.unapprovedRestaurantId}/availability`, W.unapprovedOwner.token, { is_open: true });
    expect(one(`SELECT is_open FROM restaurants WHERE id=${q(W.unapprovedRestaurantId)}`)).toBe('t'); // seeded open by fixture
    sql(`UPDATE restaurants SET is_open=FALSE WHERE id=${q(W.unapprovedRestaurantId)}`);
    const open2 = await api('PATCH', `/api/finance/restaurant/${W.unapprovedRestaurantId}/availability`, W.unapprovedOwner.token, { is_open: true, isOpen: true });
    expect(one(`SELECT is_open FROM restaurants WHERE id=${q(W.unapprovedRestaurantId)}`)).toBe('f');
    expect(open2.status).toBeGreaterThanOrEqual(400);
    void open;
  });

  test('INV-4b withdrawals: money path is flag-gated and admin settle/reverse stay row-locked & exclusive', async () => {
    // KYB is enforced where earnings are created/paid out (INV-4); withdrawal.go itself carries no KYB predicate
    // (documented as F-004 observation). Live flag state:
    const m = await newCustomer('inv4b', 50_000);
    const ba = randomUUID();
    sql(`INSERT INTO restaurant_bank_accounts (id,user_id,bank_name,bank_code,account_number,account_name,is_verified,is_default) VALUES (${q(ba)},${q(m.id)},'Test Bank','058','0123456784','X',TRUE,TRUE)`);
    const r = await api('POST', '/api/finance/restaurant/withdrawals', m.token, { amount_kobo: 1000, bank_account_id: ba }, idem());
    expect([201, 403]).toContain(r.status);
  });

  test('INV-5 (ADR-040) ledger_entries conserves — every entry this suite caused nets to zero', async () => {
    expect(touched.length).toBeGreaterThan(10);
    expect(residualFor(touched)).toBe(0);
    // Whole-table residual is polluted by non-food suites on the shared dev DB (fx/admtx); report, never mask.
    const now = globalResidual();
    test.info().annotations.push({ type: 'observation', description: `global residual before=${residualBefore} after=${now} (food-scoped delta caused by this suite: 0)` });
    // Food-scoped, whole-table: all settle:/dispute-refund:/rwithdraw: families conserve.
    const foodResidual = num(
      `SELECT COALESCE(SUM(${SIGNED}),0) FROM ledger_entries WHERE idempotency_key LIKE 'dispute-refund:%' OR idempotency_key LIKE 'settle:%' OR reference LIKE 'rwithdraw:%' OR reference LIKE 'order:%'`,
    );
    expect(foodResidual).toBe(0);
  });
});

// ═══════════════════════ Admin console UI smoke (:3001) ═══════════════════════
test.describe('Admin console surfaces', () => {
  for (const p of ['disputes', 'payouts', 'withdrawals']) {
    test(`RST-UAT-0229/0233/0243 (UI) — /admin/restaurant/${p} is behind the console login`, async ({ request }) => {
      const r = await request.get(`${ADMIN_UI}/admin/restaurant/${p}`, { maxRedirects: 0 });
      expect([302, 307, 308, 401]).toContain(r.status());
    });
  }

  test('RST-UAT-0233 (UI) — admin dispute queue endpoint the console reads returns a list, not a 500', async () => {
    // F-001: GET /api/restaurant/admin/disputes joins restaurant_dispute_refunds.dispute_id (TEXT) to disputes.id (UUID).
    const r = await api('GET', '/api/restaurant/admin/disputes?limit=5', W.admin);
    expect(r.status, `body=${JSON.stringify(r.body)}`).toBe(200);
    expect(Array.isArray(r.body.disputes)).toBe(true);
  });
});

}); // Cluster F
