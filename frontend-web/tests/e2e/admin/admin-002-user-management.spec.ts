/**
 * ADMIN-002 — user management.
 *
 * Journey: Users page lists real users → find a provisioned user → suspend via
 * the UI → verify platform_users.status flipped AND the user's API login is
 * denied → unsuspend → status + login recovered.
 *
 * Isolation: all mutations hit a user this run provisioned; the admin fixture
 * only logs in.
 */
import { expect, test } from '@playwright/test';
import { ADMIN_WEB_URL, adminLoginViaUi } from './helpers';
import { provisionVerifiedUser, psql } from '../auth/helpers';

test.describe('ADMIN-002: user management', () => {
  test('list → suspend → login denied → unsuspend → login restored', async ({
    page,
    request,
  }) => {
    const victim = await provisionVerifiedUser(request, 'e2e-admin-suspend');
    test.info().annotations.push({ type: 'victim', description: `${victim.email} (${victim.userId})` });

    await adminLoginViaUi(page);
    await page.goto(`${ADMIN_WEB_URL}/admin/users`);

    await test.step('user list renders real users', async () => {
      // The list is loaded from GET /api/admin/users (via admin-proxy).
      await expect(page.getByRole('heading', { name: /users management/i })).toBeVisible({ timeout: 30_000 });
      // The "Total: N" counter renders 0 while the fetch is in flight — wait
      // for the load to finish (a real row or the loader clearing) first.
      await expect(
        page.locator('tbody td', { hasText: /@/ }).first(),
      ).toBeVisible({ timeout: 30_000 });
      // "Total: N · Suspended: x · Locked: y" — N must be non-zero real data.
      const totalLine = page.getByText(/^Total: \d+/);
      await expect(totalLine).toBeVisible({ timeout: 30_000 });
      const total = Number((await totalLine.innerText()).match(/Total: (\d+)/)?.[1]);
      const dbCount = Number(psql(`select count(*) from public.platform_users`));
      test.info().annotations.push({
        type: 'users-total',
        description: `ui total=${total} db platform_users=${dbCount}`,
      });
      expect(total).toBeGreaterThan(0);
    });

    await test.step('find the provisioned user via the Search filter', async () => {
      await page.locator('input[placeholder="Search"]').fill(victim.email);
      await page.getByRole('button', { name: /apply filters/i }).click();
      const row = page.locator('tbody tr', { hasText: victim.email });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.click();
      // Detail panel populates (Selected User card) with the same email data.
      await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible({ timeout: 15_000 });
    });

    await test.step('suspend via UI → toast + DB flip', async () => {
      await page.getByRole('button', { name: 'Suspend', exact: true }).click();
      await expect(page.getByText(/suspend succeeded/i)).toBeVisible({ timeout: 20_000 });
      const status = psql(`select status from public.platform_users where id='${victim.userId}'`);
      test.info().annotations.push({ type: 'post-suspend-status', description: status });
      expect(status).toBe('suspended');
    });

    await test.step('suspended user login is denied', async () => {
      const res = await request.post('/api/auth/login', {
        data: { identifier: victim.email, password: victim.password },
      });
      const body = await res.json().catch(() => ({}));
      test.info().annotations.push({
        type: 'suspended-login',
        description: `status=${res.status()} body=${JSON.stringify(body).slice(0, 200)}`,
      });
      expect(res.ok(), 'suspended user must not log in').toBeFalsy();
    });

    await test.step('unsuspend via UI → status active + login works', async () => {
      await page.getByRole('button', { name: 'Unsuspend', exact: true }).click();
      await expect(page.getByText(/unsuspend succeeded/i)).toBeVisible({ timeout: 20_000 });
      const status = psql(`select status from public.platform_users where id='${victim.userId}'`);
      test.info().annotations.push({ type: 'post-unsuspend-status', description: status });
      expect(status).toBe('active');

      const res = await request.post('/api/auth/login', {
        data: { identifier: victim.email, password: victim.password },
      });
      const body = await res.json().catch(() => ({}));
      test.info().annotations.push({
        type: 'restored-login',
        description: `status=${res.status()}`,
      });
      expect(res.status(), 'unsuspended user must log in').toBe(200);
      expect(body?.session?.access_token).toBeTruthy();
    });
  });
});
