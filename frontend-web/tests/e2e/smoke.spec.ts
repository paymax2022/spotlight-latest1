/**
 * Smoke — unauthenticated rendering checks. No login, no fixtures.
 * Verifies the app serves its public pages and that the middleware auth gate
 * redirects anonymous visitors away from protected routes.
 */

import { expect, test } from '@playwright/test';
import { LOGIN_ROUTE, PROTECTED_ROUTE } from './helpers/auth';

test.describe('smoke: public pages render', () => {
  test('homepage renders', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/spotlight/i);
    // The marketing shell renders the logo link at the top of the page.
    await expect(page.locator('body')).toContainText(/spotlight/i);
  });

  test('login page renders the sign-in form', async ({ page }) => {
    const res = await page.goto(LOGIN_ROUTE);
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeVisible();
  });

  test('anonymous visit to a protected route redirects to login', async ({ page }) => {
    await page.goto(PROTECTED_ROUTE);
    await expect(page).toHaveURL(new RegExp(`${LOGIN_ROUTE}\\?next=`));
  });
});
