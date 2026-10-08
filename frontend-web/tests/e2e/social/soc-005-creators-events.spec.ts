/**
 * SOC-005 — creators / promotions / top5events / spray probes.
 *
 * CREATORS: POST /creators/apply lands a PENDING profile → admin approve
 * (POST /api/creators/admin/creators/:id/approve) now succeeds — E2E-SOC-034
 * fixed: adminGroupTop5 mounts RequireAuthContext before requireUserID across
 * all 12 call sites. Verified end-to-end: APPROVED creator appears in the
 * public directory.
 *
 * TOP5EVENTS: the full organiser lifecycle DOES work — create (DRAFT) →
 * submit → admin approve (this admin group WAS fixed with mapsAuth) → golive →
 * the event appears in the public LIVE feed. Contrasts with creators to prove
 * the 401 is module-specific, not a broken env.
 *
 * PROMOTIONS: GET /api/v1/promotions/banners (Go only — no BFF route) requires
 * a ?module= param and returns real rows ([] honestly).
 *
 * SPRAY + P2P: env-blocked — backend FEATURE_P2P_MARKET_ENABLED unset →
 * routes unmounted → 404. Also, the spray BFF maps /api/v1/spray/* to
 * /api/finance/spray/* while Go mounts member spray under
 * /api/finance/p2p/spray* — an upstream-path mismatch that would 404 even
 * with the flag on.
 */

import { expect, test } from '@playwright/test';
import {
  ADMIN_USER,
  bearer,
  goAdminFetch,
  goFetch,
  provisionedSession,
  tokenFor,
} from './helpers';

test.describe('SOC-005: creators / promotions / events / spray', () => {
  test('creator apply → PENDING → admin approve → APPROVED in directory', async ({
    request,
  }) => {
    const user = await provisionedSession(request, 'soc-005');
    const auth = bearer(user.token);

    const apply = await request.post('/api/v1/creators/creators/apply', {
      headers: auth,
      data: { display_name: 'SOC005 Creator', bio: 'e2e creator' },
    });
    expect(apply.status()).toBe(200);
    const profile = (await apply.json()).profile;
    expect(profile.state).toBe('PENDING');
    expect(profile.user_id).toBe(user.userId);

    // Pending creators honestly do NOT appear in the public directory.
    const dir = await request.get('/api/v1/creators/creators-directory', { headers: auth });
    expect(dir.status()).toBe(200);
    expect(
      ((await dir.json()).creators ?? []).some(
        (c: { user_id: string }) => c.user_id === user.userId,
      ),
    ).toBe(false);

    // E2E-SOC-034 FIXED: adminGroupTop5 now mounts RequireAuthContext before
    // requireUserID, so the super-admin approve reaches the handler — the
    // PENDING → APPROVED transition is reachable through the product.
    const adminToken = await tokenFor(request, ADMIN_USER.email, ADMIN_USER.password);
    const approve = await goAdminFetch(
      request,
      'POST',
      `/api/creators/admin/creators/${user.userId}/approve`,
      adminToken,
    );
    expect(
      approve.status(),
      `creator approve should succeed post-SOC-034 fix: ${approve.status()}`,
    ).toBe(200);

    // Approved creators DO appear in the public directory.
    const dirAfter = await request.get('/api/v1/creators/creators-directory', {
      headers: auth,
    });
    expect(dirAfter.status()).toBe(200);
    // Directory lists only state='APPROVED' storefronts — presence implies approval.
    expect(
      ((await dirAfter.json()).creators ?? []).some(
        (c: { user_id: string }) => c.user_id === user.userId,
      ),
    ).toBe(true);
  });

  test('top5events full lifecycle: draft → submit → approve → live in feed', async ({
    request,
  }) => {
    const organiser = await provisionedSession(request, 'soc-005e');
    const auth = bearer(organiser.token);

    const created = await request.post('/api/v1/events', {
      headers: auth,
      data: {
        title: `SOC005 Live Event ${Date.now() % 100000}`,
        category: 'music',
        venue: 'E2E Arena',
        starts_at: '2027-02-01T18:00:00Z',
        ends_at: '2027-02-01T23:00:00Z',
      },
    });
    expect(created.status()).toBe(200);
    const event = (await created.json()).data;
    expect(event.state).toBe('DRAFT');
    const eventId = event.id;

    const submit = await request.post(`/api/v1/events/${eventId}/submit`, { headers: auth });
    expect(submit.status()).toBe(200);

    const adminToken = await tokenFor(request, ADMIN_USER.email, ADMIN_USER.password);
    const approve = await goAdminFetch(
      request,
      'POST',
      `/api/events/admin/${eventId}/approve`,
      adminToken,
    );
    expect(approve.status()).toBe(200);

    const golive = await request.post(`/api/v1/events/${eventId}/golive`, { headers: auth });
    expect(golive.status()).toBe(200);

    const feed = await goFetch(request, 'GET', '/api/finance/events?state=LIVE', organiser.token);
    const events = (await feed.json()).events ?? [];
    expect(events.some((e: { id: string }) => e.id === eventId)).toBe(true);
  });

  test('promotions banners: real rows, module param enforced', async ({ request }) => {
    const user = await provisionedSession(request, 'soc-005p');
    const missing = await goFetch(request, 'GET', '/api/v1/promotions/banners', user.token);
    expect(missing.status()).toBe(400); // "module parameter required" — not a silent all-modules dump

    const res = await goFetch(
      request,
      'GET',
      '/api/v1/promotions/banners?module=marketplace',
      user.token,
    );
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).banners)).toBe(true);
  });

  test('spray + p2p are env-blocked (routes unmounted)', async ({ request }) => {
    const user = await provisionedSession(request, 'soc-005s');
    const auth = bearer(user.token);

    // FEATURE_P2P_MARKET_ENABLED unset → RegisterP2PMarket skipped entirely.
    const sprayGo = await goFetch(
      request,
      'GET',
      '/api/finance/p2p/spray/leaderboard/soc-005-ctx',
      user.token,
    );
    expect(sprayGo.status()).toBe(404);

    const p2pGo = await goFetch(request, 'GET', '/api/finance/p2p/p2p/listings', user.token);
    expect(p2pGo.status()).toBe(404);

    // …and the BFF surfaces agree (they proxy to dead upstream paths).
    const sprayBff = await request.get('/api/v1/spray/spray/leaderboard/x', { headers: auth });
    expect(sprayBff.status()).toBe(404);
  });
});
