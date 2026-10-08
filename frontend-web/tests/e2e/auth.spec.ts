/**
 * AUTH-001 — real login journey against the live local stack
 * (Next dev :3000 → /api/auth/login → Go :8080 → GoTrue :54321).
 *
 * Journey: bad credentials produce a VISIBLE error → a provisioned user's
 * credentials land on an authenticated page → a protected route can be hit
 * directly → after logout the same protected route bounces to /login.
 *
 * TEST-013: this spec provisions its OWN confirmed user instead of the shared
 * qa-claude-test fixture. The logout step revokes the session GLOBALLY on
 * GoTrue — running it against the shared fixture killed the sessions of every
 * other auth spec running in parallel (fullyParallel: true).
 *
 * Runs serially within this file because the logout step ends the session the
 * earlier steps create.
 */

import { expect, test } from '@playwright/test';
import {
  BAD_CREDENTIALS_TEXT,
  LOGIN_ROUTE,
  PROTECTED_ROUTE,
  deleteProvisionedUser,
  loginViaUi,
  provisionConfirmedUser,
  signOut,
} from './helpers/auth';

test.describe('AUTH-001: login → protected route → logout', () => {
  test('bad creds show error, real login lands authenticated, logout re-gates protected route', async ({
    page,
    request,
  }) => {
    // Own the session lifecycle: a unique confirmed user whose global
    // revocation at the logout step touches nothing else on the box.
    const specUser = {
      email: `auth-001-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@spotlight.internal`,
      password: 'Auth001Spec!pw',
    };
    const specUserId = await provisionConfirmedUser(request, specUser.email, specUser.password);

    try {
      await test.step('login page renders', async () => {
        await page.goto(LOGIN_ROUTE);
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        await expect(page.locator('form button[type="submit"]')).toBeVisible();
      });

      await test.step('bad credentials show a visible error (not silent)', async () => {
        await page.locator('input[type="email"]').fill('nobody-e2e@spotlight.internal');
        await page.locator('input[type="password"]').fill('definitely-wrong-password');
        await page.locator('form button[type="submit"]').click();

        await expect(page.getByText(BAD_CREDENTIALS_TEXT)).toBeVisible();
        // Still on /login — no navigation happened.
        await expect(page).toHaveURL(new RegExp(`${LOGIN_ROUTE}`));
      });

      await test.step('provisioned credentials land on an authenticated page', async () => {
        await loginViaUi(page, request, specUser);
        await expect(page).toHaveURL(new RegExp(PROTECTED_ROUTE));
        await expect(page.getByText(/welcome back/i)).toBeVisible();
      });

      await test.step('protected route is reachable directly when authenticated', async () => {
        await page.goto(PROTECTED_ROUTE);
        await expect(page).toHaveURL(new RegExp(PROTECTED_ROUTE));
        await expect(page).not.toHaveURL(new RegExp(LOGIN_ROUTE));
        await expect(page.getByText(/welcome back/i)).toBeVisible();
      });

      await test.step('after logout the protected route redirects to login', async () => {
        await signOut(page);

        await page.goto(PROTECTED_ROUTE);
        // src/middleware.ts redirects to /login?next=<route>.
        await expect(page).toHaveURL(new RegExp(`${LOGIN_ROUTE}\\?next=`));
      });
    } finally {
      await deleteProvisionedUser(request, specUserId);
    }
  });
});
