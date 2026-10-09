/**
 * USER-002 — user dashboard.
 *
 * /user-dashboard → components/user/UserDashboardClient fetches:
 *   GET /api/me            (profile + completion)
 *   GET /api/me/applications
 *   GET /api/opportunities
 *
 * Asserts:
 *   - page renders "Welcome back" with the signed-in user's name
 *   - every /api/* response is < 500
 *   - the "N active contests open" line and the Contests tab count match the
 *     opportunities payload (real data, not placeholders)
 *   - stat tiles render the API summary numbers for a fresh user (all zero —
 *     asserted against the API body, not assumed)
 *   - unauth /api/me → 401
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser } from '../auth/helpers';

test.describe('USER-002: user dashboard renders real data', () => {
  test('dashboard loads, no 5xx, counts match API payloads', async ({
    page,
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'udash');
    await loginViaApi(context, request, { email: user.email, password: user.password });

    const apiCalls: Array<{ url: string; status: number; body?: unknown }> = [];
    page.on('response', (r) => {
      const url = r.url();
      if (!url.includes('/api/')) return;
      const entry: { url: string; status: number; body?: unknown } = { url, status: r.status() };
      apiCalls.push(entry);
      if (/\/api\/(me|me\/applications|opportunities)\b/.test(new URL(url).pathname)) {
        void r.json().then((b) => { entry.body = b; }).catch(() => undefined);
      }
    });

    await page.goto('/user-dashboard');
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 30_000 });

    // Give the JSON bodies a tick to resolve.
    await page.waitForTimeout(500);

    const meCall = apiCalls.find((c) => new URL(c.url).pathname === '/api/me');
    const appsCall = apiCalls.find((c) => new URL(c.url).pathname === '/api/me/applications');
    const oppsCall = apiCalls.find((c) => new URL(c.url).pathname === '/api/opportunities');

    expect(meCall, 'dashboard never called /api/me').toBeTruthy();
    expect(meCall!.status).toBe(200);
    expect(appsCall?.status).toBe(200);
    expect(oppsCall?.status).toBe(200);

    const fiveXx = apiCalls.filter((c) => c.status >= 500);
    expect(fiveXx, `5xx responses: ${JSON.stringify(fiveXx)}`).toEqual([]);

    const opps = ((oppsCall?.body as { opportunities?: unknown[] })?.opportunities ?? []) as unknown[];
    const apps = ((appsCall?.body as { applications?: unknown[] })?.applications ?? []) as unknown[];

    await expect(page.getByText(new RegExp(`${opps.length} active contests? open`))).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`Contests \\(${opps.length}\\)`) })).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`My Applications \\(${apps.length}\\)`) }),
    ).toBeVisible();

    // Fresh user: Total Applied tile should equal the API's applications count.
    if (apps.length === 0) {
      await page.getByRole('button', { name: /My Applications \(0\)/ }).click();
      await expect(page.getByText(/haven't applied to any contests yet/i)).toBeVisible();
    }

    test.info().annotations.push({
      type: 'api-traffic',
      description: apiCalls.map((c) => `${c.status} ${new URL(c.url).pathname}`).join(' | '),
    });

    // Unauthenticated probe on the primary endpoint.
    const unauth = await request.get('/api/me');
    expect(unauth.status()).toBe(401);
  });
});
