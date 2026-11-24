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
 * The live proxy answers 401 for a bad password. Since ADR-PR1163 that 401 also
 * NAMES the cause (`code: incorrect_password` plus a sentence carrying the
 * attempts left), and errorMapper passes the server's words through instead of
 * substituting the generic INVALID_CREDENTIALS copy — which is now only the
 * fallback for an UNNAMED 401. No mock — the 401 is the real backend's verdict.
 *
 * NOTE: each run performs ONE failed attempt against the shared fixture, which
 * increments platform_users.failed_login_attempts — serial execution and a
 * single submission per run keep that well below the lockout threshold. If it
 * ever crosses, this lane legitimately stops being a wrong-password test: the
 * backend answers 423 account_locked and the lock must be cleared on the
 * fixture rather than the assertion relaxed.
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

    // The sentence Go produces for a wrong password on a known account, rendered
    // verbatim. Matched by the part that carries the meaning ("Incorrect password
    // for …"), not the whole sentence: the attempts-left count and the reset
    // advice in the tail are both allowed to be reworded. The legacy generic copy
    // stays in the alternation because this lane runs against whatever backend is
    // deployed — the per-cause contract itself is pinned, where it can be
    // controlled, in tests/unit/auth/errorMapper.spec.ts.
    await expect(
      page.getByText(/Incorrect password for|Incorrect email\/phone number or password/),
    ).toBeVisible({ timeout: 30_000 });
    // Whichever copy is deployed, a refused sign-in must not be reported as a
    // lapsed session — the bug this screen originally had.
    await expect(page.getByText(/session has expired/i)).toHaveCount(0);

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
