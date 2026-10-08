/**
 * PROVIDER-004 — cross-actor visibility: an approved provider's offering is
 * discoverable + purchasable by a normal user.
 * PROVIDER-005 — request/order flow: the user's order lands in the provider's
 * queue and the provider advances it.
 *
 * Setup (real APIs): owner creates store → KYB (sole_proprietor, no docs
 * needed) → admin API approves → menu category + item. Customer is a second
 * provisioned user, wallet funded by posting the balanced top-up journal in
 * Postgres (fixture setup — the real Paystack rail cannot complete locally).
 *
 * Asserts:
 *   - consumer discovery lists the store only AFTER approval (gated before)
 *   - consumer UI (/restaurant, /restaurant/[id]) renders it
 *   - wallet-funded UI checkout (Pay From Wallet) places a REAL order
 *   - the order appears in the provider queue (role=restaurant) and the
 *     provider advances pending→confirmed→preparing; DB reflects each move
 *   - customer cannot set a provider-side status (403 object-level authZ)
 */

import { expect, test, type Page } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';
import { ADMIN_USER, createRestaurant, fundWallet, goFetch, goTrueToken } from './helpers';

const KYB_BODY = {
  legal_name: 'E2E Provider Foods',
  business_type: 'sole_proprietor',
  contact_email: 'kyb-e2e@paymax.test',
  contact_phone: '+2348012345678',
  bank_code: '058',
  account_number: '0123456789',
  account_name: 'E2E Provider Foods',
};

test.describe('PROVIDER-004/005: cross-actor visibility + order flow', () => {
  test('approved provider is discoverable; customer wallet order lands in provider queue', async ({
    context,
    request,
    page,
  }) => {
    const owner = await provisionVerifiedUser(request, 'p-owner');
    const customer = await provisionVerifiedUser(request, 'p-cust');
    const { accessToken: ownerToken } = await loginViaApi(context, request, {
      email: owner.email,
      password: owner.password,
    });
    const ownerAuth = { Authorization: `Bearer ${ownerToken}` };
    const name = `E2EVIS${Date.now() % 100000} Bistro`;

    let rid = '';
    let itemId = '';

    await test.step('provider goes through the real pipeline', async () => {
      const created = await createRestaurant(request, ownerToken, name);
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

      // Gate check BEFORE approval: consumer discovery hides the store.
      const early = await request.get(`/api/v1/restaurant?q=${encodeURIComponent(name)}`, {
        headers: ownerAuth,
      });
      expect(((await early.json()).restaurants ?? []).length).toBe(0);

      const admin = await goTrueToken(request, ADMIN_USER.email, ADMIN_USER.password);
      const decided = await goFetch(request, `/api/restaurant/admin/onboarding/${rid}/approve`, {
        method: 'POST', token: admin, data: { note: 'E2E' },
      });
      expect(decided.status).toBe(200);
      expect(psql(`select kyb_status || '|' || is_open from restaurants where id='${rid}';`))
        .toBe('approved|true');

      const cat = await request.fetch(`/api/v1/restaurant/${rid}/menu/categories`, {
        method: 'POST', headers: ownerAuth, data: { name: 'E2E Mains' },
      });
      expect(cat.status()).toBe(201);
      const item = await request.fetch(`/api/v1/restaurant/${rid}/menu/items`, {
        method: 'POST',
        headers: ownerAuth,
        data: { category_id: (await cat.json()).id, name: 'E2E Vis Jollof', price_kobo: 150_000 },
      });
      expect(item.status()).toBe(201);
      itemId = (await item.json()).id as string;
    });

    const { accessToken: custToken } = await loginViaApi(context, request, {
      email: customer.email,
      password: customer.password,
    });
    const custAuth = { Authorization: `Bearer ${custToken}` };

    await test.step('PROVIDER-004: offering discoverable by the customer', async () => {
      const list = await request.get(`/api/v1/restaurant?q=${encodeURIComponent(name)}`, {
        headers: custAuth,
      });
      expect(list.status()).toBe(200);
      const body = await list.json();
      expect((body.restaurants ?? []).map((r: { id: string }) => r.id)).toContain(rid);

      const detail = await request.get(`/api/v1/restaurant/${rid}`, { headers: custAuth });
      const d = await detail.json();
      const items = (d.categories ?? []).flatMap((c: { items?: Array<{ id: string }> }) => c.items ?? []);
      expect(items.map((i: { id: string }) => i.id)).toContain(itemId);

      // UI surfaces.
      const listRes = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/v1/restaurant' && r.status() === 200,
        { timeout: 45_000 },
      );
      await page.goto('/restaurant');
      await listRes;
      await page.locator('input[placeholder*="Search restaurants"]').fill(name);
      await page.getByRole('button', { name: /^search$/i }).click();
      await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
    });

    let orderId = '';

    await test.step('PROVIDER-005: UI wallet checkout places a real order', async () => {
      // Fund the customer's wallet (fixture: balanced journal the top-up
      // webhook posts — Paystack rail cannot complete with placeholder keys).
      fundWallet(customer.userId, 500_000, `p005-${Date.now()}`);
      expect(psql(
        `select available_kobo from wallet_balance wb join ledger_accounts la on la.id=wb.account_id ` +
        `where la.user_id='${customer.userId}' and la.type='user_wallet';`,
      )).toBe('500000');

      await page.goto(`/restaurant/${rid}`);
      await expect(page.getByText('E2E Vis Jollof')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /add to cart/i }).first().click();
      await page.getByRole('button', { name: /go to checkout/i }).click();
      await page.waitForURL('**/restaurant/checkout**', { timeout: 30_000 });

      await page.locator('textarea').fill('21 E2E Delivery St, Lagos');
      const orderRes = page.waitForResponse(
        (r) => /\/api\/v1\/restaurant\/[^/]+\/orders$/.test(new URL(r.url()).pathname)
          && r.request().method() === 'POST',
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: /pay from wallet/i }).click();
      const res = await orderRes;
      expect(res.status()).toBe(201);
      orderId = ((await res.json()) as { id: string }).id;
      await page.waitForURL(`**/restaurant/orders/${orderId}**`, { timeout: 30_000 });

      expect(psql(`select status || '|' || total_kobo from orders where id='${orderId}';`))
        .toMatch(/^pending\|\d+$/);
    });

    await test.step('order lands in the provider queue; provider advances it', async () => {
      const queue = await request.get('/api/v1/restaurant/orders?role=restaurant', {
        headers: ownerAuth,
      });
      expect(queue.status()).toBe(200);
      const orders = ((await queue.json()).orders ?? []) as Array<{ id: string; status: string }>;
      expect(orders.map((o) => o.id)).toContain(orderId);
      expect(orders.find((o) => o.id === orderId)?.status).toBe('pending');

      // Customer may NOT perform the provider-side transition (object-level authZ).
      const denied = await request.fetch(`/api/v1/restaurant/${rid}/orders/${orderId}/status`, {
        method: 'PATCH', headers: custAuth, data: { status: 'confirmed' },
      });
      expect(denied.status()).toBe(403);
      expect(psql(`select status from orders where id='${orderId}';`)).toBe('pending');

      // Provider accepts → confirmed, then starts prep → preparing.
      for (const status of ['confirmed', 'preparing']) {
        const patch = await request.fetch(`/api/v1/restaurant/${rid}/orders/${orderId}/status`, {
          method: 'PATCH', headers: ownerAuth, data: { status },
        });
        expect(patch.status()).toBe(200);
        expect(psql(`select status from orders where id='${orderId}';`)).toBe(status);
      }
    });
  });
});
