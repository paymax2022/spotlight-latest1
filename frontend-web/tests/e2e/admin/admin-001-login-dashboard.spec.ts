/**
 * ADMIN-001 — console login + dashboard.
 *
 * Journey: UI login as admin@spotlight.internal on :3001 → land in the
 * console → dashboard + sidebar render with real data. While that happens we
 * capture every /api/admin-proxy response and assert none is a 5xx. Finally a
 * visible dashboard count is reconciled against the Go API's menu-counts.
 */
import { expect, test } from '@playwright/test';
import {
  ADMIN_API_KEY,
  ADMIN_USER,
  GO_BACKEND_URL,
  adminApiGet,
  adminLoginViaUi,
  upstreamOf,
  watchAdminProxy,
} from './helpers';
import { loginViaApi } from '../helpers/auth';

test.describe('ADMIN-001: console login + dashboard', () => {
  test('UI login lands in console; dashboard data matches API; no proxy 5xx', async ({
    page,
    context,
    request,
  }) => {
    const watcher = watchAdminProxy(page);

    await test.step('UI login as admin fixture → console', async () => {
      await adminLoginViaUi(page);
      expect(new URL(page.url()).pathname).toBe('/admin');
      // Sidebar chrome: the operator identity + a Log out control must render.
      await expect(page.getByRole('button', { name: /log out/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();
    });

    await test.step('dashboard renders real content', async () => {
      await expect(page.getByRole('heading', { name: /operations/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/needs attention/i)).toBeVisible();
    });

    const apiCounts = await test.step('fetch menu-counts direct from :8080 for reconciliation', async () => {
      const { accessToken } = await loginViaApi(context, request, ADMIN_USER);
      const res = await adminApiGet(request, '/api/v1/admin/menu-counts', accessToken);
      expect(res.status(), 'menu-counts via API').toBe(200);
      const body = await res.json();
      test.info().annotations.push({ type: 'menu-counts', description: JSON.stringify(body.counts) });
      return body.counts as Record<string, number>;
    });

    await test.step('visible dashboard count matches API (Contestants)', async () => {
      const expected = apiCounts.contestants;
      // The Contestants card shows the volume as a large figure inside the same
      // card div as the "Contestants" link.
      const card = page.locator('a', { hasText: 'Contestants' }).locator('xpath=..');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(expected.toLocaleString('en-NG'));
      test.info().annotations.push({
        type: 'count-check',
        description: `dashboard Contestants=${expected} == api menu-counts.contestants`,
      });
    });

    await test.step('no /api/admin-proxy response was a 5xx', async () => {
      watcher.stop();
      const summary = watcher.hits.map((h) => `${h.status} ${upstreamOf(h)}`);
      test.info().annotations.push({ type: 'proxy-traffic', description: summary.join(' | ') });
      console.log('[ADMIN-001 proxy traffic]', summary.join('\n  '));
      const fiveXx = watcher.hits.filter((h) => h.status >= 500);
      expect(fiveXx, `5xx proxied: ${fiveXx.map((h) => upstreamOf(h)).join(', ')}`).toEqual([]);
      // And the login's own admission probe must have succeeded through the proxy.
      const menuCountsHit = watcher.hits.find((h) => upstreamOf(h).endsWith('api/v1/admin/menu-counts'));
      expect(menuCountsHit?.status).toBe(200);
    });
  });
});
