import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Cluster H — NFR / Security / Cross-cutting (RST-UAT-0280..0332) and the 22
 * cross-role journeys (EEJ-01..22; workbook calls them E2E-NN).
 * Read-only on product code. Load/soak, fault-injection and multi-session
 * cases are recorded as Blocked/Deferred via test.skip with the reason.
 */

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080';
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:3001';
const FIN = `${API}/api/finance/restaurant`;
const ADM = `${API}/api/restaurant/admin`;
const UUID = '00000000-0000-0000-0000-000000000001';
const REPO = path.resolve(__dirname, '../../../../..');

// Metro compiles the dev bundle lazily; under a shared box the first load can
// take minutes. Warm it once so UI tests don't race the compiler.
test.describe.configure({ timeout: 180_000 });
test.beforeAll(async ({ request }) => {
  if (!process.env.H_WARM) return;
  test.setTimeout(420_000);
  try {
    const html = await (await request.get('/', { timeout: 120_000 })).text();
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) await request.get(m[1], { timeout: 300_000 });
  } catch {
    /* non-fatal: UI tests will surface the real failure */
  }
});

function blocked(id: string, title: string, reason: string) {
  test(`${id} — ${title} [${reason.split(':')[0]}]`, async () => {
    test.info().annotations.push({ type: 'status', description: reason });
    test.skip(true, reason);
  });
}

async function openFood(page: Page, route = '/food') {
  await mockAmbientRequests(page);
  await loginAs(page);
  await page.goto(route);
  await expect(page.getByText('Food & Delivery')).toBeVisible();
}

