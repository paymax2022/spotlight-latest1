/**
 * SOC-001 — connect/social surface discovery.
 *
 * Two questions, answered with live traffic:
 *
 *   1. Do WEB pages exist for this cluster? NO. docs/e2e/inventory-web-screens.csv
 *      lists no connect/social/groups/creators/marketplace page and every
 *      candidate route 404s on :3000. The cluster is API-only — its product
 *      surface is the BFF proxy plane (app/api/v1/*) plus Go :8080.
 *
 *   2. Which API surfaces are reachable and honest? For each: real status, real
 *      envelope shape, empty collections returned as [] (honest empty state)
 *      rather than placeholders or crashes. Env-blocked legs are asserted at
 *      their observed status and recorded in docs/e2e/results/social.md:
 *        - /api/v1/groups        → 503 (FEATURE_GROUPS_ENABLED unset in
 *                                  frontend-web/.env.local while backend's
 *                                  FEATURE_GROUPS_ENABLED=true — env skew)
 *        - /api/v1/spray + /p2p  → 404 (backend FEATURE_P2P_MARKET_ENABLED
 *                                  unset → routes never mounted)
 */

import { expect, test } from '@playwright/test';
import { goFetch, provisionedSession, bearer } from './helpers';

const UI_CANDIDATES = [
  '/connect',
  '/social',
  '/groups',
  '/creators',
  '/marketplace',
  '/cashtag',
  '/spray',
  '/p2p',
];

test.describe('SOC-001: surface discovery', () => {
  test('no web UI pages exist for the connect/social cluster', async ({ request }) => {
    for (const path of UI_CANDIDATES) {
      const res = await request.get(path);
      expect(
        res.status(),
        `expected ${path} to be a Next 404 (no such page in the web app)`,
      ).toBe(404);
    }
  });

  test('reachable BFF/Go surfaces return real envelopes and honest empty states', async ({
    request,
  }) => {
    const me = await provisionedSession(request, 'soc-001');
    const auth = bearer(me.token);

    await test.step('connect onboarding status is a real object', async () => {
      const res = await request.get('/api/v1/connect/onboarding/status', { headers: auth });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ status: 'pending', age_verified: false });
      expect(Array.isArray(body.missing_consents)).toBe(true);
    });

    await test.step('connect profile auto-creates on first read', async () => {
      const res = await request.get('/api/v1/connect/profile', { headers: auth });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.data.user_id).toBe(me.userId);
      expect(body.data.id).toBeTruthy();
    });

    await test.step('social-pay lists return honest empty collections', async () => {
      for (const sub of ['requests', 'splits', 'pools']) {
        const res = await request.get(`/api/v1/social/social/${sub}`, { headers: auth });
        expect(res.status(), `social/${sub}`).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body[sub])).toBe(true);
      }
    });

    await test.step('social cashtag handle claim + resolve round-trips', async () => {
      const handle = `soc${Date.now() % 100000000}`;
      const claim = await request.post('/api/v1/social/social/handle', {
        headers: auth,
        data: { handle },
      });
      expect(claim.status()).toBe(201);
      const mine = await request.get('/api/v1/social/social/handle/me', { headers: auth });
      expect((await mine.json()).handle.handle).toBe(handle);
      const resolve = await request.get(`/api/v1/social/social/handle/${handle}`, {
        headers: auth,
      });
      expect(resolve.status()).toBe(200);
      // Resolve returns the flat {success, user_id} shape — not a handle object.
      expect((await resolve.json()).user_id).toBe(me.userId);
    });

    await test.step('creators directory is a real (empty for now) list', async () => {
      const res = await request.get('/api/v1/creators/creators-directory', { headers: auth });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.creators)).toBe(true);
    });

    await test.step('top5 events member reads are live', async () => {
      const mine = await request.get('/api/v1/events/organiser/mine', { headers: auth });
      expect(mine.status()).toBe(200);
      expect((await mine.json()).success).toBe(true);
      const feed = await goFetch(request, 'GET', '/api/finance/events', me.token);
      expect(feed.status()).toBe(200);
      expect(Array.isArray((await feed.json()).events)).toBe(true);
    });

    await test.step('marketplace categories are public and seeded', async () => {
      // Public browse tier — no auth needed, per the Go router contract.
      const res = await request.get('/api/v1/marketplace/categories');
      expect(res.status()).toBe(200);
      const cats = (await res.json()).data;
      expect(Array.isArray(cats)).toBe(true);
      expect(cats.length).toBeGreaterThan(5);
      expect(cats[0]).toMatchObject({ market_id: 'NG', is_active: true });
    });

    await test.step('marketplace search answers in degraded (Postgres) mode', async () => {
      // ELASTICSEARCH_URL unset — Go falls back to ILIKE search and SAYS SO
      // via degraded:true instead of faking ES results.
      const res = await request.get('/api/v1/marketplace/search?q=zzz-no-match');
      expect(res.status()).toBe(200);
      const data = (await res.json()).data;
      expect(data.degraded).toBe(true);
      expect(Array.isArray(data.results)).toBe(true);
    });

    await test.step('stays member reads are live (dual-rail, empty supply)', async () => {
      const res = await request.get('/api/v1/stays/home', { headers: auth });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.data).toMatchObject({ recent_searches: [], deals: [] });
    });

    await test.step('promotions banners serve real rows via Go direct', async () => {
      // No BFF route exists for /api/v1/promotions — Go direct is the only path.
      const res = await goFetch(request, 'GET', '/api/v1/promotions/banners?module=marketplace', me.token);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.banners)).toBe(true);
    });
  });

  test('env-blocked legs report their true status', async ({ request }) => {
    const me = await provisionedSession(request, 'soc-001b');
    const auth = bearer(me.token);

    // GROUPS: backend flag on, frontend flag missing → BFF refuses 503.
    // The module itself is healthy — proven by the Go-direct leg (SOC-003).
    const groupsBff = await request.get('/api/v1/groups', { headers: auth });
    expect(groupsBff.status()).toBe(503);
    const groupsGo = await goFetch(request, 'GET', '/api/finance/groups', me.token);
    expect(groupsGo.status()).toBe(200);

    // P2P marketplace + SPRAY: FEATURE_P2P_MARKET_ENABLED unset in backend/.env
    // (defaults false) → RegisterP2PMarket never runs → 404 on every mount.
    // NOTE: the spray BFF ALSO maps to the wrong upstream base
    // (/api/finance/spray/* while Go mounts member spray under
    // /api/finance/p2p/spray*), so even with the flag on the BFF path needs a
    // mapping fix — recorded as a finding, not silently passed.
    const sprayBff = await request.post('/api/v1/spray/spray', { headers: auth, data: {} });
    expect([404, 503]).toContain(sprayBff.status());
    const sprayGo = await goFetch(request, 'GET', '/api/finance/p2p/spray/leaderboard/e2e-ctx', me.token);
    expect(sprayGo.status()).toBe(404); // flag off — route unmounted

    const p2pBff = await request.get('/api/v1/p2p/p2p/listings', { headers: auth });
    expect([404, 503]).toContain(p2pBff.status());
    const p2pGo = await goFetch(request, 'GET', '/api/finance/p2p/p2p/listings', me.token);
    expect(p2pGo.status()).toBe(404);
  });
});
