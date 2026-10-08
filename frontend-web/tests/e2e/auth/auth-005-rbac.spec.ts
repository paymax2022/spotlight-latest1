/**
 * AUTH-005 — RBAC surface.
 *
 * Fixture: qa-claude-test@spotlight.internal holds registered-user +
 * verified-user roles only (verified in public.user_roles — NOT an admin).
 *
 *   Web:   /admin on :3000 (middleware-gated but no page exists in this app)
 *          and the separate admin console on :3001 must refuse a non-admin.
 *   API:   admin endpoints on :8080 — anonymous → 401, non-admin user → 403.
 */

import { expect, test } from '@playwright/test';
import { ADMIN_API_KEY, ADMIN_WEB_URL, GO_BACKEND_URL, provisionVerifiedUser, psql } from './helpers';
import { TEST_USER, loginViaApi } from '../helpers/auth';

// admin@spotlight.internal is the console-admin fixture (super-admin in
// public.user_roles) — positive control for the keyed probes.
const ADMIN_USER = { email: 'admin@spotlight.internal', password: TEST_USER.password };

const ADMIN_API_PROBES = [
  '/api/v1/admin/menu-counts',
  '/api/v1/admin/leads',
  '/api/v1/admin/dashboard',
  '/api/admin/users',
  '/api/admin/login-activity',
];

