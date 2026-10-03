/**
 * USER-005 — state persistence across sessions.
 *
 * Provisioned user → login → save profile via the real /profile UI →
 * sign out → sign in again through the real login UI → /profile still shows
 * the saved values, and GET /api/me/profile + DB agree.
 */

import { expect, test } from '@playwright/test';
import { loginViaUi, signOut } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';

test.describe('USER-005: profile data survives sign-out/sign-in', () => {
  test('saved profile fields persist across a full re-login', async ({ page, request }) => {
    const user = await provisionVerifiedUser(request, 'upersist');
    const creds = { email: user.email, password: user.password };
    const marker = `Persist${Date.now() % 100000}`;

    await test.step('login + save a profile field through the UI', async () => {
      await loginViaUi(page, request, creds);
      await page.goto('/profile');
      await expect(page.getByText('Profile Completion:')).toBeVisible({ timeout: 30_000 });
      await page.locator('label', { hasText: 'City / Area' }).locator('input').fill(marker);
      const put = page.waitForResponse(
        (r) => r.url().includes('/api/me/profile') && r.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: /save profile/i }).click();
      expect((await put).status()).toBe(200);
      await expect(page.getByText('Profile saved.')).toBeVisible();
    });

    await test.step('sign out through the real UI', async () => {
      await signOut(page);
      await page.goto('/user-dashboard');
      await expect(page).toHaveURL(/\/login\?next=/);
    });

    await test.step('sign in again — data still there', async () => {
      await loginViaUi(page, request, creds);
      await page.goto('/profile');
      await expect(page.getByText('Profile Completion:')).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('label', { hasText: 'City / Area' }).locator('input'),
      ).toHaveValue(marker);

      const db = psql(`select city from public.user_profiles where id='${user.userId}';`);
      expect(db).toBe(marker);
    });
  });
});
