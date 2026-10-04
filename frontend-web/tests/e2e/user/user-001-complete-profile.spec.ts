/**
 * USER-001 — complete profile.
 *
 * The backend contract lists POST /api/auth/complete-profile (Go
 * router.go:159). There is NO BFF route for it and no frontend caller — the
 * web's real profile-completion surface is /profile → GET/PUT
 * /api/me/profile (components/user/ProfileEditorClient.tsx).
 *
 * Journey:
 *   provision verified user → API login → /profile UI → fill name fields →
 *   Save Profile → PUT 200 → "Profile saved." → GET /api/me/profile shows the
 *   values → psql user_profiles confirms persisted rows.
 * Probes:
 *   unauth GET/PUT /api/me/profile → 401
 *   Go POST /api/auth/complete-profile unauth → 401, authed → 200
 *   (contract endpoint exists but is orphaned from the web product)
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { GO_BACKEND_URL, provisionVerifiedUser, psql } from '../auth/helpers';

test.describe('USER-001: complete profile', () => {
  test('profile editor saves and persists; Go complete-profile probe', async ({
    page,
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'uprofile');
    const { accessToken } = await loginViaApi(context, request, {
      email: user.email,
      password: user.password,
    });

    const apiCalls: Array<{ url: string; status: number }> = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/')) apiCalls.push({ url: r.url(), status: r.status() });
    });

    await test.step('drive the /profile UI', async () => {
      await page.goto('/profile');
      await expect(page.getByText('Profile Completion:')).toBeVisible({ timeout: 30_000 });

      const firstName = `Ada${Date.now() % 10000}`;
      const lastName = 'E2ECheck';

      await page.locator('label', { hasText: 'First Name' }).locator('input').fill(firstName);
      await page.locator('label', { hasText: 'Last Name' }).locator('input').fill(lastName);
      await page.locator('label', { hasText: 'Display Name' }).locator('input').fill(`${firstName} ${lastName}`);

      const putPromise = page.waitForResponse(
        (r) => r.url().includes('/api/me/profile') && r.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: /save profile/i }).click();
      const putRes = await putPromise;
      expect(putRes.status()).toBe(200);
      await expect(page.getByText('Profile saved.')).toBeVisible();
    });

    await test.step('values persisted — API read-back + DB', async () => {
      const res = await request.get('/api/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.profile.firstName).toMatch(/^Ada\d+$/);
      expect(body.profile.lastName).toBe('E2ECheck');
      expect(Number(body.completion?.percentage ?? 0)).toBeGreaterThan(0);

      const dbName = psql(
        `select first_name || '|' || coalesce(last_name,'') from public.user_profiles where id='${user.userId}';`,
      );
      expect(dbName).toMatch(/^Ada\d+\|E2ECheck$/);
    });

    await test.step('unauthenticated probes → 401', async () => {
      const g = await request.get('/api/me/profile');
      expect(g.status()).toBe(401);
      const p = await request.put('/api/me/profile', { data: { firstName: 'X' } });
      expect(p.status()).toBe(401);
    });

    await test.step('Go complete-profile contract endpoint probe', async () => {
      // Unauthenticated → 401.
      const unauth = await request.post(`${GO_BACKEND_URL}/api/auth/complete-profile`, {
        data: { profileType: 'artist' },
      });
      expect(unauth.status()).toBe(401);

      // Authenticated → 200 (writes profiles row + audit event server-side).
      const authed = await request.post(`${GO_BACKEND_URL}/api/auth/complete-profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { profileType: 'general_applicant', metadata: { source: 'e2e' } },
      });
      expect(authed.status()).toBe(200);
    });

    const fiveXx = apiCalls.filter((c) => c.status >= 500);
    test.info().annotations.push({
      type: 'api-traffic',
      description: apiCalls.map((c) => `${c.status} ${c.url}`).join(' | '),
    });
    expect(fiveXx, `5xx on profile page API calls: ${JSON.stringify(fiveXx)}`).toEqual([]);
  });
});