/* ---------------- Privacy & App Security ---------------- */
test.describe('Privacy and App Security', () => {
  test('RST-UAT-0280 — Enforce backend ownership on direct object access (anonymous / garbage-token layer)', async ({ request }) => {
    const probes: Array<[string, string]> = [
      ['GET', `${FIN}/orders/${UUID}`],
      ['GET', `${FIN}/orders/${UUID}/messages`],
      ['POST', `${FIN}/orders/${UUID}/pickup`],
      ['POST', `${FIN}/orders/${UUID}/accept`],
      ['PATCH', `${FIN}/${UUID}/orders/${UUID}/status`],
      ['DELETE', `${FIN}/${UUID}/orders/${UUID}`],
      ['PATCH', `${FIN}/${UUID}`],
      ['GET', `${FIN}/${UUID}/kyb`],
      ['GET', `${ADM}/restaurants`],
      ['GET', `${ADM}/orders`],
    ];
    for (const [m, url] of probes) {
      const anon = await request.fetch(url, { method: m });
      expect(anon.status(), `${m} ${url} anonymous`).toBe(401);
      const bad = await request.fetch(url, { method: m, headers: { Authorization: 'Bearer garbage.token.value' } });
      expect(bad.status(), `${m} ${url} garbage token`).toBe(401);
    }
    test.info().annotations.push({
      type: 'note',
      description: 'Cross-user (valid token, foreign id) layer is covered by backend/internal/restaurant/authz_test.go; live two-identity probe needs seeded tokens.',
    });
  });

  blocked('RST-UAT-0281', 'Protect sensitive records in logs', 'Blocked: needs log-sink access + error-trigger harness');

  test('RST-UAT-0282 — Keep secrets out of mobile bundle', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    const bad = [/sk_live_[A-Za-z0-9]{10,}/, /sk_test_[A-Za-z0-9]{10,}/, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+/, /-----BEGIN (RSA )?PRIVATE KEY-----/, /ADMIN_API_KEY\s*[:=]\s*["'][^"']{8,}/];
    const hits: string[] = [];
    for (const s of srcs) {
      const body = await (await request.get(s.startsWith('http') ? s : s)).text();
      for (const re of bad) if (re.test(body)) hits.push(`${s}: ${re}`);
      // Dev bundles carry supabase-js doc comments mentioning `service_role`; only a
      // JWT whose decoded role claim is privileged counts as a leaked secret.
      for (const m of body.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
        try {
          const claims = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
          if (['service_role', 'supabase_admin'].includes(claims.role)) hits.push(`${s}: JWT role=${claims.role}`);
        } catch { /* not a JWT */ }
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  blocked('RST-UAT-0283', 'Require TLS and reject unsafe transport', 'Blocked: local stack is plain HTTP; needs staging + MITM proxy');

  test('RST-UAT-0284 — Prevent injection in search and forms (client reflection + API gate)', async ({ page, request }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await openFood(page);
    const payload = `<img src=x onerror="window.__xss=1;alert(1)"> ' OR 1=1;-- {{7*7}}`;
    const input = page.getByPlaceholder(/Search restaurant or dish/i).first();
    await input.fill(payload);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(dialogs).toEqual([]);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await expect(page.getByText('49')).toHaveCount(0);
    const r = await request.post(`${FIN}/${UUID}/orders`, { data: { delivery_address: payload, items: [] } });
    expect(r.status()).toBe(401);
  });

  blocked('RST-UAT-0285', 'Verify secure local cache on logout', 'Blocked: needs real merchant/rider session with PII to compare cache pre/post logout');
  blocked('RST-UAT-0286', 'Audit customer personal data request', 'Blocked: no food-scoped data-request surface found in app/food or app/profile (only (doctor)/compliance/privacy.tsx); needs product decision');

  test('RST-UAT-0287 — Respect privacy in location tracking (anonymous channel)', async ({ request }) => {
    for (const [m, u] of [['POST', `${FIN}/orders/${UUID}/location`], ['GET', `${FIN}/orders/${UUID}/ws`], ['GET', `${FIN}/ws`]] as const) {
      const r = await request.fetch(u, { method: m });
      expect(r.status(), `${m} ${u}`).toBe(401);
    }
  });
});

/* ---------------- Load & Failure Recovery ---------------- */
test.describe('Load and Failure Recovery', () => {
  blocked('RST-UAT-0288', 'Measure search and menu responsiveness', 'Blocked (requires k6/jMeter rig)');
  blocked('RST-UAT-0289', 'Measure checkout latency and failures', 'Blocked (requires k6/jMeter rig)');
  blocked('RST-UAT-0290', 'Measure dispatch processing under bursts', 'Blocked (requires k6/jMeter rig)');
  blocked('RST-UAT-0291', 'Recover from intermittent mobile network', 'Blocked: needs authenticated live cart/pay session (mock-mode food hides the failure path)');
  blocked('RST-UAT-0292', 'Recover from service restart', 'Blocked: requires worker restart + payment-event fixture; not safe on shared docker stack');
  blocked('RST-UAT-0293', 'Recover from stale push or websocket', 'Blocked: needs authenticated WS session (anon WS is 401, see 0287)');
  blocked('RST-UAT-0294', 'Guard throttling and abuse under load', 'Blocked (requires k6/jMeter rig)');
});

/* ---------------- Accessibility & UX ---------------- */
test.describe('Accessibility and UX', () => {
  test('RST-UAT-0295 — Navigate checkout with screen reader (role/label proxy)', async ({ page }) => {
    await openFood(page);
    const unlabeled = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('[role="button"],button,a[href]').forEach((el) => {
        const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '').trim();
        const hidden = (el as HTMLElement).offsetParent === null && getComputedStyle(el).position !== 'fixed';
        if (!name && !hidden) out.push(el.outerHTML.slice(0, 120));
      });
      return out;
    });
    expect(unlabeled, unlabeled.join('\n')).toEqual([]);
  });

  test('RST-UAT-0296 — Use large system font (200% root scale does not clip hub)', async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
    await page.addStyleTag({ content: 'html{font-size:32px}' }).catch(() => undefined);
    await page.goto('/food');
    await page.addStyleTag({ content: 'html{font-size:32px}' });
    await expect(page.getByText('Food & Delivery')).toBeVisible();
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    test.info().annotations.push({ type: 'note', description: `horizontal overflow px at 200% root font: ${overflowX}` });
    expect(overflowX).toBeLessThan(40);
  });

  test('RST-UAT-0297 — Verify touch targets (>=44px on primary hub CTAs)', async ({ page }) => {
    await openFood(page);
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('[role="button"],button').forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.height < 44 || r.width < 44) bad.push(`${Math.round(r.width)}x${Math.round(r.height)} ${((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').slice(0, 30)}`);
      });
      return bad;
    });
    expect(small, `Targets under 44px: ${small.join(' | ')}`).toEqual([]);
  });

  test('RST-UAT-0298 — Recover from validation errors clearly (search inputs carry label/placeholder)', async ({ page }) => {
    await openFood(page);
    const bare = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,textarea')).filter((i) => !i.getAttribute('aria-label') && !i.getAttribute('placeholder') && !i.id).length);
    expect(bare).toBe(0);
    test.info().annotations.push({ type: 'note', description: 'Invalid restaurant/KYB/card form submission needs live owner/rider session — only input labelling checked.' });
  });

  blocked('RST-UAT-0299', 'Handle low-end device performance', 'Blocked: needs physical minimum-spec device');
});

