/**
 * ADMIN-004 — audit / activity views.
 *
 * Generates attributed entries THIS RUN (a provisioned user's success+failed
 * logins → login_activity; an admin suspend+unsuspend → audit_logs), then
 * verifies the console surfaces them — with identity, not anonymous rows.
 * Security Events is checked for an honest render (rows or a real empty
 * state); session-hardening (the only security_events writer) is off in this
 * env, so an empty table is expected data, not a failure.
 */
import { expect, test } from '@playwright/test';
import {
  ADMIN_WEB_URL,
  adminAccessToken,
  adminApiSend,
  adminLoginViaUi,
} from './helpers';
import { provisionVerifiedUser, psql } from '../auth/helpers';
import { loginViaApi } from '../helpers/auth';

test.describe('ADMIN-004: audit & activity views', () => {
  test('login activity + audit logs show this run\u2019s attributed entries; security events renders', async ({
    page,
    context,
    request,
  }) => {
    const victim = await provisionVerifiedUser(request, 'e2e-admin-audit');
    const adminToken = await adminAccessToken(context, request);

    await test.step('generate attributed login_activity + audit rows', async () => {
      // Success login (writes login_activity with user_id/email post-fix).
      const ok = await request.post('/api/auth/login', {
        data: { identifier: victim.email, password: victim.password },
      });
      expect(ok.status()).toBe(200);
      // Failed login → a second, differently-statused row.
      const bad = await request.post('/api/auth/login', {
        data: { identifier: victim.email, password: 'WrongPass999!' },
      });
      test.info().annotations.push({ type: 'bad-login', description: `${bad.status()}` });
      // Admin mutations → audit_logs rows attributed actor→target.
      const sus = await adminApiSend(request, 'PATCH', `/api/admin/users/${victim.userId}/suspend`, adminToken);
      expect(sus.status()).toBe(200);
      const unsus = await adminApiSend(request, 'PATCH', `/api/admin/users/${victim.userId}/unsuspend`, adminToken);
      expect(unsus.status()).toBe(200);
    });

    await test.step('DB sanity: rows landed with identity', async () => {
      const activity = psql(
        `select count(*) from public.login_activity where email='${victim.email}'`,
      );
      const audits = psql(
        `select string_agg(action, ',') from public.audit_logs where target_user_id='${victim.userId}'`,
      );
      test.info().annotations.push(
        { type: 'db-login-activity', description: `rows=${activity}` },
        { type: 'db-audit-actions', description: audits },
      );
      expect(Number(activity)).toBeGreaterThanOrEqual(1);
      expect(audits).toContain('user.suspend');
      expect(audits).toContain('user.unsuspend');
    });

    await adminLoginViaUi(page);

    await test.step('Login Activity page shows the attributed rows', async () => {
      await page.goto(`${ADMIN_WEB_URL}/admin/login-activity`);
      await expect(page.getByRole('heading', { name: /login activity/i })).toBeVisible({ timeout: 30_000 });
      await page.locator('input[placeholder="Email"]').fill(victim.email);
      await page.getByRole('button', { name: /apply filters/i }).click();
      // The email column must carry the user's email — not an anonymous row.
      await expect(page.locator('tbody td', { hasText: victim.email }).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step('Audit Logs page shows the suspend actions', async () => {
      await page.goto(`${ADMIN_WEB_URL}/admin/audit-logs`);
      await expect(page.getByRole('heading', { name: /audit logs/i })).toBeVisible({ timeout: 30_000 });
      await page.locator('input[placeholder="Action"]').fill('user.suspend');
      await page.getByRole('button', { name: /apply filters/i }).click();
      const row = page.locator('tbody tr', { hasText: 'user.suspend' }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      // Actor / Target cell carries the target user id for our victim.
      await expect(page.locator('tbody', { hasText: victim.userId })).toBeVisible();
    });

    await test.step('Security Events page renders (rows or honest empty state)', async () => {
      await page.goto(`${ADMIN_WEB_URL}/admin/security-events`);
      await expect(page.getByRole('heading', { name: /security events/i })).toBeVisible({ timeout: 30_000 });
      const dbCount = Number(psql(`select count(*) from public.security_events`));
      const empty = page.getByText(/no security events to display/i);
      const rows = page.locator('tbody tr');
      await expect(async () => {
        const hasEmpty = await empty.isVisible().catch(() => false);
        const rowCount = await rows.count();
        expect(hasEmpty || rowCount > 0).toBeTruthy();
      }).toPass({ timeout: 20_000 });
      test.info().annotations.push({
        type: 'security-events',
        description: `db rows=${dbCount} (FEATURE_SESSION_HARDENING off → writers disabled)`,
      });
    });
  });
});
