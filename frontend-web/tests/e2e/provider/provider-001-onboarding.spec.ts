/**
 * PROVIDER-001 — provider onboarding (restaurant owner).
 *
 * Surface discovery: the web product has NO provider-owner UI — app/restaurant/*
 * is entirely consumer-side (browse/detail/checkout/orders), and the owner
 * console lives in the mobile app. The provider journey is therefore exercised
 * at the real API surface the owner console consumes:
 *   POST /api/v1/restaurant          → Go POST /api/finance/restaurant
 *   GET  /api/v1/restaurant/mine     → Go GET  /api/finance/restaurant/mine
 *
 * Asserts:
 *   - provisioned user becomes a provider by creating a store (201) and it
 *     lands in GET /mine + the restaurants table as is_open=false
 *   - the new provider is invisible in consumer discovery until approved
 *   - anon mutation → 401; foreign owner cannot mutate the store (403 BOLA)
 *   - unapproved owner cannot self-open (403 — fail-closed KYB gate)
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';
import { createRestaurant } from './helpers';

test.describe('PROVIDER-001: provider onboarding (restaurant owner)', () => {
  test('create store → appears in /mine → gated from discovery + mutations until KYB-approved', async ({
    context,
    request,
  }) => {
    const owner = await provisionVerifiedUser(request, 'p-own');
    const stranger = await provisionVerifiedUser(request, 'p-bola');
    const { accessToken } = await loginViaApi(context, request, {
      email: owner.email,
      password: owner.password,
    });
    const auth = { Authorization: `Bearer ${accessToken}` };
    const name = `E2EPROV${Date.now() % 100000} Kitchen`;
    let restaurantId = '';

    await test.step('create the store (the provider onboarding act)', async () => {
      const res = await createRestaurant(request, accessToken, name);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      restaurantId = res.body.id;

      // Owner sees their own store via the owner-scoped list.
      const mine = await request.get('/api/v1/restaurant/mine', { headers: auth });
      expect(mine.status()).toBe(200);
      const mineBody = await mine.json();
      const rows = (mineBody.data ?? mineBody.restaurants ?? mineBody) as Array<{ id: string; name: string }>;
      expect(rows.map((r) => r.id)).toContain(restaurantId);

      // DB: created closed + unverified, awaiting KYB.
      expect(
        psql(`select is_open || '|' || coalesce(kyb_status,'none') from restaurants where id='${restaurantId}';`),
      ).toBe('false|none');
    });

    await test.step('gated before approval', async () => {
      // Not in consumer discovery (is_open=false filter).
      const disc = await request.get(`/api/v1/restaurant?q=${encodeURIComponent(name)}`, {
        headers: auth,
      });
      expect(disc.status()).toBe(200);
      const page = await disc.json();
      expect(page.restaurants ?? []).toHaveLength(0);

      // Owner cannot self-open while KYB is unapproved (fail-closed, FOOD-010).
      const avail = await request.fetch(`/api/v1/restaurant/${restaurantId}/availability`, {
        method: 'PATCH',
        headers: auth,
        data: { is_open: true },
      });
      expect(avail.status()).toBe(403);
      expect(psql(`select is_open from restaurants where id='${restaurantId}';`)).toBe('f');
    });

    await test.step('edge probes: anon 401 + BOLA 403', async () => {
      // Anonymous cannot create a store or read the owner list.
      expect((await request.post('/api/v1/restaurant', {
        data: { name: 'Anon Kitchen', address: 'x' },
      })).status()).toBe(401);
      expect((await request.get('/api/v1/restaurant/mine')).status()).toBe(401);
      // Anonymous cannot mutate an existing store.
      expect(
        (await request.fetch(`/api/v1/restaurant/${restaurantId}`, {
          method: 'PATCH',
          data: { description: 'vandalised' },
        })).status(),
      ).toBe(401);

      // Provider B cannot mutate provider A's store (BOLA).
      const otherLogin = await request.post('/api/auth/login', {
        data: { identifier: stranger.email, password: stranger.password },
      });
      const otherToken = (await otherLogin.json()).session.access_token as string;
      const otherAuth = { Authorization: `Bearer ${otherToken}` };

      const foreignPatch = await request.fetch(`/api/v1/restaurant/${restaurantId}`, {
        method: 'PATCH',
        headers: otherAuth,
        data: { description: 'vandalised by B' },
      });
      expect(foreignPatch.status()).toBe(403);
      const foreignAvail = await request.fetch(`/api/v1/restaurant/${restaurantId}/availability`, {
        method: 'PATCH',
        headers: otherAuth,
        data: { is_open: true },
      });
      expect(foreignAvail.status()).toBe(403);
      const foreignMenu = await request.fetch(`/api/v1/restaurant/${restaurantId}/menu/categories`, {
        method: 'POST',
        headers: otherAuth,
        data: { name: 'Injected' },
      });
      expect(foreignMenu.status()).toBe(403);
      expect(psql(`select count(*) from menu_categories where restaurant_id='${restaurantId}';`)).toBe('0');
    });
  });
});