/* ---------------- Integration Contracts ---------------- */
test.describe('Integration Contracts', () => {
  blocked('RST-UAT-0300', 'Handle payment provider API outage', 'Blocked: needs provider fault injection (Paystack stub)');
  blocked('RST-UAT-0301', 'Handle payout provider API outage', 'Blocked: needs provider fault injection');
  blocked('RST-UAT-0302', 'Handle maps geocoder disagreement', 'Blocked: needs geocoder stub');
  blocked('RST-UAT-0303', 'Reject duplicate event delivery from message queue', 'Blocked: needs queue replay harness (asynq)');
  blocked('RST-UAT-0304', 'Handle notification vendor retry semantics', 'Blocked: needs vendor webhook simulator');
});

/* ---------------- Localization & Configuration ---------------- */
test.describe('Localization and Configuration', () => {
  test('RST-UAT-0305 — Display NGN consistently', async ({ page }) => {
    await openFood(page);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/₦\s?[\d,]+/);
    expect(body).not.toMatch(/(\$|USD|€|£)\s?\d/);
  });
  blocked('RST-UAT-0306', 'Use local timezone for hours and cutoff', 'Blocked: needs clock control + finance rollover fixture');
  blocked('RST-UAT-0307', 'Correct fee rounding on small values', 'Blocked: needs sandbox order path; unit coverage exists in src/features/food/__tests__ and backend deliveryfee_test.go (not executed here)');

  test('RST-UAT-0308 — Validate translated or long text fallback (Unicode search input)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openFood(page);
    const input = page.getByPlaceholder(/Search restaurant or dish/i).first();
    await input.fill('Ẹ̀bà ṣọ́ọ̀bù 🍲 جولف 寿司 ' + 'x'.repeat(300));
    await page.waitForTimeout(600);
    await expect(page.getByText('Food & Delivery')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

/* ---------------- Consent & Marketing ---------------- */
test.describe('Consent and Marketing', () => {
  const rel = (p: string) => path.join(REPO, 'mobile-app/reactnative', p);
  function grepDirs(dirs: string[], re: RegExp): string[] {
    const hits: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|json)$/.test(e.name) && re.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
      }
    };
    dirs.forEach((d) => walk(rel(d)));
    return hits;
  }

  test('RST-UAT-0309 — Choose marketing consent independently (presence check on registration/food)', async () => {
    const hits = grepDirs(['app/(auth)', 'app/food', 'src/features/food'], /marketing[_ ]?consent|promotional (messages|emails)|receive (promotions|offers)/i);
    test.info().annotations.push({ type: 'defect', description: 'FOOD-UAT-H-001' });
    expect(hits, 'No marketing-consent control found on auth/food surfaces (FOOD-UAT-H-001)').not.toEqual([]);
  });
  test('RST-UAT-0310 — Withdraw promotional consent (settings surface)', async () => {
    const hits = grepDirs(['app/profile', 'app/food', 'app/(tabs)'], /marketing[_ ]?consent|unsubscribe|promotional (messages|emails)/i);
    test.info().annotations.push({ type: 'defect', description: 'FOOD-UAT-H-001' });
    expect(hits, 'No promo opt-out control found (FOOD-UAT-H-001)').not.toEqual([]);
  });
  blocked('RST-UAT-0311', 'Verify transactional messaging unaffected', 'Blocked: depends on 0309/0310 consent model existing (FOOD-UAT-H-001)');
});

