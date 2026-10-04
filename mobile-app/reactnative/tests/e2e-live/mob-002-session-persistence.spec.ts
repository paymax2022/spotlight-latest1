import { expect, test } from '@playwright/test';
import {
  attachNetLog,
  dumpNetLog,
  expectHome,
  findCalls,
  loginViaUI,
  NetEntry,
  SESSION_STORAGE_KEY,
} from './helpers/live';

/**
 * MOB-002 — session/token persistence across a full page reload.
 *
 * The web build persists the Supabase session in localStorage
 * (`paymax_secure_sb-127-auth-token`). After a reload the app must restore it
 * via supabase.auth.getSession() and land the user back on home — with NO
 * second login POST — while still reading live data as the same user.
 */
test.describe('MOB-002 session persistence', () => {
  const netLog: NetEntry[] = [];

  test.afterEach(async ({}, testInfo) => {
    await dumpNetLog(testInfo, netLog);
    netLog.length = 0;
  });

  test('a reload keeps the user signed in on live data', async ({ page }) => {
    attachNetLog(page, netLog);
    await loginViaUI(page);
    await expectHome(page);

    // Session is persisted before reload.
    const before = await page.evaluate((k) => window.localStorage.getItem(k), SESSION_STORAGE_KEY);
    expect(before, 'session must be in localStorage before reload').toBeTruthy();

    const callsBeforeReload = netLog.length;

    await page.reload({ waitUntil: 'domcontentloaded' });

    // The app boots, restores the session, and re-renders the authenticated
    // surface — not the login screen.
    await expectHome(page);
    await expect(page.getByText('Hello, QA')).toBeVisible();
    expect(page.url()).not.toContain('/login');

    // Persistence proof #1: same storage key still holds a session afterwards.
    const after = await page.evaluate((k) => window.localStorage.getItem(k), SESSION_STORAGE_KEY);
    expect(after, 'session must still be in localStorage after reload').toBeTruthy();

    // Persistence proof #2: recovery did NOT re-authenticate — zero login POSTs
    // were issued during the reload window.
    const postReload = netLog.slice(callsBeforeReload);
    const loginReposts = findCalls(postReload, /\/api\/auth\/login/, 'POST');
    expect(loginReposts.length, 'reload must restore the session, not re-login').toBe(0);

    // Persistence proof #3: the restored session is used against live GoTrue —
    // either a token refresh or a user read must succeed on the backend.
    const gotrueCalls = postReload.filter(
      (e) => e.host.endsWith(':54321') && /\/auth\/v1\/(user|token)/.test(e.path) && e.status === 200,
    );
    expect(
      gotrueCalls.length,
      'expected a live GoTrue user/refresh call after reload',
    ).toBeGreaterThan(0);
  });
});