test.describe('AUTH-005: RBAC surface', () => {
  test('fixture role check + admin API probes + admin-console web gate', async ({
    page,
    context,
    request,
  }) => {
    await test.step('qa-claude-test is confirmed non-admin in the DB', async () => {
      const roles = psql(
        `select string_agg(r.slug, ',' order by r.slug) from public.user_roles ur` +
          ` join public.roles r on r.id = ur.role_id` +
          ` join public.platform_users pu on pu.id = ur.user_id` +
          ` where pu.email = '${TEST_USER.email}' and ur.is_active`,
      );
      test.info().annotations.push({ type: 'roles', description: roles });
      expect(roles).not.toMatch(/super-admin|system-admin|^admin$|admin,/);
    });

    // adminGroup's chain is RequireAdmin (x-admin-api-key) THEN
    // RequireAdminConsoleRole (verified bearer + console role). Each gate is
    // probed separately: without the key every caller dies at gate 1 (401);
    // with the key a non-admin reaches gate 2 and gets 403.
    await test.step('anonymous admin API probes → 401 (API-key gate)', async () => {
      for (const path of ADMIN_API_PROBES) {
        const res = await request.get(`${GO_BACKEND_URL}${path}`);
        test.info().annotations.push({
          type: 'anon-probe',
          description: `${path} → ${res.status()}`,
        });
        expect(res.status(), `anon ${path}`).toBe(401);
      }
    });

    const { accessToken } = await test.step('non-admin login', async () => {
      return loginViaApi(context, request, TEST_USER);
    });

    await test.step('user token without API key → 401 (still fails gate 1)', async () => {
      const res = await request.get(`${GO_BACKEND_URL}${ADMIN_API_PROBES[0]}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status(), `user no-key ${ADMIN_API_PROBES[0]}`).toBe(401);
    });

    await test.step('non-admin user-token + API key → 403 (role gate)', async () => {
      for (const path of ADMIN_API_PROBES) {
        const res = await request.get(`${GO_BACKEND_URL}${path}`, {
          headers: { Authorization: `Bearer ${accessToken}`, 'x-admin-api-key': ADMIN_API_KEY },
        });
        const body = await res.text().catch(() => '');
        test.info().annotations.push({
          type: 'user-probe',
          description: `${path} → ${res.status()} :: ${body.slice(0, 120)}`,
        });
        expect(res.status(), `user+key ${path}`).toBe(403);
      }
    });

    await test.step('console-admin token + API key → 2xx (positive control)', async () => {
      const { accessToken: adminToken } = await loginViaApi(context, request, ADMIN_USER);
      const res = await request.get(`${GO_BACKEND_URL}${ADMIN_API_PROBES[0]}`, {
        headers: { Authorization: `Bearer ${adminToken}`, 'x-admin-api-key': ADMIN_API_KEY },
      });
      const body = await res.text().catch(() => '');
      test.info().annotations.push({
        type: 'admin-probe',
        description: `${ADMIN_API_PROBES[0]} → ${res.status()} :: ${body.slice(0, 120)}`,
      });
      expect(res.status(), `admin+key ${ADMIN_API_PROBES[0]}`).toBe(200);
    });

    await test.step('/admin on the user-facing web app', async () => {
      // src/middleware.ts gates /admin/* on authentication only; the app
      // itself ships no /admin pages (admin console is frontend-admin :3001).
      const res = await page.goto('/admin');
      test.info().annotations.push({
        type: 'web-admin',
        description: `GET /admin → ${res?.status()} ${page.url()}`,
      });
    });

    await test.step('admin console (:3001) — fixture is refused (backend RBAC verdict)', async () => {
      // qa-claude-test has NO admin role in public.user_roles (the store the Go
      // backend enforces — proven above by the 403s), but user_profiles.role
      // says 'admin'. signInAdmin() now asks the BACKEND-enforced gate
      // (RequireAdminConsoleRole on /api/v1/admin/menu-counts via the
      // admin-proxy) rather than trusting the profile store, so this account
      // must see the same denial UX as any non-admin (E2E-AUTH-008).
      await page.goto(`${ADMIN_WEB_URL}/admin/login`);
      const user = page.locator('input').first();
      const pass = page.locator('input[type="password"]');
      await expect(user).toBeVisible({ timeout: 20_000 });
      await user.fill(TEST_USER.email);
      await pass.fill(TEST_USER.password);
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      const denied = page.getByText(/access denied|admin privileges/i);
      const denialShown = await denied.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
      console.log('[AUTH-005 admin-console fixture]', `denial=${denialShown}`, `landed=${page.url()}`);
      test.info().annotations.push({
        type: 'admin-console-fixture',
        description: `denialShown=${denialShown} landed=${page.url()}`,
      });
      expect(denialShown).toBeTruthy();
      expect(page.url()).toContain('/admin/login');
    });

    await test.step('admin console (:3001) — fresh standard user is refused', async () => {
      const standard = await provisionVerifiedUser(request, 'e2e-rbac');
      // Clear the fixture's admin session (cookie + localStorage) first.
      await page.context().clearCookies();
      await page.goto(`${ADMIN_WEB_URL}/admin/login`);
      await page.evaluate(() => window.localStorage.clear());
      await page.reload();
      const user = page.locator('input').first();
      const pass = page.locator('input[type="password"]');
      await user.fill(standard.email);
      await pass.fill(standard.password);
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      // Expect a visible denial and to stay on /admin/login.
      const denied = page.getByText(/access denied|admin privileges/i);
      const bounced = page.waitForURL(/admin\/login/, { timeout: 20_000 }).then(() => true).catch(() => false);
      const denialShown = await denied.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
      console.log('[AUTH-005 admin-console standard]', `denial=${denialShown}`, `landed=${page.url()}`);
      test.info().annotations.push({
        type: 'admin-console-standard',
        description: `denialShown=${denialShown} bounced=${await bounced} landed=${page.url()}`,
      });
      expect(denialShown).toBeTruthy();
      expect(page.url()).toContain('/admin/login');
    });

    await test.step('admin-proxy upstream health', async () => {
      // The console's server-side proxy target — record whether admin API
      // calls through :3001 can reach :8080 at all.
      const res = await request.get(`${ADMIN_WEB_URL}/api/admin-proxy/api/v1/admin/menu-counts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.text().catch(() => '');
      console.log('[AUTH-005 admin-proxy]', res.status(), body.slice(0, 120));
      test.info().annotations.push({
        type: 'admin-proxy',
        description: `${res.status()} ${body.slice(0, 120)}`,
      });
    });
  });
});
