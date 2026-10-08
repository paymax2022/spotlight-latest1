/**
 * SOC-006 — edge probes across the connect/social cluster.
 *
 *   - anonymous mutation → 401 (BFF auth gate) for every module that has a BFF
 *     surface; groups BFF answers 503 instead because the flag check runs
 *     before the auth check (ordering observation, both are refusals).
 *   - cross-user write → 403 (B cannot edit A's listing; a member cannot
 *     invite into a group they don't own).
 *   - deleted / nonexistent resource → 404 where the API promises it, including
 *     marketplace GET /listings/:id on a removed listing — previously it still
 *     returned 200 with status "removed_user" (soft-delete leaked the resource
 *     to public readers); fixed by the tombstone gate in
 *     backend/internal/marketplace/handler.go GetListing (E2E-SOC-037).
 *   - self-like and like-to-nonexistent-profile are refused 400s, not 5xxs.
 */

import { expect, test } from '@playwright/test';
import { bearer, goFetch, provisionedSession } from './helpers';

test.describe('SOC-006: edge cases', () => {
  test('anonymous mutations are refused', async ({ request }) => {
    const cases: Array<{ method: 'POST' | 'PUT' | 'DELETE'; url: string; want: number }> = [
      { method: 'POST', url: '/api/v1/marketplace/listings', want: 401 },
      { method: 'POST', url: '/api/v1/connect/likes', want: 401 },
      { method: 'POST', url: '/api/v1/connect/discovery/swipe', want: 401 },
      { method: 'POST', url: '/api/v1/social/social/handle', want: 401 },
      { method: 'POST', url: '/api/v1/social/social/send', want: 401 },
      { method: 'POST', url: '/api/v1/creators/creators/apply', want: 401 },
      // Flag gate fires before auth gate in this BFF route — still a refusal.
      { method: 'POST', url: '/api/v1/groups', want: 503 },
    ];
    for (const c of cases) {
      const res = await request.fetch(c.url, {
        method: c.method,
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      expect(res.status(), `${c.method} ${c.url}`).toBe(c.want);
    }
  });

  test('user B cannot mutate user A resources (403)', async ({ request }) => {
    const a = await provisionedSession(request, 'soc-006a');
    const b = await provisionedSession(request, 'soc-006b');
    const authA = bearer(a.token);
    const authB = bearer(b.token);

    // A owns a listing.
    const cats = (await (await request.get('/api/v1/marketplace/categories')).json()).data;
    const created = await request.post('/api/v1/marketplace/listings', {
      headers: authA,
      data: {
        category_id: cats[0].id,
        title: `SOC006 Owned ${Date.now() % 100000}`,
        description: 'A listing that belongs to user A exclusively for this test',
        price_kobo: 100_000,
        condition: 'used',
        state: 'Lagos',
      },
    });
    const listingId = (await created.json()).data.id;

    const hijack = await request.fetch(`/api/v1/marketplace/listings/${listingId}`, {
      method: 'PUT',
      headers: { ...authB, 'Content-Type': 'application/json' },
      data: { title: 'hijacked by B' },
    });
    expect(hijack.status()).toBe(403);

    const del = await request.fetch(`/api/v1/marketplace/listings/${listingId}`, {
      method: 'DELETE',
      headers: authB,
    });
    expect(del.status()).toBe(403);

    // Group: B (not owner, not member) cannot invite into A's group.
    const g = await goFetch(request, 'POST', '/api/finance/groups', a.token, {
      name: `SOC006 G ${Date.now() % 100000}`,
      is_public: true,
    });
    const gid = (await g.json()).id;
    const invite = await goFetch(
      request,
      'POST',
      `/api/finance/groups/${gid}/invite`,
      b.token,
      { user_id: b.userId },
    );
    expect(invite.status()).toBe(403);
  });

  test('nonexistent + soft-deleted resources behave as documented', async ({ request }) => {
    const a = await provisionedSession(request, 'soc-006d');
    const authA = bearer(a.token);
    const missing = '11111111-1111-4111-8111-111111111111';

    // Clean 404s for resources that never existed.
    expect(
      (await request.get(`/api/v1/marketplace/listings/${missing}`)).status(),
    ).toBe(404);
    expect((await goFetch(request, 'GET', `/api/finance/groups/${missing}`, a.token)).status()).toBe(404);

    // Create + delete a listing: DELETE succeeds and is a SOFT delete —
    // status flips to removed_user, search drops it, and the public detail
    // read now 404s too (E2E-SOC-037: it used to serve 200 with the tombstone).
    const cats = (await (await request.get('/api/v1/marketplace/categories')).json()).data;
    const created = await request.post('/api/v1/marketplace/listings', {
      headers: authA,
      data: {
        category_id: cats[0].id,
        title: `SOC006 Deletable ${Date.now() % 100000}`,
        description: 'A listing created only to be deleted again',
        price_kobo: 50_000,
        condition: 'used',
        state: 'Lagos',
      },
    });
    const lid = (await created.json()).data.id;

    const del = await request.fetch(`/api/v1/marketplace/listings/${lid}`, {
      method: 'DELETE',
      headers: authA,
    });
    expect(del.status()).toBe(200);

    const after = await request.get(`/api/v1/marketplace/listings/${lid}`);
    expect(after.status()).toBe(404); // removed tombstone must not be publicly readable

    const search = await request.get('/api/v1/marketplace/search?q=SOC006+Deletable');
    const results = (await search.json()).data.results;
    expect(results.some((r: { id: string }) => r.id === lid)).toBe(false);
  });

  test('refused domain actions return clean 4xx, not 5xx', async ({ request }) => {
    const a = await provisionedSession(request, 'soc-006e');
    const authA = bearer(a.token);

    const profile = await request.get('/api/v1/connect/profile', { headers: authA });
    const pid = (await profile.json()).data.id;

    const selfLike = await request.post('/api/v1/connect/likes', {
      headers: authA,
      data: { to_profile: pid },
    });
    expect(selfLike.status()).toBe(400); // self-like refused

    const ghostLike = await request.post('/api/v1/connect/likes', {
      headers: authA,
      data: { to_profile: '11111111-1111-4111-8111-111111111111' },
    });
    expect(ghostLike.status()).toBe(400); // nonexistent target refused

    const badMode = await request.patch('/api/v1/connect/profile/modes/bogus', {
      headers: authA,
      data: { visible: true },
    });
    expect(badMode.status()).toBe(400); // invalid mode enum
  });
});
