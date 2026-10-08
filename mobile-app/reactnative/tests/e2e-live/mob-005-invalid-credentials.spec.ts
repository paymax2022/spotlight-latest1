import { expect, test } from '@playwright/test';
import {
  attachNetLog,
  dumpNetLog,
  findCalls,
  LIVE_USER,
  NetEntry,
  SESSION_STORAGE_KEY,
} from './helpers/live';

/**
 * MOB-005 — invalid credentials produce the error state.
 *
 * The live proxy answers 401 for a bad password; the login screen maps it via
 * getErrorMessage({ authAttempt: true }) to the INVALID_CREDENTIALS copy.
 * No mock — the 401 is the real backend's verdict.
 *
 * NOTE: each run performs ONE failed attempt against the shared fixture, which
 * increments platform_users.failed_login_attempts — serial execution and a
 * single submission per run keep that well below the lockout threshold.
 */
test.describe('MOB-005 invalid credentials', () => {
  const netLog: NetEntry[] = [];

  test.afterEach(async ({}, testInfo) => {
    await dumpNetLog(testInfo, netLog);
    netLog.length = 0;
  });

  test('a wrong password shows the credentials error and stays on login', async ({ page }) => {
    attachNetLog(page, netLog);

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('you@example.com').fill(LIVE_USER.email);
    await page.getByPlaceholder('Enter your password').fill(`${LIVE_USER.password}-wrong`);
    await page.getByText('Sign In', { exact: true }).click();

    // The exact copy produced by errorMapper for a 401 on the auth path.
    await expect(
      page.getByText('Incorrect email/phone number or password. Please try again.'),
    ).toBeVisible({ timeout: 30_000 });

    // Live evidence: the login POST hit the real proxy and was REJECTED.
    const logins = findCalls(netLog, /\/api\/auth\/login/, 'POST');
    expect(logins.length).toBeGreaterThan(0);
    expect(logins[0].status, 'live proxy must reject bad credentials').toBe(401);

    // Still on the login screen, no session persisted.
    await expect(page).toHaveURL(/\/login/);
    const session = await page.evaluate((k) => window.localStorage.getItem(k), SESSION_STORAGE_KEY);
    expect(session).toBeNull();
  });
});
