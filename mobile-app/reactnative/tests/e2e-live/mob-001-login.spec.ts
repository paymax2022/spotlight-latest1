import { expect, test } from '@playwright/test';
import {
  attachNetLog,
  dumpNetLog,
  expectHome,
  findCalls,
  loginViaUI,
  LIVE_USER,
  NetEntry,
  SESSION_STORAGE_KEY,
} from './helpers/live';

/**
 * MOB-001 — real login through the mobile UI.
 *
 * No route mocks anywhere: the form POSTs to the live Next.js proxy
 * (http://127.0.0.1:3000/api/auth/login), which authenticates against the
 * local GoTrue (http://127.0.0.1:54321) and returns a real session that the
 * app adopts via supabase.auth.setSession().
 */
test.describe('MOB-001 live login', () => {
  const netLog: NetEntry[] = [];

  test.afterEach(async ({}, testInfo) => {
    await dumpNetLog(testInfo, netLog);
    netLog.length = 0;
  });

  test('signing in through the real UI lands on the authenticated home surface', async ({ page }) => {
    attachNetLog(page, netLog);

    await loginViaUI(page);

    // Authenticated destination.
    await expectHome(page);

    // 1) The login POST really happened against the live proxy and returned 200.
    const logins = findCalls(netLog, /\/api\/auth\/login/, 'POST');
    expect(logins.length, 'expected a POST to /api/auth/login').toBeGreaterThan(0);
    expect(logins[0].status, 'live login must return 200').toBe(200);
    expect(logins[0].host).toMatch(/:3000$/);

    // 2) A real GoTrue-backed session was persisted by the app's storage adapter.
    const session = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SESSION_STORAGE_KEY,
    );
    expect(session, 'supabase session should be persisted to localStorage').toBeTruthy();
    expect(JSON.parse(session!)).toHaveProperty('access_token');

    // 3) Live profile evidence: greeting uses the fixture's real full_name
    //    ('QA Claude Test' → 'Hello, QA'), fetched from rest/v1/user_profiles.
    await expect(page.getByText(`Hello, ${LIVE_USER.firstName}`)).toBeVisible();
    const profileCalls = findCalls(netLog, /\/rest\/v1\/user_profiles/);
    expect(profileCalls.some((c) => c.status === 200)).toBeTruthy();
  });
});
