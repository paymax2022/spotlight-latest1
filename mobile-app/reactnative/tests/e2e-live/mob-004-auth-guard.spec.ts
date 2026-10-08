import { expect, test } from '@playwright/test';
import {
  attachNetLog,
  dumpNetLog,
  NetEntry,
  SESSION_STORAGE_KEY,
} from './helpers/live';

/**
 * MOB-004 — unauthenticated access is bounced to login.
 *
 * A fresh browser context carries no localStorage session, so AuthGate's
 * `!user && !inAuth` branch must redirect any protected route to
 * /(auth)/login. This runs against the live bundle with zero mocks — the
 * bounce is produced by the app itself, and the only backend calls are the
 * anonymous-boot ones.
 */
test.describe('MOB-004 auth guard', () => {
  const netLog: NetEntry[] = [];

  test.afterEach(async ({}, testInfo) => {
    await dumpNetLog(testInfo, netLog);
    netLog.length = 0;
  });

  test('deep-linking to /home signed-out lands on the login screen', async ({ page }) => {
    attachNetLog(page, netLog);

    await page.goto('/home', { waitUntil: 'domcontentloaded' });

    // Login screen chrome — AuthScreenWrapper title + the submit CTA.
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Sign In', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Guard evidence: no session was ever present, and no authenticated
    // dashboard read succeeded.
    const session = await page.evaluate((k) => window.localStorage.getItem(k), SESSION_STORAGE_KEY);
    expect(session).toBeNull();
    const authedUserReads = netLog.filter(
      (e) => /\/auth\/v1\/user/.test(e.path) && e.status === 200,
    );
    expect(authedUserReads.length, 'no authenticated user read should succeed signed-out').toBe(0);
  });
});
