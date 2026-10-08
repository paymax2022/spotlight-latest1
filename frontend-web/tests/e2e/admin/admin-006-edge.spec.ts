/**
 * ADMIN-006 — scoped-access check + edge cases.
 *
 *   - Scoped admin: does the seed have a scoped admin role assignment
 *     (user_roles.scope_type != 'global')? If none is seeded → UNVERIFIED
 *     (recorded, not faked).
 *   - Edge 1: /api/admin-proxy with no sb-admin-token cookie → 401.
 *   - Edge 2: an authenticated console page bounces to /admin/login once the
 *     session cookie is gone (middleware is the gate, not localStorage).
 */
import { expect, test } from '@playwright/test';
import { ADMIN_WEB_URL, adminLoginViaUi } from './helpers';
import { psql } from '../auth/helpers';

test.describe('ADMIN-006: scoped access + edge cases', () => {
  test('scoped-admin presence check', async () => {
    const scoped = psql(
      `select count(*) from public.user_roles where is_active and scope_type is not null and scope_type <> 'global'`,
    );
    const scopedRoles = psql(
      `select slug, role_type from public.roles where slug in ('contest-manager','state-coordinator') order by slug`,
    );
    test.info().annotations.push(
      { type: 'scoped-roles-seeded', description: scopedRoles || 'none' },
      { type: 'scoped-assignments', description: `non-global user_roles rows=${scoped}` },
    );
    // A scoped ADMIN (operator with a non-global console role) is what the
    // scoped-access journey needs. Seed has role definitions but no
    // non-global assignments → the journey is UNVERIFIED, not faked.
    test.skip(Number(scoped) === 0, 'no scoped admin assignment seeded — UNVERIFIED');
  });

  test('admin-proxy without session cookie → 401', async ({ request }) => {
    const res = await request.get(`${ADMIN_WEB_URL}/api/admin-proxy/api/v1/admin/menu-counts`);
    const body = await res.json().catch(() => ({}));
    test.info().annotations.push({
      type: 'anon-proxy',
      description: `${res.status()} ${JSON.stringify(body).slice(0, 120)}`,
    });
    expect(res.status()).toBe(401);
  });

  test('admin-proxy with a forged cookie → 401', async ({ request }) => {
    const res = await request.get(`${ADMIN_WEB_URL}/api/admin-proxy/api/v1/admin/menu-counts`, {
      headers: { Cookie: 'sb-admin-token=not.a.real.jwt' },
    });
    expect(res.status()).toBe(401);
  });

  test('console page bounces to /admin/login after session loss', async ({ page, context }) => {
    await adminLoginViaUi(page);
    await page.goto(`${ADMIN_WEB_URL}/admin/users`);
    await expect(page.getByRole('heading', { name: /users management/i })).toBeVisible({ timeout: 30_000 });

    await context.clearCookies();
    await page.goto(`${ADMIN_WEB_URL}/admin/roles`);
    await page.waitForURL(/\/admin\/login/, { timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/admin/login');
    test.info().annotations.push({
      type: 'post-clear-landing',
      description: page.url(),
    });

    // Observation (not scored): the login page runs syncAdminSession() on
    // mount, which re-mirrors the still-live Supabase session into a fresh
    // sb-admin-token cookie — so cookie-clear alone is a bounce, not a
    // sign-out, while localStorage's supabase session survives.
    await page.waitForTimeout(2_000);
    const cookies = await context.cookies(ADMIN_WEB_URL);
    const reminted = cookies.some((c) => c.name === 'sb-admin-token');
    test.info().annotations.push({
      type: 'cookie-reminted',
      description: `sb-admin-token re-minted after clear: ${reminted}`,
    });
  });
});
