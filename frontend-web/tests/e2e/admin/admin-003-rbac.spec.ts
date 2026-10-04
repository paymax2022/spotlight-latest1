/**
 * ADMIN-003 — role/permission surfaces + role assignment.
 *
 *   1. /admin/roles renders real roles — "Showing 1–12 of N" matches
 *      public.roles, and a known role slug is reachable via the filter.
 *   2. /admin/permissions renders real permissions (count matches public.permissions).
 *   3. Assign the low-privilege `judge` role to a provisioned user via the
 *      admin API → public.user_roles row exists → the user's bearer now passes
 *      a contestant.view-gated probe (GET /api/v1/admin/registrations).
 *      Remove the role → row gone → probe 403s again.
 *
 * Never touches system roles or the admin fixture.
 */
import { expect, test } from '@playwright/test';
import {
  ADMIN_WEB_URL,
  adminApiGet,
  adminApiSend,
  adminAccessToken,
  adminLoginViaUi,
  apiGetAs,
} from './helpers';
import { provisionVerifiedUser, psql } from '../auth/helpers';
import { loginViaApi } from '../helpers/auth';

const ROLE_PROBE_ENDPOINT = '/api/v1/admin/registrations'; // RequirePermission("contestant.view")

test.describe('ADMIN-003: roles, permissions, role assignment', () => {
  test('roles + permissions pages reconcile with DB; assign/remove judge role', async ({
    page,
    context,
    request,
  }) => {
    const adminToken = await adminAccessToken(context, request);

    await test.step('/admin/roles renders real roles (count matches public.roles)', async () => {
      await adminLoginViaUi(page);
      await page.goto(`${ADMIN_WEB_URL}/admin/roles`);
      await expect(page.getByRole('heading', { name: /role management/i })).toBeVisible({ timeout: 30_000 });
      const dbRoles = Number(psql(`select count(*) from public.roles`));
      // Cross-check the API the page consumed.
      const apiRes = await adminApiGet(request, '/api/admin/roles', adminToken);
      expect(apiRes.status()).toBe(200);
      const apiRoles = (await apiRes.json())?.roles ?? [];
      test.info().annotations.push({
        type: 'roles-count',
        description: `db=${dbRoles} api=${apiRoles.length}`,
      });
      await expect(page.getByText(new RegExp(`of ${apiRoles.length}\\b`))).toBeVisible({ timeout: 20_000 });
      expect(apiRoles.length).toBe(dbRoles);
      // Known seeded role is reachable through the filter.
      await page.locator('input[placeholder="Filter roles"]').fill('judge');
      await page.getByRole('button', { name: /^filter$/i }).click();
      await expect(page.locator('tbody td', { hasText: 'judge' }).first()).toBeVisible({ timeout: 15_000 });
    });

    await test.step('/admin/permissions renders real permissions', async () => {
      await page.goto(`${ADMIN_WEB_URL}/admin/permissions`);
      await expect(page.getByRole('heading', { name: /permission/i }).first()).toBeVisible({ timeout: 30_000 });
      const dbPerms = Number(psql(`select count(*) from public.permissions`));
      const apiRes = await adminApiGet(request, '/api/admin/permissions', adminToken);
      expect(apiRes.status()).toBe(200);
      const apiPerms = (await apiRes.json())?.permissions ?? [];
      test.info().annotations.push({
        type: 'perms-count',
        description: `db=${dbPerms} api=${apiPerms.length}`,
      });
      await expect(page.getByText(new RegExp(`of ${apiPerms.length}\\b`))).toBeVisible({ timeout: 20_000 });
      expect(apiPerms.length).toBe(dbPerms);
    });

    const victim = await provisionVerifiedUser(request, 'e2e-admin-role');

    await test.step('baseline: user probe is denied before the grant', async () => {
      const { accessToken } = await loginViaApi(context, request, {
        email: victim.email,
        password: victim.password,
      });
      const res = await apiGetAs(request, ROLE_PROBE_ENDPOINT, accessToken);
      test.info().annotations.push({
        type: 'pre-grant-probe',
        description: `${ROLE_PROBE_ENDPOINT} → ${res.status()}`,
      });
      expect(res.status()).toBe(403);
    });

    const judgeRoleId = psql(`select id from public.roles where slug='judge'`);
    expect(judgeRoleId).toBeTruthy();

    await test.step('assign judge role via admin API', async () => {
      const res = await adminApiSend(request, 'POST', `/api/admin/users/${victim.userId}/roles`, adminToken, {
        roleId: judgeRoleId,
      });
      const body = await res.text().catch(() => '');
      test.info().annotations.push({
        type: 'assign',
        description: `${res.status()} ${body.slice(0, 160)}`,
      });
      expect(res.status()).toBe(200);
      const row = psql(
        `select count(*) from public.user_roles where user_id='${victim.userId}' and role_id='${judgeRoleId}' and is_active`,
      );
      expect(Number(row)).toBe(1);
    });

    await test.step('effective permission: probe now passes', async () => {
      const { accessToken } = await loginViaApi(context, request, {
        email: victim.email,
        password: victim.password,
      });
      const res = await apiGetAs(request, ROLE_PROBE_ENDPOINT, accessToken);
      test.info().annotations.push({
        type: 'post-grant-probe',
        description: `${ROLE_PROBE_ENDPOINT} → ${res.status()}`,
      });
      expect(res.status()).toBe(200);
    });

    await test.step('remove role → row gone + probe denied again', async () => {
      const res = await adminApiSend(
        request,
        'DELETE',
        `/api/admin/users/${victim.userId}/roles/${judgeRoleId}`,
        adminToken,
      );
      expect(res.status()).toBe(200);
      const row = psql(
        `select count(*) from public.user_roles where user_id='${victim.userId}' and role_id='${judgeRoleId}' and is_active`,
      );
      expect(Number(row)).toBe(0);
      const { accessToken } = await loginViaApi(context, request, {
        email: victim.email,
        password: victim.password,
      });
      const probe = await apiGetAs(request, ROLE_PROBE_ENDPOINT, accessToken);
      test.info().annotations.push({
        type: 'post-remove-probe',
        description: `${ROLE_PROBE_ENDPOINT} → ${probe.status()}`,
      });
      expect(probe.status()).toBe(403);
    });
  });
});
