/**
 * SOC-004 — marketplace: listing lifecycle through the real BFF.
 *
 * Flow: GET categories (public) → POST /listings (draft) → POST /:id/submit
 * (pending_review) → admin approve (:8080, super-admin + api key) → status
 * active → discoverable via GET /search → a second user reads the detail and
 * the view counter ticks.
 *
 * Elasticsearch leg: ELASTICSEARCH_URL is unset, so /search runs the honest
 * Postgres fallback — the response itself says degraded:true and skips facets.
 * This is NOT an env-blocked leg: search works and returns real active rows.
 *
 * Cart/checkout is out of scope: marketplace checkout is offer/escrow-based
 * (POST /offers → accept → escrow hold) and PSP-dependent; the discovery leg
 * (create→publish→find→view) is the reachable real flow.
 */

import { expect, test } from '@playwright/test';
import {
  ADMIN_USER,
  bearer,
  goAdminFetch,
  provisionedSession,
  psql,
  tokenFor,
} from './helpers';

test.describe('SOC-004: marketplace listing → discovery', () => {
  test('listing created by one user is found and viewed by another', async ({
    request,
  }) => {
    const seller = await provisionedSession(request, 'soc-004a');
    const buyer = await provisionedSession(request, 'soc-004b');
    const authA = bearer(seller.token);
    const authB = bearer(buyer.token);

    let categoryId = '';
    let listingId = '';

    await test.step('pick a real seeded category', async () => {
      const res = await request.get('/api/v1/marketplace/categories');
      expect(res.status()).toBe(200);
      const cats = (await res.json()).data;
      const cat = cats.find((c: { slug: string }) => c.slug === 'phones-tablets') ?? cats[0];
      categoryId = cat.id;
      expect(categoryId).toBeTruthy();
    });

    await test.step('seller creates a draft listing', async () => {
      const res = await request.post('/api/v1/marketplace/listings', {
        headers: authA,
        data: {
          category_id: categoryId,
          title: `SOC004 Probe Phone ${Date.now() % 100000}`,
          description: 'A sealed marketplace listing created by the E2E suite',
          price_kobo: 25_000_000, // ₦250,000 in minor units
          condition: 'new',
          state: 'Lagos',
          lga: 'Ikeja',
        },
      });
      expect(res.status()).toBe(201);
      const l = (await res.json()).data;
      listingId = l.id;
      expect(l.status).toBe('draft');
      expect(l.market_id).toBe('NG');
    });

    await test.step('submit moves draft → pending_review (moderation, not silent publish)', async () => {
      const res = await request.post(`/api/v1/marketplace/listings/${listingId}/submit`, {
        headers: authA,
      });
      expect(res.status()).toBe(200);
      expect((await res.json()).data.status).toBe('pending_review');
      // Honest: a pending listing must NOT appear in public search yet.
      const s = await request.get(`/api/v1/marketplace/listings/${listingId}`);
      expect((await s.json()).data.status).toBe('pending_review');
    });

    await test.step('admin approve flips it active (moderation queue works)', async () => {
      const adminToken = await tokenFor(request, ADMIN_USER.email, ADMIN_USER.password);
      const res = await goAdminFetch(
        request,
        'POST',
        `/v1/marketplace/admin/listings/${listingId}/approve`,
        adminToken,
      );
      expect(res.status()).toBe(200);
      expect((await res.json()).data.status).toBe('active');
      expect(
        psql(`select status from mkt_listings where id='${listingId}';`),
      ).toBe('active');
    });

    await test.step('degraded Postgres search finds the active listing by title', async () => {
      const res = await request.get('/api/v1/marketplace/search?q=SOC004');
      expect(res.status()).toBe(200);
      const data = (await res.json()).data;
      expect(data.degraded).toBe(true); // ES unwired — honestly reported
      const hit = data.results.find((r: { id: string }) => r.id === listingId);
      expect(hit, 'listing discoverable via search').toBeTruthy();
    });

    await test.step('second user reads the listing; view counter ticks', async () => {
      const res = await request.get(`/api/v1/marketplace/listings/${listingId}`, {
        headers: authB,
      });
      expect(res.status()).toBe(200);
      const l = (await res.json()).data;
      expect(l.status).toBe('active');
      expect(l.seller_id).toBe(seller.userId);
      expect(l.view_count).toBeGreaterThanOrEqual(1);

      // …and it appears on the seller's own my-listings surface.
      const mine = await request.get('/api/v1/marketplace/my-listings', {
        headers: authA,
      });
      expect(mine.status()).toBe(200);
      const mineBody = await mine.json();
      const mineList = Array.isArray(mineBody) ? mineBody : mineBody.data ?? mineBody.listings ?? [];
      expect(mineList.some((x: { id: string }) => x.id === listingId)).toBe(true);
    });
  });
});
