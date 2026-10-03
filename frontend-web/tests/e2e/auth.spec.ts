/**
 * AUTH-001 — real login journey against the live local stack
 * (Next dev :3000 → /api/auth/login → Go :8080 → GoTrue :54321).
 *
 * Journey: bad credentials produce a VISIBLE error → fixture credentials land
 * on an authenticated page → a protected route can be hit directly → after
 * logout the same protected route bounces to /login.
 *
 * Runs serially within this file because the logout step ends the session the
 * earlier steps create.
 */

import { expect, test } from '@playwright/test';
import {
  AUTH_STATE_PATH,
  BAD_CREDENTIALS_TEXT,
  LOGIN_ROUTE,
  PROTECTED_ROUTE,
  TEST_USER,
  loginViaUi,
  saveAuthState,
  signOut,
} from './helpers/auth';

test.describe('AUTH-001: login → protected route → logout', () => {
  test('bad creds show error, real login lands authenticated, logout re-gates protected route', async ({
    page,
    context,
    request,
  }) => {
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

    await test.step('fixture credentials land on an authenticated page', async () => {
      await loginViaUi(page, request, TEST_USER);
      await expect(page).toHaveURL(new RegExp(PROTECTED_ROUTE));
      await expect(page.getByText(/welcome back/i)).toBeVisible();

      // Persist the session for specs that reuse tests/e2e/.auth/user.json.
      await saveAuthState(context, AUTH_STATE_PATH);
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
  });
});
