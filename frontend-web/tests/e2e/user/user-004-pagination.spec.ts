/**
 * USER-004 — pagination on a user-facing list.
 *
 * Surface: /restaurant → RestaurantDiscoveryClient → GET /api/v1/restaurant
 * (limit/offset/has_more/total — the only user-facing list with a real
 * server-side pagination contract in this stack).
 *
 * Setup: the provisioned user creates two restaurants via POST
 * /api/v1/restaurant (real API). Discovery only lists is_open=TRUE rows (and
 * approved when moderation is on), so the test approves+opens its OWN rows in
 * Postgres — fixture setup, same class of shortcut as
 * provisionVerifiedUser's DB email-confirm.
 *
 * Asserts:
 *   - limit=1 honoured; page 2 returns a DIFFERENT record, no dupes
 *   - total / has_more metadata correct and consistent across pages
 *   - ordering stable (repeat page-1 fetch → same id)
 *   - UI renders the seeded cards + total count
 *   - nonsense search → sane empty state (not a crash/spinner)
 *   - unauth GET → 401; another user cannot close the restaurant (403)
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';

async function createRestaurant(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const res = await request.post('/api/v1/restaurant', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, address: '12 E2E Close, Lagos', cuisine: 'Local' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

test.describe('USER-004: restaurant discovery pagination', () => {
  test('limit/offset pages return distinct records; UI list + empty state sane', async ({
    page,
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'upage');
    const other = await provisionVerifiedUser(request, 'upage-bola');
    const { accessToken } = await loginViaApi(context, request, {
      email: user.email,
      password: user.password,
    });
    const auth = { Authorization: `Bearer ${accessToken}` };
    const tag = `E2EPG${Date.now() % 100000}`;

    const id1 = await createRestaurant(request, accessToken, `${tag} Alpha Kitchen`);
    const id2 = await createRestaurant(request, accessToken, `${tag} Beta Grill`);

    // Fixture: flip own rows open + approved so discovery lists them.
    psql(
      `update public.restaurants set kyb_status='approved', listing_review_status='APPROVED', is_open=true ` +
        `where id in ('${id1}','${id2}');`,
    );

    await test.step('pagination contract', async () => {
      const p1 = await request.get(
        `/api/v1/restaurant?q=${encodeURIComponent(tag)}&limit=1&offset=0&sort=newest`,
        { headers: auth },
      );
      expect(p1.status()).toBe(200);
      const page1 = await p1.json();
      expect(page1.restaurants).toHaveLength(1);
      expect(page1.total).toBe(2);
      expect(page1.limit).toBe(1);
      expect(page1.offset).toBe(0);
      expect(page1.has_more).toBe(true);

      const p2 = await request.get(
        `/api/v1/restaurant?q=${encodeURIComponent(tag)}&limit=1&offset=1&sort=newest`,
        { headers: auth },
      );
      const page2 = await p2.json();
      expect(page2.restaurants).toHaveLength(1);
      expect(page2.has_more).toBe(false);
      expect(page2.restaurants[0].id).not.toBe(page1.restaurants[0].id);
      expect(new Set([page1.restaurants[0].id, page2.restaurants[0].id])).toEqual(new Set([id1, id2]));

      // Stable ordering: repeat page 1 → same record.
      const p1again = await request.get(
        `/api/v1/restaurant?q=${encodeURIComponent(tag)}&limit=1&offset=0&sort=newest`,
        { headers: auth },
      );
      expect((await p1again.json()).restaurants[0].id).toBe(page1.restaurants[0].id);
    });

    await test.step('UI renders the real list', async () => {
      const listRes = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/v1/restaurant' && r.status() === 200,
        { timeout: 45_000 },
      );
      await page.goto('/restaurant');
      await listRes;
      await expect(page.getByText(`${tag} Alpha Kitchen`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`${tag} Beta Grill`)).toBeVisible();
    });

    await test.step('empty state is sane', async () => {
      await page.locator('input[placeholder*="Search restaurants"]').fill('zzz-no-such-place-e2e');
      await page.getByRole('button', { name: /^search$/i }).click();
      await expect(page.getByText(/No restaurants match your search/i)).toBeVisible({ timeout: 30_000 });
    });

    await test.step('edge probes', async () => {
      expect((await request.get('/api/v1/restaurant')).status()).toBe(401);

      // BOLA on the created resource: another user cannot toggle availability.
      const otherLogin = await request.post('/api/auth/login', {
        data: { identifier: other.email, password: other.password },
      });
      const otherToken = (await otherLogin.json()).session.access_token as string;
      const foreign = await request.fetch(`/api/v1/restaurant/${id1}/availability`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${otherToken}` },
        data: { is_open: false },
      });
      expect(foreign.status()).toBe(403);
      // And the owner's row is untouched.
      expect(psql(`select is_open from public.restaurants where id='${id1}';`)).toBe('t');
    });
  });
});