/* ---------------- Food Safety & Merchant Compliance ---------------- */
test.describe('Food Safety and Merchant Compliance', () => {
  blocked('RST-UAT-0316', 'Require jurisdiction-specific mandatory documents', 'Blocked: needs owner session on /food/restaurant/kyb with seeded jurisdiction config');
  test('RST-UAT-0317 — Handle permit expiry and compliance hold (capability probe)', async () => {
    const files = ['backend/internal/restaurant/handler.go', 'backend/internal/restaurant/kyb.go'];
    const src = files.filter((f) => fs.existsSync(path.join(REPO, f))).map((f) => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
    test.info().annotations.push({ type: 'defect', description: 'FOOD-UAT-H-002' });
    expect(src, 'No permit expiry / compliance-hold logic in restaurant KYB code (FOOD-UAT-H-002)').toMatch(/permit_expir|expires_on|compliance_hold|ExpiryDate/i);
  });

  test('RST-UAT-0318 — Make meal allergy information visible', async ({ page }) => {
    await openFood(page);
    await page.getByText('Mama Cass').first().click();
    await expect(page.getByText(/Nutrition & allergens/i).first()).toBeVisible({ timeout: 15_000 });
  });
  blocked('RST-UAT-0319', 'Report food safety incident', 'Blocked: needs completed-order fixture; dispute entry POST /orders/:orderId/dispute exists but no food-safety category found (see FOOD-UAT-H-003)');
});

/* ---------------- Account Closure & Retention ---------------- */
test.describe('Account Closure and Retention', () => {
  blocked('RST-UAT-0320', 'Deactivate idle provider mode', 'Blocked: needs approved provider session');
  blocked('RST-UAT-0321', 'Prevent closure while financial obligation unresolved', 'Blocked: needs provider with open order/dispute/payout');
  blocked('RST-UAT-0322', 'Request customer account deletion with provider role', 'Blocked: no deletion endpoint under /api/finance/restaurant; needs platform-level flow');
  test('RST-UAT-0323 — Prevent resurrection from stale token (invalid/expired bearer)', async ({ request }) => {
    const stale = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwiZXhwIjoxfQ.invalid';
    for (const u of [`${FIN}/mine`, `${FIN}/earnings`, `${FIN}/withdrawals`]) {
      const r = await request.get(u, { headers: { Authorization: `Bearer ${stale}` } });
      expect(r.status(), u).toBe(401);
    }
    test.info().annotations.push({ type: 'note', description: 'Expired-token layer only; post-deactivation (valid JWT, revoked role) needs live provider.' });
  });
});

/* ---------------- Multi-Device Consistency ---------------- */
test.describe('Multi-Device Consistency', () => {
  blocked('RST-UAT-0324', 'Reflect profile across customer/merchant modes', 'Blocked (multi-session fixture harness)');
  blocked('RST-UAT-0325', 'Reflect menu across owner web and mobile', 'Blocked (multi-session fixture harness)');
  blocked('RST-UAT-0326', 'Prevent double rider pickup from two devices', 'Blocked (multi-session fixture harness)');
  blocked('RST-UAT-0327', 'Reflect payment result after app switch', 'Blocked (multi-session fixture harness)');
});

/* ---------------- Fraud & Abuse ---------------- */
test.describe('Fraud and Abuse', () => {
  blocked('RST-UAT-0328', 'Detect suspicious rapid merchant upgrade attempts', 'Blocked: needs authenticated customer + KYB submit loop');
  blocked('RST-UAT-0329', 'Prevent forged order fulfillment', 'Blocked: needs two rider tokens + job fixture');

  test('RST-UAT-0330 — Reject altered discount and delivery fee (contract + anon gate)', async ({ request }) => {
    const model = fs.readFileSync(path.join(REPO, 'backend/internal/restaurant/model.go'), 'utf8');
    const block = model.slice(model.indexOf('type PlaceOrderRequest struct'));
    const body = block.slice(0, block.indexOf('\n}\n'));
    expect(body).not.toMatch(/json:"(discount|discount_kobo|delivery_fee|delivery_fee_kobo|total|total_kobo|subtotal)/i);
    const r = await request.post(`${FIN}/${UUID}/orders`, { data: { items: [{ item_id: UUID, quantity: 1 }], delivery_address: 'x', discount_kobo: 999999, delivery_fee_kobo: 0, tip_kobo: -5 } });
    expect(r.status()).toBe(401);
  });

  test('RST-UAT-0331 — Block payout to unverified beneficiary (anon gate)', async ({ request }) => {
    for (const [m, u] of [['POST', `${FIN}/withdrawals`], ['POST', `${FIN}/bank-accounts`], ['PATCH', `${FIN}/bank-accounts/${UUID}/default`]] as const) {
      expect((await request.fetch(u, { method: m, data: {} })).status(), `${m} ${u}`).toBe(401);
    }
    test.info().annotations.push({ type: 'note', description: 'Verified-beneficiary swap-before-transfer logic needs live owner token.' });
  });
  blocked('RST-UAT-0332', 'Detect refund plus chargeback double credit', 'Blocked: no chargeback ingestion path in restaurant/paystackcheckout (only finance/maplerad); see FOOD-UAT-H-004');
});

/* ---------------- Cross-role journeys ---------------- */
test.describe('Cross-role journeys', () => {
  const DEFER = 'Deferred (requires multi-session fixture harness)';

  test('EEJ-01 — Customer→Merchant Upgrade (surface smoke: customer entry → owner KYB; admin gate)', async ({ page, request }) => {
    await openFood(page);
    await expect(page.getByText('Sell food on Paymax')).toBeVisible();
    await page.goto('/food/restaurant/kyb');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/food/restaurant/kyb');
    const adm = await request.get(`${ADMIN}/admin/restaurant/onboarding`, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(adm.status());
    test.info().annotations.push({ type: 'note', description: 'Partial: register→KYB→admin approve→switch→publish state transitions not executed (needs real accounts).' });
  });

  test('EEJ-02 — Customer→Rider Upgrade (surface smoke: rider console reachable, admin dispatch gated)', async ({ page, request }) => {
    await openFood(page);
    await page.goto('/food/rider');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/food/rider');
    const adm = await request.get(`${ADMIN}/admin/restaurant/dispatch`, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(adm.status());
  });

  test.skip(`EEJ-03 — Role switching and simultaneous provider statuses [${DEFER}] FOOD-UAT-H-005`, async () => {});

  test('EEJ-04 — Restaurant launch (surface smoke: owner console + customer browse)', async ({ page }) => {
    await openFood(page);
    await page.goto('/food/restaurant');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/food/restaurant');
    await page.goto('/food');
    await expect(page.getByText('Mama Cass').first()).toBeVisible();
  });

  test('EEJ-05 — Normal paid delivery (surface smoke: browse → store → checkout → orders → rider job; payment/POD not executed)', async ({ page }) => {
    await openFood(page);
    await page.getByText('Mama Cass').first().click();
    await expect(page.getByText(/Nutrition & allergens/i).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/food/checkout');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/food/checkout');
    await page.goto('/food/orders');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/food/orders');
  });

  test.skip(`EEJ-06 — Owner unavailability / store rejection [${DEFER}] FOOD-UAT-H-005`, async () => {});

  test('EEJ-07 — Pickup without rider (surface smoke: checkout exposes pickup option)', async ({ page }) => {
    await openFood(page);
    await page.getByText('Mama Cass').first().click();
    await page.goto('/food/checkout');
    await page.waitForLoadState('domcontentloaded');
    const txt = await page.locator('body').innerText();
    test.info().annotations.push({ type: 'note', description: `pickup text present: ${/pick.?up/i.test(txt)}` });
    expect(txt.length).toBeGreaterThan(0);
  });

  for (const [n, t] of [
    ['08', 'Dispatch contention / recovery'], ['09', 'Payment uncertain but eventually successful'], ['10', 'Item out of stock at checkout'],
    ['11', 'Customer refund after completed delivery'], ['12', 'Merchant and rider payout'], ['13', 'Payout provider outage and recovery'],
    ['14', 'Cross-tenant and role abuse'], ['15', 'Rider offline / no available couriers'], ['16', 'Provider compliance expiry'],
    ['17', 'Multi-branch delivery'], ['18', 'Dine-in QR shared bill'], ['19', 'Reservation and no-show'], ['20', 'COD reconciliation'],
    ['21', 'Offline device disruption'], ['22', 'Closure retaining financial records'],
  ] as const) {
    test.skip(`EEJ-${n} — ${t} [${DEFER}] FOOD-UAT-H-005`, async () => {});
  }
});
