/**
 * SOC-003 — groups (community): create → invite → membership rows → visibility.
 *
 * BFF leg: GET/POST /api/v1/groups is 503 — FEATURE_GROUPS_ENABLED is set in
 * backend/.env but MISSING from frontend-web/.env.local (env skew; recorded in
 * results/social.md). The group lifecycle is therefore driven against the real
 * Go API on :8080 — the same surface the mobile app consumes (member group
 * /api/finance/groups).
 *
 * Contract gap discovered and documented: the module exposes
 * create / list / get / invite / dues ONLY. There is NO self-serve join,
 * NO leave, NO member-list endpoint — membership changes are owner-invite only
 * and membership state is verifiable via group_members + member_count.
 * The scoped "join → member list → leave" journey is therefore exercised as
 * "invite → member rows → count", with the missing ops noted as a gap.
 */

import { expect, test } from '@playwright/test';
import { bearer, goFetch, provisionedSession, psql } from './helpers';

test.describe('SOC-003: groups lifecycle', () => {
  test('owner creates, invites a second user; non-owner invite refused', async ({
    request,
  }) => {
    const owner = await provisionedSession(request, 'soc-003a');
    const joiner = await provisionedSession(request, 'soc-003b');
    const stranger = await provisionedSession(request, 'soc-003c');

    await test.step('BFF surface is flag-blocked (env skew)', async () => {
      const res = await request.get('/api/v1/groups', { headers: bearer(owner.token) });
      expect(res.status()).toBe(503);
    });

    let groupId = '';

    await test.step('owner creates a public group', async () => {
      const res = await goFetch(request, 'POST', '/api/finance/groups', owner.token, {
        name: `SOC003 Group ${Date.now() % 100000}`,
        description: 'e2e group',
        is_public: true,
      });
      expect(res.status()).toBe(201);
      const g = await res.json();
      groupId = g.id;
      expect(g.created_by).toBe(owner.userId);
      // The owner is inserted as a member row at create time.
      expect(
        psql(
          `select role from group_members where group_id='${groupId}' and user_id='${owner.userId}';`,
        ),
      ).toBe('owner');
    });

    await test.step('owner invites the second user', async () => {
      const res = await goFetch(
        request,
        'POST',
        `/api/finance/groups/${groupId}/invite`,
        owner.token,
        { user_id: joiner.userId },
      );
      expect(res.status()).toBe(200);
      expect(
        psql(
          `select role from group_members where group_id='${groupId}' and user_id='${joiner.userId}';`,
        ),
      ).toBe('member');
    });

    await test.step('member list equivalent: count + rows agree', async () => {
      // No member-list endpoint exists (contract gap) — member_count on GET
      // and the group_members rows are the membership surface.
      const res = await goFetch(request, 'GET', `/api/finance/groups/${groupId}`, owner.token);
      expect(res.status()).toBe(200);
      expect((await res.json()).member_count).toBe(2);
      expect(
        psql(`select count(*) from group_members where group_id='${groupId}';`),
      ).toBe('2');
    });

    await test.step('cross-user visibility: joiner sees it in own list, stranger does not become a member', async () => {
      const mine = await goFetch(request, 'GET', '/api/finance/groups', joiner.token);
      expect(mine.status()).toBe(200);
      const groups = (await mine.json()).data ?? [];
      expect(groups.some((g: { id: string }) => g.id === groupId)).toBe(true);

      // Public group detail IS readable by a non-member (is_public boundary).
      const detail = await goFetch(request, 'GET', `/api/finance/groups/${groupId}`, stranger.token);
      expect(detail.status()).toBe(200);
      // …but the stranger holds no membership row.
      expect(
        psql(
          `select count(*) from group_members where group_id='${groupId}' and user_id='${stranger.userId}';`,
        ),
      ).toBe('0');
    });

    await test.step('non-owner cannot invite (403)', async () => {
      const res = await goFetch(
        request,
        'POST',
        `/api/finance/groups/${groupId}/invite`,
        joiner.token,
        { user_id: stranger.userId },
      );
      expect(res.status()).toBe(403);
      expect(
        psql(`select count(*) from group_members where group_id='${groupId}';`),
      ).toBe('2');
    });
  });
});
