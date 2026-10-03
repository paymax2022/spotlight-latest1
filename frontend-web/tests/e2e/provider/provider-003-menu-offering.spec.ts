/**
 * PROVIDER-003 — provider dashboard: create a real offering (menu item).
 *
 * The "provider dashboard" for a restaurant is its menu-management API (no web
 * owner UI exists — the BFF proxies are the same surface the mobile owner
 * console drives):
 *   POST /api/v1/restaurant/:id/menu/categories  → 201
 *   POST /api/v1/restaurant/:id/menu/items       → 201
 *   GET  /api/v1/restaurant/:id                  → detail incl. categories/items
 *
 * Asserts the offering persists (API read-back + DB rows) and that menu
 * management is owner-gated (anon 401 / foreign 403 covered in PROVIDER-001;
 * here we add PATCH price + is_available as the operator action).
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';
import { createRestaurant } from './helpers';

test.describe('PROVIDER-003: menu offering creation', () => {
  test('category + item persist via API and DB; price update round-trips', async ({
    context,
    request,
  }) => {
    const owner = await provisionVerifiedUser(request, 'p-menu');
    const { accessToken } = await loginViaApi(context, request, {
      email: owner.email,
      password: owner.password,
    });
    const auth = { Authorization: `Bearer ${accessToken}` };
    const name = `E2EMENU${Date.now() % 100000} Cafe`;

    const created = await createRestaurant(request, accessToken, name);
    expect(created.status).toBe(201);
    const rid = created.body.id;

    let categoryId = '';
    let itemId = '';

    await test.step('create menu category', async () => {
      const res = await request.fetch(`/api/v1/restaurant/${rid}/menu/categories`, {
        method: 'POST',
        headers: auth,
        data: { name: 'E2E Mains' },
      });
      expect(res.status()).toBe(201);
      categoryId = (await res.json()).id as string;
      expect(categoryId).toBeTruthy();
      expect(
        psql(`select name from menu_categories where id='${categoryId}' and restaurant_id='${rid}';`),
      ).toBe('E2E Mains');
    });

    await test.step('create menu item (the offering)', async () => {
      const res = await request.fetch(`/api/v1/restaurant/${rid}/menu/items`, {
        method: 'POST',
        headers: auth,
        data: {
          category_id: categoryId,
          name: 'E2E Jollof Special',
          description: 'Smoky party jollof',
          price_kobo: 150_000, // ₦1,500
          dietary_tags: ['spicy'],
        },
      });
      expect(res.status()).toBe(201);
      const item = await res.json();
      itemId = item.id as string;
      expect(itemId).toBeTruthy();
      expect(
        psql(`select name || '|' || price_kobo from menu_items where id='${itemId}';`),
      ).toBe('E2E Jollof Special|150000');
    });

    await test.step('detail read-back shows the offering', async () => {
      const detail = await request.get(`/api/v1/restaurant/${rid}`, { headers: auth });
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      const items = (body.menu ?? body.categories ?? [])
        .flatMap((c: { items?: Array<{ id: string }> }) => c.items ?? []);
      expect(items.map((i: { id: string }) => i.id)).toContain(itemId);
    });

    await test.step('operator update: price + availability', async () => {
      const res = await request.fetch(`/api/v1/restaurant/${rid}/menu/items/${itemId}`, {
        method: 'PATCH',
        headers: auth,
        data: { price_kobo: 175_000, is_available: false },
      });
      expect(res.status()).toBe(200);
      expect(
        psql(`select price_kobo || '|' || is_available from menu_items where id='${itemId}';`),
      ).toBe('175000|false');
    });
  });
});
